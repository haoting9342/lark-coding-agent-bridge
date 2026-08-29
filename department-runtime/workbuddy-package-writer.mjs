function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function skillName(...parts) {
  return parts.join('-').replace(/_/g, '-');
}

function frontmatter(name, description) {
  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
  ].join('\n');
}

function protocolSkill(departmentId, protocol) {
  const intentSummary = (protocol.intents ?? []).join('、') || '由 Agent 根据任务内容判断';
  const name = skillName(departmentId, 'protocol', protocol.id);
  const contextPolicy = protocol.contextPolicy ?? {};
  const executionPolicy = protocol.executionPolicy ?? {};
  const executionLabels = {
    coordinatorNodeId: '协调节点', preferredNodeId: '首选节点', requiredCapabilities: '必需能力',
    verifierRoleId: '验证角色', deliveryMode: '交付方式', failoverPolicy: '故障转移策略',
    fallbackNodeIds: '备用节点', maxSilenceSeconds: '最长静默秒数', contextScopes: '上下文范围',
    periodic: '周期任务', directDeliveryApproved: '允许直接交付', risk: '风险等级', idempotent: '是否幂等',
  };
  const executionLines = Object.entries(executionPolicy).map(([field, value]) =>
    `- ${executionLabels[field] ?? field}：${Array.isArray(value) ? value.join('、') : String(value)}`,
  );
  return [
    frontmatter(name, `${protocol.purpose || protocol.name}。仅当任务意图符合“${intentSummary}”时使用。`),
    `# ${protocol.name}`,
    '',
    `规程编号：${protocol.id}`,
    `适用意图：${intentSummary}`,
    '',
    '## 输入与澄清',
    `- 必需输入：${(protocol.requiredInputs ?? []).join('、') || '根据任务补充'}`,
    `- 澄清规则：${protocol.clarificationPolicy}`,
    '',
    '## 执行步骤',
    ...(protocol.steps ?? []).map((step, index) => `${index + 1}. ${step}`),
    '',
    '## 质量检查',
    ...(protocol.qualityChecks ?? []).map((check) => typeof check === 'string'
      ? `- ${check}`
      : `- ${check.description}；方式：${check.method}；触发：${check.trigger}`),
    '',
    '## 交付与完成条件',
    `- 交付物：${(protocol.deliverables ?? []).join('、') || '按任务约定'}`,
    `- 完成条件：${(protocol.completionCriteria ?? []).join('、') || '用户确认结果可用'}`,
    '',
    '## Skill 策略',
    `- 主 Skill：${protocol.skillPolicy?.primary ?? protocol.skills?.[0] ?? '由 Agent 按需选择'}`,
    `- 辅助 Skill：${(protocol.skillPolicy?.auxiliaries ?? []).map((item) => `${item.skill}（${item.when}）`).join('；') || '仅在明确命中条件时加载'}`,
    `- 辅助 Skill 上限：${protocol.skillPolicy?.maxAuxiliaries ?? 0}`,
    '- 能力计划中的 Skill 只有实际存在并通过验证后才能调用。',
    '',
    '## 上下文策略',
    `- 模式：${contextPolicy.mode ?? 'targeted'}`,
    `- 包含：${(contextPolicy.include ?? []).join('、') || '当前任务所需信息'}`,
    `- 排除：${(contextPolicy.exclude ?? []).join('、') || '无关文件和敏感信息'}`,
    `- 最大文件数：${contextPolicy.maxFiles ?? 20}`,
    `- 单文件最大字节数：${contextPolicy.maxFileBytes ?? 1048576}`,
    '',
    '## 执行策略',
    ...(executionLines.length ? executionLines : ['- 使用部门默认执行策略。']),
    '',
    `修订规则：${protocol.revisionPolicy}`,
    '',
  ].join('\n');
}

