import { describe, expect, it } from 'vitest';
import { validateDepartmentDraft } from '../../../department-runtime/department-draft-schema.mjs';

function permanentDraft() {
  return {
    departmentName: '内容设计部',
    kind: 'permanent',
    purpose: '持续产出可直接使用的专业内容',
    workspace: '/tmp/content-department',
    responsibilities: ['内容研究', '内容交付'],
    outOfScope: ['未经确认的对外发布'],
    workflow: ['理解任务', '匹配规程', '执行', '质量检查', '交付'],
    businessLifecycle: ['需求洞察', '内容运营'],
    taskProtocols: [{
      id: 'create_outline',
      name: '课程大纲',
      intents: ['写课程大纲'],
      purpose: '输出可直接使用的大纲',
      requiredInputs: ['课程目标'],
      clarificationPolicy: '目标或受众不清楚时先澄清',
      steps: ['整合知识', '设计结构', '去除 AI 味', '复核'],
      qualityChecks: ['结构合理', '表达自然'],
      deliverables: ['课程大纲'],
      completionCriteria: ['可以直接使用'],
      skills: [],
      revisionPolicy: '按反馈修改后重新检查',
    }],
    capabilityPlan: [],
    approvalBoundaries: ['对外发布'],
    confirmedFacts: [],
    historicalRules: [],
    contextSources: [],
    openQuestions: [],
    mission: '持续提供高质量内容服务',
    serviceCatalog: ['课程大纲'],
    recurringWorkflows: [],
    defaultProjects: [],
    taskTypes: ['大纲制作'],
  };
}

describe('department draft schema', () => {
  it('allows a ready department with no predefined task protocol', () => {
    const draft = permanentDraft();
    draft.taskProtocols = [];

    const result = validateDepartmentDraft(draft, { requireReady: true });

    expect(result.ok).toBe(true);
  });

  it('synthesizes a safe single-host topology and keeps task protocols separate', () => {
    const result = validateDepartmentDraft(permanentDraft(), { requireReady: true });

    expect(result.ok).toBe(true);
    expect(result.value.businessLifecycle).toEqual(['需求洞察', '内容运营']);
    expect(result.value.taskProtocols[0].steps).toContain('去除 AI 味');
    expect(result.value.organizationTopology.nodes).toHaveLength(1);
    expect(result.value.organizationTopology.primaryNodeId).toBe('local_primary');
    expect(result.value.organizationTopology.nodes[0].id).toBe('local_primary');
    expect(result.value.organizationTopology.nodes[0].role).toBe('primary');
    expect(result.value.orchestrationPolicy).toMatchObject({
      mode: 'adaptive',
      roleSemantics: 'responsibility_not_process',
      maxConcurrentSubagents: 2,
      maxExecutionAgentsPerWorkItem: 1,
      maxIndependentReviewsPerMilestone: 1,
      maxReviewRounds: 1,
      defaultForkTurns: 'none',
      recentTurnLimit: 3,
      allowFullHistoryFork: false,
      deterministicChecksFirst: true,
      largeArtifactTransfer: 'path_and_summary',
    });
    expect(result.value.taskProtocols[0].qualityChecks).toEqual([
      {
        id: 'check_1',
        description: '结构合理',
        method: 'coordinator',
        trigger: 'always',
      },
      {
        id: 'check_2',
        description: '表达自然',
        method: 'coordinator',
        trigger: 'always',
      },
    ]);
  });

  it('normalizes structured quality checks without turning roles into agent processes', () => {
    const draft = permanentDraft();
    draft.taskProtocols[0].qualityChecks = [
      ' 结构合理 ',
      {
        id: 'publish_approval',
        description: ' 对外发布前取得明确确认 ',
        method: 'human',
        trigger: 'before_external_action',
      },
    ];

    const result = validateDepartmentDraft(draft, { requireReady: true });

    expect(result.ok).toBe(true);
    expect(result.value.taskProtocols[0].qualityChecks).toEqual([
      {
        id: 'check_1',
        description: '结构合理',
        method: 'coordinator',
        trigger: 'always',
      },
      {
        id: 'publish_approval',
        description: '对外发布前取得明确确认',
        method: 'human',
        trigger: 'before_external_action',
      },
    ]);
  });

  it('derives targeted context and one-primary-skill policies from existing protocols', () => {
    const draft = permanentDraft();
    draft.taskProtocols[0].skills = ['outline-writing', 'web-research', 'copy-editing'];

    const result = validateDepartmentDraft(draft, { requireReady: true });

    expect(result.ok).toBe(true);
    expect(result.value.taskProtocols[0].contextPolicy).toMatchObject({
      mode: 'targeted',
      maxFiles: 20,
      maxFileBytes: 1024 * 1024,
    });
    expect(result.value.taskProtocols[0].skillPolicy).toEqual({
      primary: 'outline-writing',
      auxiliaries: [
        { skill: 'web-research', when: '任务明确需要该能力时' },
        { skill: 'copy-editing', when: '任务明确需要该能力时' },
      ],
      maxAuxiliaries: 2,
    });
  });

  it('rejects unsafe or unknown adaptive orchestration settings', () => {
    const draft = permanentDraft();
    draft.orchestrationPolicy = {
      mode: 'adaptive',
      roleSemantics: 'responsibility_not_process',
      delegationTriggers: ['independent_parallel_work'],
      maxConcurrentSubagents: 9,
      maxExecutionAgentsPerWorkItem: 1,
      maxIndependentReviewsPerMilestone: 1,
      maxReviewRounds: 1,
      defaultForkTurns: 'all',
      recentTurnLimit: 3,
      allowFullHistoryFork: false,
      deterministicChecksFirst: true,
      largeArtifactTransfer: 'path_and_summary',
      modelRouting: {
        lookup: 'lightweight',
        execution: 'standard',
        complexDecision: 'critical',
        independentReview: 'critical',
      },
      surprise: true,
    };

    const result = validateDepartmentDraft(draft, { requireReady: true });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/orchestrationPolicy/surprise', code: 'UNKNOWN_FIELD' }),
      expect.objectContaining({ path: '/orchestrationPolicy/maxConcurrentSubagents', code: 'INVALID_ORCHESTRATION_LIMIT' }),
      expect.objectContaining({ path: '/orchestrationPolicy/defaultForkTurns', code: 'INVALID_FORK_POLICY' }),
    ]));
  });

  it('rejects a non-object model routing policy without coercing it', () => {
    const draft = permanentDraft();
    draft.orchestrationPolicy = {
      mode: 'adaptive',
      modelRouting: 'critical',
    };

    const result = validateDepartmentDraft(draft, { requireReady: true });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({
      path: '/orchestrationPolicy/modelRouting',
      code: 'INVALID_MODEL_ROUTING',
    }));
  });

  it('requires a project business lifecycle before final confirmation', () => {
    const draft = {
      ...permanentDraft(),
      departmentName: '830公开课项目部',
      kind: 'project',
      objective: '完成公开课交付',
      deadline: '2026-08-30',
      milestones: ['大纲', 'PPT', '彩排'],
      deliverables: ['大纲', 'PPT'],
      doneWhen: ['材料可用并完成授课'],
      businessLifecycle: [],
      temporaryCapabilities: [],
      parentDepartment: null,
      closeout: { options: ['archive', 'extend', 'promote'], requireReport: true },
    };
    for (const key of ['mission', 'serviceCatalog', 'recurringWorkflows', 'defaultProjects', 'taskTypes']) {
      delete draft[key];
    }

    const result = validateDepartmentDraft(draft, { requireReady: true });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: 'BUSINESS_LIFECYCLE_REQUIRED' }));
  });
});
