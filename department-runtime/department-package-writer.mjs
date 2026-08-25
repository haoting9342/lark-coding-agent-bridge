function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function bulletList(values) {
  return (values ?? []).map((value) => `- ${value}`).join('\n') || '- 无';
}

function qualityCheckText(check) {
  if (typeof check === 'string') return check;
  if (!check || typeof check !== 'object') return String(check ?? '');
  return `[${check.method}/${check.trigger}] ${check.description}`;
}

function orchestrationRules(policy) {
  return [
    '## 自适应代理编排',
    '',
    '- 角色是职责定义，不等于常驻或必启 Agent 进程；流程步骤和质量门禁也不得机械映射为子代理。',
    '- 主代理负责连续工作、状态、依赖、证据和最终整合。仅在工作可独立并行、需要专门能力、独立高风险复核有明显价值，或规模足以抵消派工成本时才委派。',
    `- 最多同时运行 ${policy.maxConcurrentSubagents} 个子代理；一个工作项最多 ${policy.maxExecutionAgentsPerWorkItem} 个执行代理；一个里程碑最多 ${policy.maxIndependentReviewsPerMilestone} 次独立复核和 ${policy.maxReviewRounds} 轮复审。`,
    `- 子代理默认使用 \`fork_turns="${policy.defaultForkTurns}"\`；完整历史 fork ${policy.allowFullHistoryFork ? '只有在用户明确批准并记录理由后才允许' : '禁止使用'}。任务包只包含目标、所有权、输入路径、完成条件、证据要求和限制。`,
    `- 大型图片、PPT、PDF、日志和扫描结果使用${policy.largeArtifactTransfer === 'path_and_summary' ? '工作区路径与摘要' : '小体积内联，大型内容仍使用路径与摘要'}传递，不复制聊天全文或原始大结果。`,
    '- 确定性质量检查优先交给脚本或工具；coordinator 检查由主代理完成；只有 independent 检查才可使用独立复核代理；human 检查必须等待用户。',
    `- 模型按工作量分级：检索/定位使用 ${policy.modelRouting.lookup}，常规执行使用 ${policy.modelRouting.execution}，复杂决策使用 ${policy.modelRouting.complexDecision}，独立终审使用 ${policy.modelRouting.independentReview}。`,
    '- 部门 taskProtocol 决定业务执行方式。通用 Skill 可以提供方法，但不得因为存在书面计划，就用软件开发的 worker/规格审查/代码质量审查模板覆盖 PPT、大纲、报告、研究或内容生产任务。',
  ];
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
    `质量检查：${(protocol.qualityChecks ?? []).map(qualityCheckText).join('；')}`,
    '',
    `交付物：${(protocol.deliverables ?? []).join('、')}`,
    '',
    `完成标准：${(protocol.completionCriteria ?? []).join('；')}`,
    '',
    `修改规则：${protocol.revisionPolicy}`,
  ].join('\n')).join('\n\n');
  const multiHostRules = draft.organizationTopology?.nodes?.length > 1
    ? [
      '## 多主机任务分发',
      '',
      `本部门主节点是 ${draft.organizationTopology.primaryNodeId}，由主节点负责正式规则、共享记忆和最终答复。`,
      '',
      `需要辅助节点能力时，将受限 JSON 任务通过 \`lark-channel-bridge-department organization handoff-submit ${request.departmentId}\` 的标准输入提交。`,
      '辅助节点只返回摘要、证据和回执；普通即时对话由主节点使用 handoff-status 读取结果并汇总答复。',
      '节点离线时向用户提供等待、重试或人工处理选项，不得伪造结果；身份和发布类任务不得自动故障转移。',
      '',
    ]
    : [];
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
    ...orchestrationRules(draft.orchestrationPolicy),
    '',
    ...multiHostRules,
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
    orchestrationPolicy: draft.orchestrationPolicy,
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