function charterRule(departmentId, draft) {
  const protocols = (draft.taskProtocols ?? []).map((item) =>
    `- ${item.name}（${item.id}）：${(item.intents ?? []).join('、') || item.purpose}；文件：\`.codebuddy/skills/${skillName(departmentId, 'protocol', item.id)}/SKILL.md\``,
  ).join('\n') || '- 当前没有固定规程，新任务按自由探索处理。';
  const lifecycle = (draft.businessLifecycle ?? []).map((item) =>
    `- ${typeof item === 'string' ? item : (item.name ?? item.id ?? JSON.stringify(item))}`,
  );
  const orchestration = draft.orchestrationPolicy ?? {};
  const capabilities = (draft.capabilityPlan ?? []).map((item) => {
    const status = item.kind === 'builtin'
      ? '已具备'
      : item.installPolicy === 'approval_required'
        ? '等待用户批准'
        : item.installPolicy === 'manual'
          ? '等待手动安装'
          : '等待安装并验证';
    return `- ${item.id}：${item.kind}；范围 ${item.scope}；安装策略 ${item.installPolicy}；状态：${status}`;
  });
  return [
    frontmatter(skillName(departmentId, 'department'), `${draft.departmentName}的部门章程、任务分流和审批边界。处理该部门职责内任务时使用。`),
    `# ${draft.departmentName} 部门章程`,
    '',
    `部门编号：${departmentId}`,
    `部门目标：${draft.purpose}`,
    '',
    '## 职责',
    ...(draft.responsibilities ?? []).map((item) => `- ${item}`),
    '',
    '## 范围外事项',
    ...(draft.outOfScope ?? []).map((item) => `- ${item}`),
    '',
    '## 审批边界',
    ...(draft.approvalBoundaries ?? []).map((item) => `- ${item}`),
    '',
    '## 任务模式',
    '- 直接执行：明确、低风险且无需固定规程的任务直接完成。',
    '- 单规程：只读取唯一命中的规程文件。',
    '- 组合规程：只组合确实命中的多个规程文件。',
    '- 自由探索：新任务或规程不适用时先探索，不强行套用。',
    '',
    '## 业务生命周期',
    ...(lifecycle.length ? lifecycle : ['- 当前没有固定业务生命周期。']),
    '',
    '## 编排策略',
    `- 模式：${orchestration.mode ?? 'adaptive'}`,
    `- 委派触发：${(orchestration.delegationTriggers ?? []).join('、') || '只有任务规模或专业性确有需要时才委派'}`,
    `- 最大并发执行者：${orchestration.maxConcurrentSubagents ?? 2}`,
    '- 角色表示责任边界，不代表所有任务必须经过固定多 Agent 流程。',
    '',
    '## 任务规程索引',
    protocols,
    '',
    '每次任务只读取当前命中的规程文件，不加载全部规程正文。',
    '',
    '## Skill 加载策略',
    '- 每个任务最多选择一个最匹配的主 Skill；没有匹配项时直接执行或自由探索。',
    '- 辅助 Skill 仅在任务确实需要额外能力且其命中条件明确成立时加载。',
    '- 不因 Skill 出现在能力计划中就视为已安装；只有实际存在并通过验证的 Skill 才能调用。',
    '',
    '## 能力计划',
    ...(capabilities.length ? capabilities : ['- 当前没有需要安装的额外能力。']),
    '- 需要账号、密钥或授权的能力只记录计划，不得擅自安装或绑定。',
    '',
    '## 维护规则',
    '- 新任务不强制创建规程；只有稳定、高频且值得复用的流程才建议沉淀。',
    '- 修改章程、规程、审批边界或能力计划前，必须先向用户展示变更并获得明确确认。',
    '- 已确认事实与原始聊天分离保存，不把密钥或敏感信息写入部门文件。',
    '',
  ].join('\n');
}

