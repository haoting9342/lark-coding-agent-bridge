const markerStart = (departmentId) =>
  `<!-- lark-channel-bridge-department:start ${departmentId} -->`;
const markerEnd = (departmentId) =>
  `<!-- lark-channel-bridge-department:end ${departmentId} -->`;

function lines(values) {
  return (values ?? []).map((value) => `- ${value}`).join('\n') || '- 无';
}

export function renderDepartmentOverlay({ departmentId, departmentName, draft }) {
  const protocols = (draft.taskProtocols ?? []).map((protocol) => [
    `### ${protocol.name}（${protocol.id}）`,
    `触发意图：${(protocol.intents ?? []).join('、') || '按名称匹配'}`,
    `执行步骤：${(protocol.steps ?? []).join(' → ')}`,
    `质量检查：${(protocol.qualityChecks ?? []).join('；')}`,
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
