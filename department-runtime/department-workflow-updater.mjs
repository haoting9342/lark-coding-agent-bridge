import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { assertTaskProtocols } from './department-draft-schema.mjs';
import {
  renderDepartmentOverlay,
  replaceDepartmentOverlay,
} from './department-overlay.mjs';
import { renderDepartmentAgents } from './department-package-writer.mjs';
import { acquireDirectoryLock } from './directory-lock.mjs';

const CONFIRMATIONS = new Set([
  '确认修改部门流程',
  '同意修改部门流程',
  '确认更新部门流程',
  '同意更新部门流程',
]);
const OPERATIONS = new Set([
  'replace_task_protocol',
  'add_task_protocol',
  'remove_task_protocol',
]);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function regularFile(file, label) {
  if (!existsSync(file)) throw new Error(`${label} is missing: ${file}`);
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  return info;
}

function readJson(file, label) {
  regularFile(file, label);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function snapshot(file, label) {
  const info = regularFile(file, label);
  return { file, content: readFileSync(file), mode: info.mode & 0o777 };
}

function atomicWrite(file, content, mode = 0o600) {
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, content, { mode });
  chmodSync(temporary, mode);
  renameSync(temporary, file);
}

function restore(snapshotValue) {
  atomicWrite(snapshotValue.file, snapshotValue.content, snapshotValue.mode);
}

function validateDepartmentId(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error('department id must be snake_case');
  }
  return value;
}

function validateRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new Error('workflow update request must be an object');
  }
  if (request.schemaVersion !== 1) throw new Error('workflow update request schemaVersion must be 1');
  if (typeof request.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(request.expectedSha256)) {
    throw new Error('expectedSha256 must be a SHA-256 digest');
  }
  if (!CONFIRMATIONS.has(String(request.confirmationText ?? '').trim())) {
    throw new Error('workflow-specific confirmation is required: 确认修改部门流程');
  }
  if (typeof request.reason !== 'string' || !request.reason.trim()) {
    throw new Error('workflow update reason is required');
  }
  if (!Array.isArray(request.operations) || request.operations.length === 0 || request.operations.length > 20) {
    throw new Error('workflow update requires between 1 and 20 operations');
  }
}

function applyOperations(protocols, operations) {
  const next = structuredClone(protocols);
  const changed = [];
  for (const operation of operations) {
    if (!operation || typeof operation !== 'object' || !OPERATIONS.has(operation.op)) {
      throw new Error('unsupported workflow protocol operation');
    }
    const protocolId = validateDepartmentId(operation.protocolId);
    const index = next.findIndex((protocol) => protocol.id === protocolId);
    if (operation.op === 'replace_task_protocol') {
      if (index < 0) throw new Error(`task protocol is missing: ${protocolId}`);
      if (!operation.value || operation.value.id !== protocolId) {
        throw new Error(`replacement protocol id must remain ${protocolId}`);
      }
      next[index] = structuredClone(operation.value);
    } else if (operation.op === 'add_task_protocol') {
      if (index >= 0) throw new Error(`task protocol already exists: ${protocolId}`);
      if (!operation.value || operation.value.id !== protocolId) {
        throw new Error(`added protocol id must be ${protocolId}`);
      }
      next.push(structuredClone(operation.value));
    } else {
      if (index < 0) throw new Error(`task protocol is missing: ${protocolId}`);
      next.splice(index, 1);
    }
    changed.push(protocolId);
  }
  try {
    return { protocols: assertTaskProtocols(next), changed: [...new Set(changed)] };
  } catch (error) {
    const detail = Array.isArray(error?.errors)
      ? error.errors.map((item) => `${item.path}: ${item.message}`).join('; ')
      : error.message;
    throw new Error(`task protocol validation failed: ${detail}`);
  }
}

function draftFromPackage(department, workflow, topology) {
  return {
    kind: department.kind,
    purpose: department.purpose,
    responsibilities: department.responsibilities ?? [],
    outOfScope: department.outOfScope ?? [],
    approvalBoundaries: department.approvalBoundaries ?? [],
    orchestrationPolicy: workflow.orchestrationPolicy,
    taskProtocols: workflow.taskProtocols,
    organizationTopology: topology,
  };
}

export class DepartmentWorkflowUpdater {
  constructor({ organizationRoot, now = () => new Date(), failAfter = null }) {
    if (typeof organizationRoot !== 'string' || !path.isAbsolute(organizationRoot)) {
      throw new Error('organizationRoot must be an absolute path');
    }
    this.organizationRoot = path.resolve(organizationRoot);
    this.now = now;
    this.failAfter = failAfter;
  }

  show(departmentIdValue) {
    const departmentId = validateDepartmentId(departmentIdValue);
    const departmentRoot = path.join(this.organizationRoot, 'departments', departmentId);
    const workflowPath = path.join(departmentRoot, 'workflow.json');
    const raw = readFileSync(workflowPath);
    const workflow = readJson(workflowPath, 'department workflow');
    const currentHash = sha256(raw);
    return {
      schemaVersion: 1,
      departmentId,
      workflowPath,
      revision: Number.isInteger(workflow.revision) ? workflow.revision : 1,
      sha256: currentHash,
      supportedOperations: [...OPERATIONS],
      applyRequestTemplate: {
        schemaVersion: 1,
        expectedSha256: currentHash,
        confirmationText: '确认修改部门流程',
        actorId: '<department-owner-id>',
        reason: '<why-this-is-a-durable-department-default>',
        operations: [{
          op: 'replace_task_protocol',
          protocolId: '<task-protocol-id>',
          value: '<complete-task-protocol-object>',
        }],
      },
      workflow,
    };
  }

