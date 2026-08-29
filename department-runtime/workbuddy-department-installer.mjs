import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertDepartmentDraft } from './department-draft-schema.mjs';

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function slug(value) {
  const normalized = String(value ?? '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(normalized) ? normalized : 'workbuddy_department';
}

function ensureWorkspace(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('工作区必须是绝对路径');
  }
  const resolved = path.resolve(value);
  if (!existsSync(resolved)) throw new Error(`工作区不存在：${resolved}`);
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('工作区必须是普通目录，不能是符号链接');
  return resolved;
}

function defaults(input) {
  const name = String(input.departmentName ?? input.name ?? '').trim();
  const purpose = String(input.purpose ?? '').trim();
  const workspace = ensureWorkspace(input.workspace);
  return {
    departmentName: name,
    kind: input.kind ?? 'permanent',
    purpose,
    mission: input.mission ?? purpose,
    workspace,
    responsibilities: input.responsibilities ?? ['围绕部门目标完成任务'],
    outOfScope: input.outOfScope ?? [],
    workflow: input.workflow ?? ['理解需求', '执行任务', '检查交付'],
    businessLifecycle: input.businessLifecycle ?? [],
    taskProtocols: input.taskProtocols ?? [],
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

function overlay({ id, name, draft }) {
  const protocols = (draft.taskProtocols ?? []).map((item) =>
    `- ${item.name}（${item.id}）：${(item.intents ?? []).join('、') || item.purpose}`,
  ).join('\n') || '当前没有预定义规程；新任务按自由探索处理。';
  return [
    `<!-- workbuddy-department:start ${id} -->`,
    `## 部门工作规则：${name}`,
    '',
    `目标：${draft.purpose}`,
    '',
    '### 任务模式',
    '- 直接执行：明确、低风险且无需固定规程的任务直接完成。',
    '- 单规程或组合规程：只使用确实命中的规程。',
    '- 自由探索：新任务或规程不适用时先探索，不强行套用。',
    '',
    '### 职责',
    ...(draft.responsibilities.length ? draft.responsibilities.map((item) => `- ${item}`) : ['- 无']),
    '',
    '### 审批边界',
    ...(draft.approvalBoundaries.length ? draft.approvalBoundaries.map((item) => `- ${item}`) : ['- 无']),
    '',
    '### 任务规程索引',
    protocols,
    '',
    'WorkBuddy 执行任务时只读取当前命中的规程，不要求每条消息都加载全部流程文件。',
    `<!-- workbuddy-department:end ${id} -->`,
    '',
  ].join('\n');
}

function mergeAgents(original, value, id) {
  if (original.includes(`workbuddy-department:start ${id}`) || original.includes(`workbuddy-department:end ${id}`)) {
    throw new Error(`工作区已经存在 WorkBuddy 部门规则：${id}`);
  }
  return `${original.trimEnd()}${original.trim() ? '\n\n' : ''}${value}`;
}

function writeAtomic(file, content) {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, file);
}

export function createWorkBuddyDepartment(input) {
  const draft = assertDepartmentDraft(defaults(input), { requireReady: true });
  const departmentId = String(input.departmentId ?? slug(draft.departmentName));
  if (!/^[a-z][a-z0-9_]*$/.test(departmentId)) {
    throw new Error('部门编号必须是小写字母、数字和下划线，且以字母开头');
  }
  const workspace = draft.workspace;
  const stateRoot = path.join(workspace, '.workbuddy-department');
  const packageRoot = path.join(stateRoot, departmentId);
  if (existsSync(packageRoot)) throw new Error(`WorkBuddy 部门已经存在：${departmentId}`);
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  mkdirSync(packageRoot, { recursive: true, mode: 0o700 });
  const confirmedAt = new Date().toISOString();
  const files = {
    'department.json': {
      schemaVersion: 1,
      platform: 'workbuddy',
      id: departmentId,
      name: draft.departmentName,
      kind: draft.kind,
      status: draft.lifecycle,
      purpose: draft.purpose,
      mission: draft.mission,
      workspace,
      responsibilities: draft.responsibilities,
      outOfScope: draft.outOfScope,
      approvalBoundaries: draft.approvalBoundaries,
      confirmedAt,
    },
    'workflow.json': {
      schemaVersion: 1,
      revision: 1,
      semantics: 'task_execution',
      platform: 'workbuddy',
      defaultFlow: draft.workflow,
      businessLifecycle: draft.businessLifecycle,
      taskProtocols: draft.taskProtocols,
      orchestrationPolicy: draft.orchestrationPolicy,
      capabilityPlan: draft.capabilityPlan,
    },
    'AGENTS.md': overlay({ id: departmentId, name: draft.departmentName, draft }),
    'memory.md': '# 已确认的部门记忆\n\n只保存经过确认的稳定事实，不保存原始聊天全文。\n',
    'skills-plan.md': `${JSON.stringify({ schemaVersion: 1, platform: 'workbuddy', capabilities: draft.capabilityPlan }, null, 2)}\n`,
    'manifest.json': json({ schemaVersion: 1, platform: 'workbuddy', departmentId, createdAt: confirmedAt }),
  };
  try {
    for (const [name, value] of Object.entries(files)) {
      writeAtomic(path.join(packageRoot, name), typeof value === 'string' ? value : json(value));
    }
    const agentsPath = path.join(workspace, 'AGENTS.md');
    const original = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : '';
    writeAtomic(agentsPath, mergeAgents(original, files['AGENTS.md'], departmentId));
  } catch (error) {
    rmSync(packageRoot, { recursive: true, force: true });
    throw error;
  }
  return { platform: 'workbuddy', departmentId, departmentName: draft.departmentName, workspace, packageRoot };
}

export function readWorkBuddySpec(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('规格文件必须是普通文件');
  return JSON.parse(readFileSync(file, 'utf8'));
}
