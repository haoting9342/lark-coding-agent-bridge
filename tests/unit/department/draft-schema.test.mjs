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
  it('synthesizes a safe single-host topology and keeps task protocols separate', () => {
    const result = validateDepartmentDraft(permanentDraft(), { requireReady: true });

    expect(result.ok).toBe(true);
    expect(result.value.businessLifecycle).toEqual(['需求洞察', '内容运营']);
    expect(result.value.taskProtocols[0].steps).toContain('去除 AI 味');
    expect(result.value.organizationTopology.nodes).toHaveLength(1);
    expect(result.value.organizationTopology.nodes[0].role).toBe('primary');
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