function codebuddyIndex(departmentId, draft, transactionId) {
  const protocols = (draft.taskProtocols ?? []).map((protocol) =>
    `- ${protocol.name}：\`.codebuddy/skills/${skillName(departmentId, 'protocol', protocol.id)}/SKILL.md\``,
  );
  return [
    `<!-- workbuddy-department:start ${departmentId} -->`,
    ...(transactionId ? [`<!-- workbuddy-transaction:${transactionId} -->`] : []),
    '# WorkBuddy 部门规则入口',
    '',
    '本工作区允许用户与 Agent 自由讨论部门设计。草案阶段只保存会话记录；只有用户明确确认创建后，才生成正式部门章程。',
    '',
    `## 已确认部门：${draft.departmentName}`,
    `- 部门编号：${departmentId}`,
    `- 部门 Skill：\`.codebuddy/skills/${skillName(departmentId, 'department')}/SKILL.md\``,
    `- 机器可读流程：\`.workbuddy-department/${departmentId}/workflow.json\``,
    ...(protocols.length ? ['', '### 规程文件索引', ...protocols] : []),
    '',
    '- 新任务先判断直接执行、单规程、组合规程或自由探索。',
    '- 新任务不必强行创建规程；只有稳定、高频且值得复用的流程才沉淀。',
    `<!-- workbuddy-department:end ${departmentId} -->`,
    '',
  ].join('\n');
}

export function buildWorkBuddyPackage({ departmentId, draft, workspace, confirmedAt = new Date().toISOString(), transactionId }) {
  const departmentSkillName = skillName(departmentId, 'department');
  const protocolEntries = (draft.taskProtocols ?? []).map((protocol) => {
    const name = skillName(departmentId, 'protocol', protocol.id);
    return {
      name,
      path: `.codebuddy/skills/${name}/SKILL.md`,
      description: `${protocol.purpose || protocol.name}；适用意图：${(protocol.intents ?? []).join('、') || '由 Agent 判断'}`,
      content: protocolSkill(departmentId, protocol),
    };
  });
  const skills = [
    {
      name: departmentSkillName,
      path: `.codebuddy/skills/${departmentSkillName}/SKILL.md`,
      description: `${draft.departmentName}的部门章程与任务分流`,
      content: charterRule(departmentId, draft),
    },
    ...protocolEntries,
  ];
  const packagePrefix = `.workbuddy-department/${departmentId}/`;
  const department = {
    schemaVersion: 1,
    platform: 'workbuddy',
    id: departmentId,
    name: draft.departmentName,
    kind: draft.kind,
    status: draft.lifecycle,
    purpose: draft.purpose,
    mission: draft.mission ?? null,
    workspace,
    responsibilities: draft.responsibilities,
    outOfScope: draft.outOfScope,
    approvalBoundaries: draft.approvalBoundaries,
    confirmedAt,
  };
  const workflow = {
    schemaVersion: 1,
    platform: 'workbuddy',
    revision: 1,
    semantics: 'task_execution',
    defaultFlow: draft.workflow,
    businessLifecycle: draft.businessLifecycle,
    taskProtocols: draft.taskProtocols,
    orchestrationPolicy: draft.orchestrationPolicy,
    capabilityPlan: draft.capabilityPlan,
  };
  const manifest = {
    id: departmentId,
    name: draft.departmentName,
    manifestVersion: '1.0',
    system_prompt_file: `.codebuddy/skills/${departmentSkillName}/SKILL.md`,
    rules: [],
    skills: skills.map(({ name, path: file, description }) => ({ name, path: file, description })),
    workspaces: [{ name: draft.departmentName, path: workspace }],
  };
  return new Map([
    ['CODEBUDDY.md', codebuddyIndex(departmentId, draft, transactionId)],
    ...skills.map(({ path: file, content }) => [file, content]),
    [`${packagePrefix}manifest.json`, json(manifest)],
    [`${packagePrefix}department.json`, json(department)],
    [`${packagePrefix}workflow.json`, json(workflow)],
    [`${packagePrefix}memory.md`, '# 已确认的部门记忆\n\n只保存稳定、经过确认的事实。\n'],
    [`${packagePrefix}skills-plan.md`, json({ schemaVersion: 1, platform: 'workbuddy', capabilities: draft.capabilityPlan })],
  ]);
}
