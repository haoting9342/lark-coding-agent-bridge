import { spawnSync as defaultSpawnSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';

const ID = /^[a-z][a-z0-9_]*$/;
const FORBIDDEN_OUTPUT_KEY = /(?:password|passwd|cookie|credential|secret|token|browser.?profile|raw.?session|chain.?of.?thought|command|executable|argv|args)/i;

export class RunnerConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RunnerConfigurationError';
  }
}

export class RunnerExecutionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RunnerExecutionError';
  }
}

function scanOutput(value, location = 'runner output') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanOutput(item, `${location}/${index}`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_OUTPUT_KEY.test(key)) throw new RunnerExecutionError(`${location}/${key} is forbidden`);
    scanOutput(child, `${location}/${key}`);
  }
}

function validateDefinition(protocolId, definition) {
  if (!ID.test(protocolId)) throw new RunnerConfigurationError('runner protocol id is invalid');
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new RunnerConfigurationError(`runner ${protocolId} must be an object`);
  }
  const allowed = new Set(['executable', 'args', 'cwd', 'timeoutSeconds', 'capabilities']);
  for (const field of Object.keys(definition)) {
    if (!allowed.has(field)) throw new RunnerConfigurationError(`unknown runner field: ${field}`);
  }
  if (typeof definition.executable !== 'string' || !path.isAbsolute(definition.executable)) {
    throw new RunnerConfigurationError(`runner ${protocolId} executable must be absolute`);
  }
  if (!existsSync(definition.executable)) {
    throw new RunnerConfigurationError(`runner ${protocolId} executable is missing`);
  }
  const executableInfo = lstatSync(definition.executable);
  if (!executableInfo.isFile() || executableInfo.isSymbolicLink()) {
    throw new RunnerConfigurationError(`runner ${protocolId} executable must be a regular file`);
  }
  if (new Set(['sh', 'bash', 'zsh', 'dash', 'fish']).has(path.basename(definition.executable))) {
    throw new RunnerConfigurationError(`runner ${protocolId} may not invoke a shell`);
  }
  if (!Array.isArray(definition.args) || definition.args.some((item) => typeof item !== 'string')) {
    throw new RunnerConfigurationError(`runner ${protocolId} args must be a fixed string array`);
  }
  if (definition.cwd !== undefined) {
    if (typeof definition.cwd !== 'string' || !path.isAbsolute(definition.cwd)) {
      throw new RunnerConfigurationError(`runner ${protocolId} cwd must be absolute`);
    }
    const cwdInfo = existsSync(definition.cwd) ? lstatSync(definition.cwd) : null;
    if (!cwdInfo?.isDirectory() || cwdInfo.isSymbolicLink()) {
      throw new RunnerConfigurationError(`runner ${protocolId} cwd must be a regular directory`);
    }
  }
  if (!Number.isInteger(definition.timeoutSeconds) || definition.timeoutSeconds < 1 || definition.timeoutSeconds > 3600) {
    throw new RunnerConfigurationError(`runner ${protocolId} timeoutSeconds is invalid`);
  }
  if (!Array.isArray(definition.capabilities) || definition.capabilities.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new RunnerConfigurationError(`runner ${protocolId} capabilities must be a string array`);
  }
  return structuredClone(definition);
}

export class DepartmentRunnerRegistry {
  constructor({ runners = {}, spawnSync = defaultSpawnSync, maxOutputBytes = 256 * 1024 } = {}) {
    if (!runners || typeof runners !== 'object' || Array.isArray(runners)) {
      throw new RunnerConfigurationError('runners must be an object');
    }
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 1024 * 1024) {
      throw new RunnerConfigurationError('maxOutputBytes is invalid');
    }
    this.runners = new Map();
    this.spawnSync = spawnSync;
    this.maxOutputBytes = maxOutputBytes;
    for (const [protocolId, definition] of Object.entries(runners)) this.register(protocolId, definition);
  }

  register(protocolId, definition) {
    this.runners.set(protocolId, validateDefinition(protocolId, definition));
  }

  describe(protocolId) {
    const definition = this.runners.get(protocolId);
    if (!definition) throw new RunnerConfigurationError(`runner is not allowlisted: ${protocolId}`);
    return structuredClone(definition);
  }

  run(task) {
    const definition = this.runners.get(task?.protocolId);
    if (!definition) throw new RunnerConfigurationError(`runner is not allowlisted: ${String(task?.protocolId)}`);
    const missing = (task.requiredCapabilities ?? []).filter(
      (capability) => !definition.capabilities.includes(capability),
    );
    if (missing.length) throw new RunnerConfigurationError(`runner lacks required capabilities: ${missing.join(', ')}`);
    const payload = `${JSON.stringify({
      schemaVersion: 1,
      taskId: task.id,
      departmentId: task.departmentId,
      protocolId: task.protocolId,
      goal: task.goal,
      context: task.context,
      deliverables: task.deliverables,
      evidenceRequirements: task.evidenceRequirements,
      deadline: task.deadline,
      deliveryMode: task.deliveryMode,
      risk: task.risk,
    })}\n`;
    const result = this.spawnSync(definition.executable, definition.args, {
      cwd: definition.cwd,
      input: payload,
      encoding: 'utf8',
      shell: false,
      timeout: definition.timeoutSeconds * 1000,
      maxBuffer: this.maxOutputBytes,
      windowsHide: true,
    });
    if (result.error) throw new RunnerExecutionError(`runner failed: ${result.error.message}`);
    if (result.status !== 0) {
      throw new RunnerExecutionError(
        `runner exited ${result.status}: ${String(result.stderr ?? '').trim().slice(0, 1000)}`,
      );
    }
    const stdout = String(result.stdout ?? '');
    if (Buffer.byteLength(stdout, 'utf8') > this.maxOutputBytes) {
      throw new RunnerExecutionError('runner output is too large');
    }
    let output;
    try {
      output = JSON.parse(stdout);
    } catch (error) {
      throw new RunnerExecutionError(`runner output is not JSON: ${error.message}`);
    }
    if (!output || typeof output !== 'object' || Array.isArray(output)) {
      throw new RunnerExecutionError('runner output must be an object');
    }
    for (const field of Object.keys(output)) {
      if (!new Set(['summary', 'evidence', 'receipt']).has(field)) {
        throw new RunnerExecutionError(`unknown runner output field: ${field}`);
      }
    }
    if (typeof output.summary !== 'string' || !output.summary.trim() || output.summary.length > 4096) {
      throw new RunnerExecutionError('runner summary is invalid');
    }
    if (!Array.isArray(output.evidence)) throw new RunnerExecutionError('runner evidence must be an array');
    if (output.receipt !== undefined && (!output.receipt || typeof output.receipt !== 'object' || Array.isArray(output.receipt))) {
      throw new RunnerExecutionError('runner receipt must be an object');
    }
    scanOutput(output);
    return structuredClone(output);
  }
}
