import { spawnSync as defaultSpawnSync } from 'node:child_process';

const ID = /^[a-z][a-z0-9_.:-]*$/;
const OPERATION = new Set(['claim', 'accept', 'progress', 'complete', 'fail', 'cancel', 'receipt', 'silence']);
const NO_AUTOMATIC_FAILOVER_RISKS = new Set(['identity_bound', 'publishing', 'high']);

export class HandoffTransportError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HandoffTransportError';
  }
}

function capable(node, requiredCapabilities) {
  const available = new Set(node?.capabilities ?? []);
  return requiredCapabilities.every((capability) => available.has(capability));
}

export function selectHandoffNode({ topology, executionPolicy, nodeStatuses = {} }) {
  if (!topology || !Array.isArray(topology.nodes)) throw new HandoffTransportError('topology is invalid');
  if (!executionPolicy || typeof executionPolicy !== 'object') {
    throw new HandoffTransportError('execution policy is required');
  }
  const required = executionPolicy.requiredCapabilities ?? [];
  const preferred = topology.nodes.find((node) => node.id === executionPolicy.preferredNodeId);
  if (!preferred || !capable(preferred, required)) {
    return { status: 'waiting', reason: 'preferred_node_lacks_capability', options: ['retry', 'manual'] };
  }
  if ((nodeStatuses[preferred.id] ?? 'offline') === 'online') {
    return { status: 'selected', nodeId: preferred.id, failover: false };
  }
  if (NO_AUTOMATIC_FAILOVER_RISKS.has(executionPolicy.risk)) {
    return {
      status: 'waiting',
      reason: executionPolicy.risk === 'identity_bound'
        ? 'identity_bound_node_unavailable'
        : 'protected_node_unavailable',
      options: ['wait', 'retry', 'manual'],
    };
  }
  if (
    executionPolicy.failoverPolicy !== 'automatic'
    || executionPolicy.idempotent !== true
    || executionPolicy.risk !== 'low'
  ) {
    return { status: 'waiting', reason: 'manual_failover_required', options: ['wait', 'retry', 'manual'] };
  }
  for (const nodeId of executionPolicy.fallbackNodeIds ?? []) {
    const node = topology.nodes.find((candidate) => candidate.id === nodeId);
    if (node && capable(node, required) && nodeStatuses[nodeId] === 'online') {
      return { status: 'selected', nodeId, failover: true };
    }
  }
  return { status: 'waiting', reason: 'no_capable_node_online', options: ['wait', 'retry', 'manual'] };
}

export class InProcessHandoffAdapter {
  constructor({ ledger } = {}) {
    if (!ledger) throw new HandoffTransportError('ledger is required');
    this.ledger = ledger;
  }

  claim(nodeId) {
    return { tasks: this.ledger.listTasks({ assignedNodeId: nodeId, state: 'queued' }) };
  }

  accept(nodeId, input) {
    return { task: this.ledger.transition(input.taskId, {
      expectedVersion: input.expectedVersion,
      to: 'accepted',
      actorNodeId: nodeId,
      summary: input.summary,
    }) };
  }

  progress(nodeId, input) {
    if (input.start === true) {
      return { task: this.ledger.transition(input.taskId, {
        expectedVersion: input.expectedVersion,
        to: 'running',
        actorNodeId: nodeId,
        summary: input.summary,
        evidence: input.evidence,
      }) };
    }
    return { task: this.ledger.recordProgress(input.taskId, {
      expectedVersion: input.expectedVersion,
      actorNodeId: nodeId,
      summary: input.summary,
      evidence: input.evidence,
    }) };
  }

  complete(nodeId, input) { return this.#finish(nodeId, input, 'completed'); }
  receipt(nodeId, input) { return this.#finish(nodeId, input, 'completed'); }
  fail(nodeId, input) { return this.#finish(nodeId, input, 'failed'); }

  #finish(nodeId, input, to) {
    return { task: this.ledger.transition(input.taskId, {
      expectedVersion: input.expectedVersion,
      to,
      actorNodeId: nodeId,
      summary: input.summary,
      evidence: input.evidence,
      receipt: input.receipt,
    }) };
  }
}

export class RestrictedSshHandoffAdapter {
  constructor({
    sshExecutable = '/usr/bin/ssh',
    identityFile,
    hostAlias,
    departmentId,
    nodeId,
    timeoutSeconds = 30,
    spawnSync = defaultSpawnSync,
  } = {}) {
    if (typeof sshExecutable !== 'string' || !sshExecutable.startsWith('/')) {
      throw new HandoffTransportError('sshExecutable must be absolute');
    }
    if (typeof identityFile !== 'string' || !identityFile.startsWith('/') || identityFile.includes('\0')) {
      throw new HandoffTransportError('identityFile must be absolute');
    }
    if (typeof hostAlias !== 'string' || !/^[A-Za-z0-9._@-]+$/.test(hostAlias)) {
      throw new HandoffTransportError('hostAlias is invalid');
    }
    if (!ID.test(departmentId) || !ID.test(nodeId)) {
      throw new HandoffTransportError('departmentId or nodeId is invalid');
    }
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 300) {
      throw new HandoffTransportError('timeoutSeconds is invalid');
    }
    this.sshExecutable = sshExecutable;
    this.identityFile = identityFile;
    this.hostAlias = hostAlias;
    this.departmentId = departmentId;
    this.nodeId = nodeId;
    this.timeoutSeconds = timeoutSeconds;
    this.spawnSync = spawnSync;
  }

  invoke(operation, input = {}) {
    if (!OPERATION.has(operation)) throw new HandoffTransportError('operation is invalid');
    const remoteCommand = [
      'lark-channel-bridge-department organization handoff-operation',
      this.departmentId,
      this.nodeId,
      operation,
    ].join(' ');
    const result = this.spawnSync(this.sshExecutable, [
      '-i', this.identityFile,
      '-o', 'IdentitiesOnly=yes',
      '-o', 'BatchMode=yes',
      '-o', `ConnectTimeout=${this.timeoutSeconds}`,
      this.hostAlias,
      remoteCommand,
    ], {
      input: `${JSON.stringify(input)}\n`,
      encoding: 'utf8',
      shell: false,
      timeout: this.timeoutSeconds * 1000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    });
    if (result.error) throw new HandoffTransportError(result.error.message);
    if (result.status !== 0) {
      throw new HandoffTransportError(
        `remote handoff failed (${result.status}): ${String(result.stderr ?? '').trim().slice(0, 1000)}`,
      );
    }
    try {
      return JSON.parse(String(result.stdout));
    } catch (error) {
      throw new HandoffTransportError(`remote handoff output is invalid: ${error.message}`);
    }
  }

  claim() { return this.invoke('claim', {}); }
  accept(_nodeId, input) { return this.invoke('accept', input); }
  progress(_nodeId, input) { return this.invoke('progress', input); }
  complete(_nodeId, input) { return this.invoke('complete', input); }
  receipt(_nodeId, input) { return this.invoke('receipt', input); }
  fail(_nodeId, input) { return this.invoke('fail', input); }
}
