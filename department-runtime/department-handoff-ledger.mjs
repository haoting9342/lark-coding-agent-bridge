import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const ACTIVE_STATES = new Set(['accepted', 'running', 'blocked']);
const TERMINAL_STATES = new Set(['completed', 'failed', 'cancelled']);
const TRANSITIONS = new Map([
  ['queued', new Set(['accepted', 'cancelled'])],
  ['accepted', new Set(['running', 'blocked', 'failed', 'cancelled'])],
  ['running', new Set(['waiting_user', 'blocked', 'completed', 'failed', 'cancelled'])],
  ['waiting_user', new Set(['running', 'failed', 'cancelled'])],
  ['blocked', new Set(['running', 'failed', 'cancelled'])],
  ['completed', new Set()],
  ['failed', new Set()],
  ['cancelled', new Set()],
]);
const ENVELOPE_FIELDS = new Set([
  'protocolId', 'assignedNodeId', 'goal', 'requiredCapabilities', 'context',
  'deliverables', 'evidenceRequirements', 'deadline', 'progressPolicy',
  'idempotencyKey', 'deliveryMode', 'risk', 'periodic', 'directDeliveryApproved',
]);
const UPDATE_FIELDS = new Set([
  'expectedVersion', 'to', 'actorNodeId', 'summary', 'evidence', 'receipt',
]);
const FORBIDDEN_KEY = /(?:password|passwd|cookie|credential|secret|token|browser.?profile|raw.?session|chain.?of.?thought|command|executable|argv|args)/i;
const IDENTIFIER = /^[a-z][a-z0-9_.:-]*$/;

export class HandoffValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HandoffValidationError';
  }
}

export class HandoffConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HandoffConflictError';
  }
}

function clone(value) {
  return structuredClone(value);
}

function requireIdentifier(value, name) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    throw new HandoffValidationError(`${name} is invalid`);
  }
}

function requireString(value, name, maxLength = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new HandoffValidationError(`${name} must be a non-empty bounded string`);
  }
}

function requireStringArray(value, name, allowEmpty = true) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new HandoffValidationError(`${name} must be an array of non-empty strings`);
  }
  if (!allowEmpty && value.length === 0) throw new HandoffValidationError(`${name} must not be empty`);
}

function scanRestrictedKeys(value, location = 'payload') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanRestrictedKeys(item, `${location}/${index}`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new HandoffValidationError(`${location}/${key} is forbidden`);
    scanRestrictedKeys(child, `${location}/${key}`);
  }
}

function validatePayloadSize(value, maxPayloadBytes) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch (error) {
    throw new HandoffValidationError(`payload is not JSON serializable: ${error.message}`);
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxPayloadBytes) {
    throw new HandoffValidationError(`payload exceeds ${maxPayloadBytes} bytes`);
  }
}

function emptyLedger(departmentId) {
  return { schemaVersion: 1, departmentId, sequence: 0, tasks: [], events: [] };
}

export class DepartmentHandoffLedger {
  constructor({
    ledgerFile,
    departmentId,
    maxPayloadBytes = 256 * 1024,
    idFactory = () => `task_${randomUUID()}`,
    now = () => new Date(),
  } = {}) {
    if (typeof ledgerFile !== 'string' || !path.isAbsolute(ledgerFile) || ledgerFile.includes('\0')) {
      throw new HandoffValidationError('ledgerFile must be an absolute path');
    }
    requireIdentifier(departmentId, 'departmentId');
    if (!Number.isInteger(maxPayloadBytes) || maxPayloadBytes < 1024 || maxPayloadBytes > 1024 * 1024) {
      throw new HandoffValidationError('maxPayloadBytes is invalid');
    }
    this.ledgerFile = ledgerFile;
    this.departmentId = departmentId;
    this.maxPayloadBytes = maxPayloadBytes;
    this.idFactory = idFactory;
    this.now = now;
    this.lockPath = `${ledgerFile}.lock`;
  }