  protocol(departmentIdValue, protocolIdValue) {
    const departmentId = validateDepartmentId(departmentIdValue);
    const protocolId = validateDepartmentId(protocolIdValue);
    const workflowPath = path.join(this.organizationRoot, 'departments', departmentId, 'workflow.json');
    const workflow = readJson(workflowPath, 'department workflow');
    const protocol = (workflow.taskProtocols ?? []).find((item) => item?.id === protocolId);
    if (!protocol) throw new Error(`task protocol is missing: ${protocolId}`);
    return {
      schemaVersion: 1,
      departmentId,
      revision: Number.isInteger(workflow.revision) ? workflow.revision : 1,
      protocol: structuredClone(protocol),
    };
  }

  apply(departmentIdValue, request) {
    const departmentId = validateDepartmentId(departmentIdValue);
    validateRequest(request);
    const departmentRoot = path.join(this.organizationRoot, 'departments', departmentId);
    const workflowPath = path.join(departmentRoot, 'workflow.json');
    const packageAgentsPath = path.join(departmentRoot, 'AGENTS.md');
    const department = readJson(path.join(departmentRoot, 'department.json'), 'department metadata');
    if (department.id !== departmentId) throw new Error('department identity is inconsistent');
    if (typeof department.workspace !== 'string' || !path.isAbsolute(department.workspace)) {
      throw new Error('department workspace is invalid');
    }
    const workspaceAgentsPath = path.join(department.workspace, 'AGENTS.md');
    const topology = readJson(path.join(departmentRoot, 'topology.json'), 'department topology');
    const beforeRaw = readFileSync(workflowPath);
    const beforeHash = sha256(beforeRaw);
    if (beforeHash !== request.expectedSha256.toLowerCase()) {
      throw new Error(`stale workflow SHA-256: expected ${request.expectedSha256}, current ${beforeHash}`);
    }
    const workflow = JSON.parse(beforeRaw.toString('utf8'));
    if (workflow.schemaVersion !== 1 || workflow.semantics !== 'task_execution') {
      throw new Error('department workflow schema is invalid');
    }
    const { protocols, changed } = applyOperations(workflow.taskProtocols, request.operations);
    const oldRevision = Number.isInteger(workflow.revision) ? workflow.revision : 1;
    const updatedAt = this.now().toISOString();
    const updated = {
      ...workflow,
      revision: oldRevision + 1,
      updatedAt,
      lastUpdatedBy: typeof request.actorId === 'string' ? request.actorId : 'department-owner',
      lastUpdateReason: request.reason.trim(),
      taskProtocols: protocols,
    };
    const snapshots = [
      snapshot(workflowPath, 'department workflow'),
      snapshot(packageAgentsPath, 'department package AGENTS'),
      snapshot(workspaceAgentsPath, 'workspace AGENTS'),
    ];
    const transactionId = randomUUID();
    const backupRoot = path.join(this.organizationRoot, 'backups', transactionId);
    const receiptPath = path.join(this.organizationRoot, 'transactions', `${transactionId}.json`);
    const lock = path.join(this.organizationRoot, 'transactions', `.workflow-${departmentId}.lock`);
    let releaseLock;
    try {
      releaseLock = acquireDirectoryLock(lock);
    } catch {
      throw new Error(`department workflow is busy: ${departmentId}`);
    }
    try {
      mkdirSync(backupRoot, { recursive: false, mode: 0o700 });
      for (const item of snapshots) {
        const name = item.file === workflowPath
          ? 'workflow.json'
          : item.file === packageAgentsPath ? 'department-AGENTS.md' : 'workspace-AGENTS.md';
        writeFileSync(path.join(backupRoot, name), item.content, { mode: item.mode });
      }
      atomicWrite(workflowPath, `${JSON.stringify(updated, null, 2)}\n`, statSync(workflowPath).mode & 0o777);
      this.#maybeFail('workflow');
      const draft = draftFromPackage(department, updated, topology);
      atomicWrite(
        packageAgentsPath,
        renderDepartmentAgents({
          departmentId,
          departmentName: department.name,
          workflowPath,
        }, draft),
        statSync(packageAgentsPath).mode & 0o777,
      );
      this.#maybeFail('package_agents');
      const overlay = renderDepartmentOverlay({
        departmentId,
        departmentName: department.name,
        draft,
        workflowPath,
      });
      const workspaceOriginal = snapshots[2].content.toString('utf8');
      atomicWrite(
        workspaceAgentsPath,
        replaceDepartmentOverlay(workspaceOriginal, overlay, departmentId),
        snapshots[2].mode,
      );
      this.#maybeFail('workspace_agents');
      const afterHash = sha256(readFileSync(workflowPath));
      const receipt = {
        schemaVersion: 1,
        transactionId,
        status: 'completed',
        departmentId,
        actorId: typeof request.actorId === 'string' ? request.actorId : 'department-owner',
        reason: request.reason.trim(),
        changedProtocolIds: changed,
        oldRevision,
        newRevision: oldRevision + 1,
        oldSha256: beforeHash,
        newSha256: afterHash,
        backupRoot,
        updatedAt,
      };
      atomicWrite(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
      this.#maybeFail('receipt');
      return { ...receipt, receiptPath };
    } catch (error) {
      for (const item of snapshots) restore(item);
      rmSync(receiptPath, { force: true });
      throw error;
    } finally {
      releaseLock();
    }
  }

  #maybeFail(stage) {
    if (this.failAfter === stage) throw new Error(`injected failure after ${stage}`);
  }
}
