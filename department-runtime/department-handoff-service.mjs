import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { selectHandoffNode } from './department-handoff-adapter.mjs';
import { DepartmentHandoffLedger } from './department-handoff-ledger.mjs';

function safeJson(file, label) {
  if (!existsSync(file)) throw new Error(`${label} is missing`);
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${error.message}`);
  }
}

function evidenceRequirements(checks) {
  return (Array.isArray(checks) ? checks : []).flatMap((check) => {
    if (typeof check === 'string' && check.trim()) return [check.trim()];
    if (check && typeof check === 'object' && typeof check.description === 'string' && check.description.trim()) {
      return [check.description.trim()];
    }
    return [];
  });
}

export class DepartmentHandoffService {
  constructor({ organizationRoot, departmentId } = {}) {
    if (typeof organizationRoot !== 'string' || !path.isAbsolute(organizationRoot)) {
      throw new TypeError('organizationRoot must be absolute');
    }
    if (typeof departmentId !== 'string' || !/^[a-z][a-z0-9_]*$/.test(departmentId)) {
      throw new TypeError('departmentId is invalid');
    }
    this.organizationRoot = path.resolve(organizationRoot);
    this.departmentId = departmentId;
    this.departmentRoot = path.join(this.organizationRoot, 'departments', departmentId);
    const info = lstatSync(this.departmentRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('department package is invalid');
    this.ledger = new DepartmentHandoffLedger({
      ledgerFile: path.join(this.departmentRoot, 'handoff-ledger.json'),
      departmentId,
    });
  }

  submit(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('handoff input is required');
    const workflow = safeJson(path.join(this.departmentRoot, 'workflow.json'), 'department workflow');
    const topology = safeJson(path.join(this.departmentRoot, 'topology.json'), 'department topology');
    const registry = safeJson(
      path.join(this.organizationRoot, 'nodes', 'node-registry.json'),
      'organization node registry',
    );
    const protocol = workflow.taskProtocols?.find((item) => item.id === input.protocolId);
    if (!protocol) throw new Error(`unknown department task protocol: ${String(input.protocolId)}`);
    const executionPolicy = protocol.executionPolicy;
    if (!executionPolicy) throw new Error(`task protocol has no execution policy: ${input.protocolId}`);
    const nodeStatuses = Object.fromEntries(
      (registry.nodes ?? []).map((node) => [node.id, node.status]),
    );
    const selection = selectHandoffNode({ topology, executionPolicy, nodeStatuses });
    if (selection.status !== 'selected') return selection;
    const created = this.ledger.createTask({
      protocolId: protocol.id,
      assignedNodeId: selection.nodeId,
      goal: input.goal,
      requiredCapabilities: executionPolicy.requiredCapabilities ?? [],
      context: input.context ?? {},
      deliverables: protocol.deliverables ?? [],
      evidenceRequirements: evidenceRequirements(protocol.qualityChecks),
      deadline: input.deadline ?? null,
      progressPolicy: {
        maxSilenceSeconds: executionPolicy.maxSilenceSeconds ?? 300,
        visibility: topology.handoffPolicy?.progressVisibility ?? 'concise_group_status',
      },
      idempotencyKey: input.idempotencyKey,
      deliveryMode: executionPolicy.deliveryMode ?? 'primary_synthesized',
      risk: executionPolicy.risk ?? 'normal',
      periodic: executionPolicy.periodic === true,
      directDeliveryApproved: executionPolicy.directDeliveryApproved === true,
    });
    return {
      status: 'queued',
      assignedNodeId: selection.nodeId,
      failover: selection.failover,
      duplicate: created.duplicate,
      task: created.task,
    };
  }

  status(taskId) {
    const task = this.ledger.getTask(taskId);
    if (!task) throw new Error(`unknown handoff task: ${taskId}`);
    return task;
  }

  silentTasks() {
    return this.ledger.findSilentTasks();
  }
}
