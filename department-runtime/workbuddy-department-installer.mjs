import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { confirmAndProvisionWorkBuddyDepartment } from './workbuddy-session-service.mjs';

function slug(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(normalized) ? normalized : 'workbuddy_department';
}

function ensureWorkspace(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('工作区必须是绝对路径');
  const resolved = path.resolve(value);
  if (!existsSync(resolved)) throw new Error(`工作区不存在：${resolved}`);
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('工作区必须是普通目录，不能是符号链接');
  return resolved;
}

function withDefaults(input) {
  const departmentName = String(input.departmentName ?? input.name ?? '').trim();
  const purpose = String(input.purpose ?? '').trim();
  const workspace = ensureWorkspace(input.workspace);
  return {
    departmentName,
    kind: input.kind ?? 'permanent',
    purpose,
    mission: input.mission ?? purpose,
    workspace,
    responsibilities: input.responsibilities ?? ['围绕部门目标完成任务'],
    outOfScope: input.outOfScope ?? [],
    workflow: input.workflow ?? ['理解需求', '执行任务', '检查交付'],
    businessLifecycle: input.businessLifecycle ?? [],
    taskProtocols: input.taskProtocols ?? [],
    ...(input.orchestrationPolicy ? { orchestrationPolicy: input.orchestrationPolicy } : {}),
    capabilityPlan: input.capabilityPlan ?? [],
    approvalBoundaries: input.approvalBoundaries ?? ['涉及外部发布、敏感信息或不可逆操作前先确认'],
    confirmedFacts: input.confirmedFacts ?? [],
    historicalRules: input.historicalRules ?? [],
    contextSources: input.contextSources ?? [],
    openQuestions: input.openQuestions ?? [],
    serviceCatalog: input.serviceCatalog ?? [purpose],
    recurringWorkflows: input.recurringWorkflows ?? [],
    defaultProjects: input.defaultProjects ?? [],
    taskTypes: input.taskTypes ?? ['一般任务'],
    lifecycle: input.lifecycle ?? 'active',
  };
}

export function createWorkBuddyDepartment(input) {
  if (input.confirmCreate !== true) throw new Error('正式创建需要用户明确确认');
  const draft = withDefaults(input);
  const departmentId = String(input.departmentId ?? slug(draft.departmentName));
  return confirmAndProvisionWorkBuddyDepartment({
    workspace: draft.workspace,
    departmentId,
    draft,
    confirmationMessage: input.confirmationMessage,
  });
}

export function readWorkBuddySpec(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('规格文件必须是普通文件');
  return JSON.parse(readFileSync(file, 'utf8'));
}
