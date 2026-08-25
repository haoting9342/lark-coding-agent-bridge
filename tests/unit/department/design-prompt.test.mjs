import { describe, expect, it } from 'vitest';
import { buildDepartmentDesignPrompt } from '../../../department-runtime/department-design-prompt.mjs';

describe('department design prompt adaptive orchestration contract', () => {
  it('requires typed checks and separates professional roles from Agent processes', () => {
    const prompt = buildDepartmentDesignPrompt({
      state: {
        key: 'oc_test',
        status: 'designing',
        phase: 'discussion',
        version: 2,
        draft: { departmentName: '内容设计部', kind: 'permanent', openQuestions: [] },
      },
      userText: '继续完善部门流程',
      actor: { id: 'ou_owner', role: 'owner' },
      contextInventory: { workspace: '/tmp/content', sources: [], capabilities: [] },
      draftCli: '/opt/department-draft-cli.mjs',
      storeFile: '/tmp/department-store.json',
    });

    expect(prompt).toContain('orchestrationPolicy');
    expect(prompt).toContain('responsibility_not_process');
    expect(prompt).toContain('deterministic|coordinator|independent|human');
    expect(prompt).toContain('fork_turns="none"');
    expect(prompt).toContain('角色不等于 Agent 实例');
    expect(prompt).toContain('不得仅因存在书面计划');
    expect(prompt).toContain('PPT、大纲、报告、研究或内容生产');
  });
});