  createTask(envelope) {
    this.#validateEnvelope(envelope);
    return this.#mutate((ledger) => {
      const existing = ledger.tasks.find((task) => task.idempotencyKey === envelope.idempotencyKey);
      if (existing) return { duplicate: true, task: clone(existing) };
      const timestamp = this.#timestamp();
      const id = this.idFactory();
      requireIdentifier(id, 'task id');
      if (ledger.tasks.some((task) => task.id === id)) {
        throw new HandoffConflictError(`duplicate task id: ${id}`);
      }
      const task = {
        id,
        departmentId: this.departmentId,
        ...clone(envelope),
        state: 'queued',
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastProgressAt: timestamp,
      };
      ledger.tasks.push(task);
      this.#appendEvent(ledger, task, {
        from: null, to: 'queued', actorNodeId: null, summary: 'task queued', timestamp,
      });
      return { duplicate: false, task: clone(task) };
    });
  }

  transition(taskId, update) {
    requireIdentifier(taskId, 'taskId');
    this.#validateTransition(update);
    return this.#mutate((ledger) => {
      const task = ledger.tasks.find((item) => item.id === taskId);
      if (!task) throw new HandoffValidationError(`unknown task: ${taskId}`);
      if (task.version !== update.expectedVersion) {
        throw new HandoffConflictError(
          `stale task version: expected ${update.expectedVersion}, current ${task.version}`,
        );
      }
      if (TERMINAL_STATES.has(task.state) || !TRANSITIONS.get(task.state)?.has(update.to)) {
        throw new HandoffConflictError(`invalid transition: ${task.state} -> ${update.to}`);
      }
      if (
        new Set(['accepted', 'running', 'waiting_user', 'blocked', 'completed']).has(update.to)
        && update.actorNodeId !== task.assignedNodeId
      ) {
        throw new HandoffConflictError('only the assigned node may advance execution state');
      }
      const timestamp = this.#timestamp();
      const from = task.state;
      task.state = update.to;
      task.version += 1;
      task.updatedAt = timestamp;
      if (ACTIVE_STATES.has(update.to) || update.to === 'waiting_user') task.lastProgressAt = timestamp;
      if (update.evidence !== undefined) task.evidence = clone(update.evidence);
      if (update.receipt !== undefined) task.receipt = clone(update.receipt);
      this.#appendEvent(ledger, task, {
        from,
        to: update.to,
        actorNodeId: update.actorNodeId,
        summary: update.summary.trim(),
        ...(update.evidence !== undefined ? { evidence: clone(update.evidence) } : {}),
        ...(update.receipt !== undefined ? { receipt: clone(update.receipt) } : {}),
        timestamp,
      });
      return clone(task);
    });
  }

  recordProgress(taskId, update) {
    return this.#mutate((ledger) => {
      requireIdentifier(taskId, 'taskId');
      if (!update || typeof update !== 'object' || Array.isArray(update)) {
        throw new HandoffValidationError('progress update must be an object');
      }
      if (!Number.isInteger(update.expectedVersion) || update.expectedVersion < 1) {
        throw new HandoffValidationError('expectedVersion is invalid');
      }
      requireIdentifier(update.actorNodeId, 'actorNodeId');
      requireString(update.summary, 'summary', 2048);
      scanRestrictedKeys(update);
      validatePayloadSize(update, this.maxPayloadBytes);
      const task = ledger.tasks.find((item) => item.id === taskId);
      if (!task) throw new HandoffValidationError(`unknown task: ${taskId}`);
      if (task.version !== update.expectedVersion) throw new HandoffConflictError('stale task version');
      if (!ACTIVE_STATES.has(task.state) || update.actorNodeId !== task.assignedNodeId) {
        throw new HandoffConflictError('only the assigned node may update active task progress');
      }
      const timestamp = this.#timestamp();
      task.version += 1;
      task.updatedAt = timestamp;
      task.lastProgressAt = timestamp;
      this.#appendEvent(ledger, task, {
        from: task.state,
        to: task.state,
        actorNodeId: update.actorNodeId,
        summary: update.summary.trim(),
        evidence: clone(update.evidence ?? []),
        progress: true,
        timestamp,
      });
      return clone(task);
    });
  }

  getTask(taskId) {
    requireIdentifier(taskId, 'taskId');
    const task = this.#read().tasks.find((item) => item.id === taskId);
    return task ? clone(task) : null;
  }

  listTasks({ assignedNodeId, state } = {}) {
    if (assignedNodeId !== undefined) requireIdentifier(assignedNodeId, 'assignedNodeId');
    if (state !== undefined && !TRANSITIONS.has(state)) throw new HandoffValidationError('state is invalid');
    return this.#read().tasks
      .filter((task) => assignedNodeId === undefined || task.assignedNodeId === assignedNodeId)
      .filter((task) => state === undefined || task.state === state)
      .map(clone);
  }

  eventsFor(taskId) {
    requireIdentifier(taskId, 'taskId');
    return this.#read().events.filter((event) => event.taskId === taskId).map(clone);
  }

  findSilentTasks() {
    const now = this.now().getTime();
    return this.#read().tasks.flatMap((task) => {
      if (!ACTIVE_STATES.has(task.state)) return [];
      const maximum = task.progressPolicy?.maxSilenceSeconds;
      if (!Number.isInteger(maximum) || maximum < 1) return [];
      const silentForSeconds = Math.floor((now - new Date(task.lastProgressAt).getTime()) / 1000);
      if (silentForSeconds <= maximum) return [];
      return [{
        taskId: task.id,
        assignedNodeId: task.assignedNodeId,
        state: task.state,
        version: task.version,
        silentForSeconds,
        maxSilenceSeconds: maximum,
      }];
    });
  }

  #validateEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new HandoffValidationError('task envelope must be an object');
    }
    for (const field of Object.keys(envelope)) {
      if (!ENVELOPE_FIELDS.has(field)) throw new HandoffValidationError(`unknown task envelope field: ${field}`);
    }
    requireIdentifier(envelope.protocolId, 'protocolId');
    requireIdentifier(envelope.assignedNodeId, 'assignedNodeId');
    requireString(envelope.goal, 'goal', 16_384);
    requireStringArray(envelope.requiredCapabilities, 'requiredCapabilities');
    requireStringArray(envelope.deliverables, 'deliverables', false);
    requireStringArray(envelope.evidenceRequirements, 'evidenceRequirements');
    requireString(envelope.idempotencyKey, 'idempotencyKey', 512);
    if (!envelope.context || typeof envelope.context !== 'object' || Array.isArray(envelope.context)) {
      throw new HandoffValidationError('context must be an object');
    }
    if (
      !envelope.progressPolicy
      || !Number.isInteger(envelope.progressPolicy.maxSilenceSeconds)
      || envelope.progressPolicy.maxSilenceSeconds < 30
      || envelope.progressPolicy.maxSilenceSeconds > 86_400
      || !new Set(['concise_group_status', 'internal_only']).has(envelope.progressPolicy.visibility)
    ) {
      throw new HandoffValidationError('progressPolicy is invalid');
    }
    if (!new Set(['primary_synthesized', 'direct_with_receipt']).has(envelope.deliveryMode)) {
      throw new HandoffValidationError('deliveryMode is invalid');
    }
    if (typeof envelope.periodic !== 'boolean' || typeof envelope.directDeliveryApproved !== 'boolean') {
      throw new HandoffValidationError('periodic and directDeliveryApproved must be booleans');
    }
    if (
      envelope.deliveryMode === 'direct_with_receipt'
      && (!envelope.periodic || !envelope.directDeliveryApproved)
    ) {
      throw new HandoffValidationError('direct delivery requires an approved periodic task');
    }
    if (!new Set(['low', 'normal', 'high', 'identity_bound', 'publishing']).has(envelope.risk)) {
      throw new HandoffValidationError('risk is invalid');
    }
    if (envelope.deadline != null && !Number.isFinite(Date.parse(envelope.deadline))) {
      throw new HandoffValidationError('deadline must be an ISO timestamp');
    }
    scanRestrictedKeys(envelope);
    validatePayloadSize(envelope, this.maxPayloadBytes);
  }

  #validateTransition(update) {
    if (!update || typeof update !== 'object' || Array.isArray(update)) {
      throw new HandoffValidationError('transition must be an object');
    }
    for (const field of Object.keys(update)) {
      if (!UPDATE_FIELDS.has(field)) throw new HandoffValidationError(`unknown transition field: ${field}`);
    }
    if (!Number.isInteger(update.expectedVersion) || update.expectedVersion < 1) {
      throw new HandoffValidationError('expectedVersion is invalid');
    }
    if (!TRANSITIONS.has(update.to) || update.to === 'queued') {
      throw new HandoffValidationError('transition target is invalid');
    }
    requireIdentifier(update.actorNodeId, 'actorNodeId');
    requireString(update.summary, 'summary', 2048);
    if (update.evidence !== undefined && !Array.isArray(update.evidence)) {
      throw new HandoffValidationError('evidence must be an array');
    }
    if (update.receipt !== undefined && (!update.receipt || typeof update.receipt !== 'object' || Array.isArray(update.receipt))) {
      throw new HandoffValidationError('receipt must be an object');
    }
    scanRestrictedKeys(update);
    validatePayloadSize(update, this.maxPayloadBytes);
  }

  #appendEvent(ledger, task, value) {
    ledger.sequence += 1;
    ledger.events.push({ sequence: ledger.sequence, taskId: task.id, version: task.version, ...clone(value) });
  }

  #timestamp() {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new HandoffValidationError('now() must return a valid Date');
    }
    return value.toISOString();
  }

  #read() {
    if (!existsSync(this.ledgerFile)) return emptyLedger(this.departmentId);
    const info = lstatSync(this.ledgerFile);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new HandoffValidationError('ledger path must be a regular file');
    }
    let value;
    try {
      value = JSON.parse(readFileSync(this.ledgerFile, 'utf8'));
    } catch (error) {
      throw new HandoffValidationError(`ledger is invalid JSON: ${error.message}`);
    }
    if (
      value.schemaVersion !== 1
      || value.departmentId !== this.departmentId
      || !Array.isArray(value.tasks)
      || !Array.isArray(value.events)
      || !Number.isInteger(value.sequence)
    ) {
      throw new HandoffValidationError('ledger contract is invalid');
    }
    return value;
  }

  #mutate(callback) {
    mkdirSync(path.dirname(this.ledgerFile), { recursive: true, mode: 0o700 });
    try {
      mkdirSync(this.lockPath, { mode: 0o700 });
    } catch (error) {
      if (error.code === 'EEXIST') throw new HandoffConflictError('ledger is busy');
      throw error;
    }
    try {
      const ledger = this.#read();
      const result = callback(ledger);
      const temporary = `${this.ledgerFile}.tmp-${process.pid}-${randomUUID()}`;
      writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.ledgerFile);
      return result;
    } finally {
      rmSync(this.lockPath, { recursive: true, force: true });
    }
  }
}
