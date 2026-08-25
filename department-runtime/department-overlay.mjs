const markerStart = (departmentId) =>
  `<!-- lark-channel-bridge-department:start ${departmentId} -->`;
const markerEnd = (departmentId) =>
  `<!-- lark-channel-bridge-department:end ${departmentId} -->`;

function lines(values) {
  return (values ?? []).map((value) => `- ${value}`).join('\n') || '- 无';
}

function qualityCheckText(check) {
  if (typeof check === 'string') return check;
  if (!check || typeof check !== 'object') return String(check ?? '');
  return `[${check.method}/${check.trigger}] ${check.description}`;
}

function orchestrationLines(policy) {
  return [
    '### 自适应代理编排',
    '- 角色是职责定义，不等于常驻或必启 Agent 进程；流程节点和质量门禁不自动创建子代理。',
    `- 最多同时运行 ${policy.maxConcurrentSubagents} 个子代理；每个工作项最多 ${policy.maxExecutionAgentsPerWorkItem} 个执行代理；每个里程碑最多 ${policy.maxIndependentReviewsPerMilestone} 次独立复核、${policy.maxReviewRounds} 轮复审。`,
    `- 子代理默认使用 \`fork_turns="${policy.defaultForkTurns}"\`；完整历史 fork ${policy.allowFullHistoryFork ? '需要用户明确批准和书面理由' : '禁止使用'}。`,
    '- 子代理只接收目标、所有权、输入路径、完成条件、证据要求和限制；大型产物通过工作区路径与摘要传递。',
    '- deterministic 检查优先使用脚本，coordinator 检查由主代理完成，independent 检查才允许独立复核代理，human 检查等待用户。',
    `- 模型分级：检索 ${policy.modelRouting.lookup}，常规执行 ${policy.modelRouting.execution}，复杂决策 ${policy.modelRouting.complexDecision}，独立终审 ${policy.modelRouting.independentReview}。`,
    '- 通用 Skill 不得因为存在书面计划，就用软件开发的 worker/规格审查/代码质量审查模板覆盖 PPT、大纲、报告、研究或内容生产任务。',
  ];
}

export function renderDepartmentOverlay({ departmentId, departmentName, draft }) {
  const protocols = (draft.taskProtocols ?? []).map((protocol) => [
    `### ${protocol.name}（${protocol.id}）`,
    `触发意图：${(protocol.intents ?? []).join('、') || '按名称匹配'}`,
    `执行步骤：${(protocol.steps ?? []).join(' → ')}`,
    `质量检查：${(protocol.qualityChecks ?? []).map(qualityCheckText).join('；')}`,
    `完成标准：${(protocol.completionCriteria ?? []).join('；')}`,
  ].join('\n')).join('\n\n');
  return [
    markerStart(departmentId),
    `## 部门工作规则：${departmentName}`,
    '',
    `部门类型：${draft.kind}。目标：${draft.purpose}`,
    '',
    '### 职责',
    lines(draft.responsibilities),
    '',
    '### 审批边界',
    lines(draft.approvalBoundaries),
    '',
    ...orchestrationLines(draft.orchestrationPolicy),
    '',
    '### 任务执行规程',
    protocols || '按用户具体任务先澄清、再执行、检查并交付。',
    '',
    '部门业务阶段用于规划与状态管理，不作为每个用户任务都必须机械执行的步骤。',
    markerEnd(departmentId),
  ].join('\n');
}

export function mergeDepartmentOverlay(original, overlay, departmentId) {
  const content = String(original ?? '');
  if (content.includes(markerStart(departmentId)) || content.includes(markerEnd(departmentId))) {
    throw new Error(`workspace already contains department overlay: ${departmentId}`);
  }
  return `${content.trimEnd()}${content.trim() ? '\n\n' : ''}${overlay.trim()}\n`;
}
