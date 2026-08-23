function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function bulletList(values) {
  return (values ?? []).map((value) => `- ${value}`).join('\n') || '- 无';
}

function renderDepartmentAgents(request, draft) {
  const protocols = (draft.taskProtocols ?? []).map((protocol) => [
    `## ${protocol.name}（${protocol.id}）`,
    '',
    `用途：${protocol.purpose}`,
    '',
    `触发意图：${(protocol.intents ?? []).join('、')}`,
    '',
    `输入要求：${(protocol.requiredInputs ?? []).join('、') || '无固定输入'}`,
    '',
    `澄清规则：${protocol.clarificationPolicy}`,
    '',
    `步骤：${(protocol.steps ?? []).join(' → ')}`,
    '',
    `质量检查：${(protocol.qualityChecks ?? []).join('；')}`,
    '',
    `交付物：${(protocol.deliverables ?? []).join('、')}`,
    '',
    `完成标准：${(protocol.completionCriteria ?? []).join('；')}`,
    '',
    `修改规则：${protocol.revisionPolicy}`,
  ].join('\n')).join('\n\n');
  return [
    `# ${request.departmentName}`,
    '',
    `部门类型：${draft.kind}`,
    '',
    `目标：${draft.purpose}`,
    '',
    '## 工作原则',
    '',
    '- 先理解用户当前任务，再选择匹配的任务规程；不要把部门业务阶段机械套到每次任务上。',
    '- 缺少影响交付质量的关键信息时先澄清；能够安全推断的非关键细节可以提出候选方案。',
    '- 交付前执行对应质量检查；涉及审批边界时必须停下并取得明确授权。',
    '- 保留工作区既有规则，冲突时采用更严格的约束并向用户说明。',
    '',
    '## 职责',
    '',
    bulletList(draft.responsibilities),
    '',
    '## 不在范围内',
    '',
    bulletList(draft.outOfScope),
    '',
    '## 审批边界',
    '',
    bulletList(draft.approvalBoundaries),
    '',
    protocols || '## 默认任务规程\n\n理解任务 → 澄清关键输入 → 执行 → 质量检查 → 交付。',
    '',
  ].join('\n');
}

function renderMemory(draft) {
  return [
    '# 已确认的部门记忆',
    '',
    '## 用户确认事实',
    '',
    bulletList(draft.confirmedFacts),
    '',
    '## 历史规则',
    '',
    bulletList(draft.historicalRules),
    '',
    '只将经过用户确认的稳定事实写入长期记忆；不要保存原始聊天全文。',
    '',
  ].join('\n');
}

function renderSkillsPlan(draft) {
  const items = (draft.capabilityPlan ?? []).map((capability) => [
    `## ${capability.id}`,
    '',
    `- 类型：${capability.kind}`,
    `- 必需：${capability.required ? '是' : '否'}`,
    `- 范围：${capability.scope}`,
    `- 安装策略：${capability.installPolicy}`,
    `- 节点：${capability.nodeId ?? 'primary'}`,
    `- 来源：${JSON.stringify(capability.source)}`,
  ].join('\n')).join('\n\n');
  return [
    '# 能力物化计划',
    '',
    items || '当前没有需要额外安装的能力。',
    '',
    '能力只有在安装并通过验证后才标记为可用；待授权或人工配置的能力不得虚报为已安装。',
    '',
  ].join('\n');
}

export function buildDepartmentPackage(request, draft, confirmedAt) {
  const topology = draft.organizationTopology;
  const department = {
    schemaVersion: 1,
    id: request.departmentId,
    name: request.departmentName,
    kind: draft.kind,
    status: draft.lifecycle,
    purpose: draft.purpose,
    mission: draft.mission ?? null,
    objective: draft.objective ?? null,
    deadline: draft.deadline ?? null,
    group: { name: request.groupName, chatId: request.chatId },
    workspace: request.workspace,
    profile: request.profile,
    responsibilities: draft.responsibilities,
    outOfScope: draft.outOfScope,
    approvalBoundaries: draft.approvalBoundaries,
    serviceCatalog: draft.serviceCatalog ?? [],
    deliverables: draft.deliverables ?? [],
    confirmedBy: request.senderId,
    confirmedAt,
  };
  const workflow = {
    schemaVersion: 1,
    semantics: 'task_execution',
    defaultFlow: draft.workflow,
    businessLifecycle: draft.businessLifecycle,
    taskProtocols: draft.taskProtocols,
    recurringWorkflows: draft.recurringWorkflows ?? [],
    milestones: draft.milestones ?? [],
    doneWhen: draft.doneWhen ?? [],
  };
  const existingAssets = {
    schemaVersion: 1,
    workspace: request.workspace,
    sources: [
      ...(draft.contextSources ?? []),
      ...((request.contextInventory?.sources ?? []).map((source) => ({
        path: source.path ?? source.relativePath,
        type: source.type,
        confidence: source.confidence,
        ...(source.sha256 ? { sha256: source.sha256 } : {}),
      }))),
    ],
  };
  return new Map([
    ['department.json', json(department)],
    ['workflow.json', json(workflow)],
    ['topology.json', json({ schemaVersion: 1, ...topology })],
    ['existing-assets.json', json(existingAssets)],
    ['AGENTS.md', renderDepartmentAgents(request, draft)],
    ['memory.md', renderMemory(draft)],
    ['skills-plan.md', renderSkillsPlan(draft)],
  ]);
}
