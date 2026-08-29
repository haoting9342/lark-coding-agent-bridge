import { describe, expect, it } from 'vitest';
import { buildWorkBuddyPackage } from '../../../department-runtime/workbuddy-package-writer.mjs';

const draft = {
  departmentName: '自媒体部门', kind: 'permanent', purpose: '负责内容生产', workspace: '/tmp/wb',
  responsibilities: ['选题'], outOfScope: ['未经确认发布'], workflow: ['理解', '执行'], businessLifecycle: [],
  taskProtocols: [{
    id: 'review', name: '内容审核', intents: ['审核稿件'], purpose: '审核', requiredInputs: ['稿件'],
    clarificationPolicy: '先澄清', steps: ['检查事实'],
    qualityChecks: [{ description: '完整', method: 'independent', trigger: 'risk_based' }],
    deliverables: ['意见'], completionCriteria: ['完成'], skills: ['drafting', 'fact_check'],
    contextPolicy: { mode: 'targeted', include: ['当前稿件'], exclude: ['无关文件'], maxFiles: 8, maxFileBytes: 4096 },
    skillPolicy: { primary: 'drafting', auxiliaries: [{ skill: 'fact_check', when: '涉及事实声明时' }], maxAuxiliaries: 1 },
    executionPolicy: { deliveryMode: 'primary_synthesized', failoverPolicy: 'manual', risk: 'normal', idempotent: true },
    revisionPolicy: '确认后修改',
  }],
  orchestrationPolicy: undefined,
  capabilityPlan: [{ id: 'drafting', kind: 'skill', scope: 'workspace', installPolicy: 'manual' }],
  approvalBoundaries: ['发布前确认'], confirmedFacts: [], historicalRules: [], contextSources: [], openQuestions: [],
  mission: '内容生产', serviceCatalog: ['内容'], recurringWorkflows: [], defaultProjects: [], taskTypes: ['内容'], lifecycle: 'active',
};

describe('WorkBuddy package writer', () => {
  it('creates official WorkBuddy files and keeps protocol bodies separate', () => {
    const files = buildWorkBuddyPackage({ departmentId: 'content', draft, workspace: '/tmp/wb' });
    expect(files.has('CODEBUDDY.md')).toBe(true);
    expect(files.has('.codebuddy/skills/content-department/SKILL.md')).toBe(true);
    expect(files.has('.codebuddy/skills/content-protocol-review/SKILL.md')).toBe(true);
    expect([...files.keys()].some((file) => file.endsWith('.mdc'))).toBe(false);
    expect(files.get('CODEBUDDY.md')).toContain('content-protocol-review/SKILL.md');
    expect(files.get('CODEBUDDY.md')).not.toContain('检查事实');
    const charter = files.get('.codebuddy/skills/content-department/SKILL.md');
    expect(charter).toContain('.codebuddy/skills/content-protocol-review/SKILL.md');
    expect(charter).toContain('## 业务生命周期');
    expect(charter).toContain('## 编排策略');
    expect(charter).toContain('## Skill 加载策略');
    expect(charter).toContain('辅助 Skill 仅在');
    expect(charter).toContain('## 能力计划');
    expect(charter).toContain('状态：等待手动安装');
    expect(charter).toContain('## 维护规则');
    const protocol = files.get('.codebuddy/skills/content-protocol-review/SKILL.md');
    expect(protocol).toContain('检查事实');
    expect(protocol).toContain('当前稿件');
    expect(protocol).toContain('最大文件数：8');
    expect(protocol).toContain('independent；触发：risk_based');
    expect(protocol).toContain('辅助 Skill 上限：1');
    expect(protocol).toContain('涉及事实声明时');
    expect(protocol).toContain('交付方式：primary_synthesized');
    const manifest = JSON.parse(files.get('.workbuddy-department/content/manifest.json'));
    expect(manifest.manifestVersion).toBe('1.0');
    expect(manifest.rules).toEqual([]);
    expect(manifest.skills.find((skill) => skill.name === 'content-protocol-review').description).toContain('审核稿件');
    expect(manifest.skills.some((skill) => skill.name === 'drafting')).toBe(false);
    expect(files.get('.workbuddy-department/content/skills-plan.md')).toContain('drafting');
  });
});
