import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializeWorkBuddyWorkspace } from '../../../department-runtime/workbuddy-workspace-initializer.mjs';
import {
  confirmAndProvisionWorkBuddyDepartment,
  saveWorkBuddyDesignDraft,
} from '../../../department-runtime/workbuddy-session-service.mjs';

function authorDepartmentSpec(workspace) {
  return {
    departmentName: '作家部',
    kind: 'permanent',
    purpose: '创作小说并保持稳定的叙事风格',
    workspace,
    responsibilities: ['小说创作', '续写和润色'],
    outOfScope: ['未经确认的对外发布'],
    workflow: [
      '理解题材和本轮写作目标',
      '按克制、温暖的语气创作',
      '检查每段结尾是否带有部门署名',
    ],
    businessLifecycle: ['选题', '创作', '审核', '交付'],
    taskProtocols: [{
      id: 'novel_writing',
      name: '小说创作',
      intents: ['写小说', '续写章节', '润色小说'],
      purpose: '按固定语气完成小说段落',
      requiredInputs: ['题材', '人物和情节要求'],
      clarificationPolicy: '缺少题材或情节目标时先询问',
      steps: [
        '使用克制、温暖的叙事语气',
        '每一段回复后追加“本段落产自作家部”',
      ],
      qualityChecks: [{
        id: 'style_and_signature',
        description: '每一段都保持固定语气并带部门署名',
        method: 'deterministic',
        trigger: 'always',
      }],
      deliverables: ['小说段落'],
      completionCriteria: ['所有段落均带部门署名'],
      skills: [],
      skillPolicy: { primary: null, auxiliaries: [], maxAuxiliaries: 0 },
      contextPolicy: {
        mode: 'targeted',
        include: ['当前章节', '已确认人物和情节'],
        exclude: ['无关文件', '敏感信息'],
        maxFiles: 10,
        maxFileBytes: 65536,
      },
      revisionPolicy: '用户确认后修改',
    }],
    capabilityPlan: [],
    approvalBoundaries: ['对外发布前必须确认'],
    confirmedFacts: ['固定语气为克制、温暖的叙事语气'],
    historicalRules: ['每一段回复后追加“本段落产自作家部”'],
    contextSources: [{
      path: '当前章节和已确认人物设定',
      type: 'confirmed_department_context',
      confidence: 'high',
    }],
    openQuestions: [],
    mission: '持续提供稳定风格的小说创作',
    serviceCatalog: ['小说创作', '续写', '润色'],
    recurringWorkflows: ['按章节持续写作'],
    defaultProjects: [],
    taskTypes: ['小说创作任务'],
    lifecycle: 'active',
  };
}

describe('WorkBuddy 作家部门最小端到端验收', () => {
  it('creates the department and lets a fresh session inherit style and memory', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-author-e2e-'));
    initializeWorkBuddyWorkspace({ workspace });
    const spec = authorDepartmentSpec(workspace);

    const draftState = saveWorkBuddyDesignDraft({
      workspace,
      proposal: {
        departmentName: spec.departmentName,
        purpose: spec.purpose,
        responsibilities: spec.responsibilities,
        workflow: spec.workflow,
        confirmedFacts: spec.confirmedFacts,
        historicalRules: spec.historicalRules,
      },
    });
    expect(draftState.status).toBe('designing');

    const result = confirmAndProvisionWorkBuddyDepartment({
      workspace,
      departmentId: 'writers',
      draft: spec,
      confirmationMessage: '同意创建',
    });
    expect(result.status).toBe('completed');

    const charterPath = path.join(workspace, '.codebuddy/skills/writers-department/SKILL.md');
    const protocolPath = path.join(workspace, '.codebuddy/skills/writers-protocol-novel-writing/SKILL.md');
    const memoryPath = path.join(workspace, '.workbuddy-department/writers/memory.md');
    expect(existsSync(charterPath)).toBe(true);
    expect(existsSync(protocolPath)).toBe(true);
    expect(existsSync(memoryPath)).toBe(true);

    const charter = readFileSync(charterPath, 'utf8');
    const protocol = readFileSync(protocolPath, 'utf8');
    const memory = readFileSync(memoryPath, 'utf8');
    expect(charter).toContain('.workbuddy-department/writers/memory.md');
    expect(protocol).toContain('每一段回复后追加“本段落产自作家部”');
    expect(protocol).toContain('每一段都保持固定语气并带部门署名');
    expect(memory).toContain('固定语气为克制、温暖的叙事语气');
    expect(memory).toContain('每一段回复后追加“本段落产自作家部”');

    // A new WorkBuddy session starts from the generated department Skill and memory file.
    const freshSessionContext = `${charter}\n${memory}`;
    expect(freshSessionContext).toContain('克制、温暖的叙事语气');
    expect(freshSessionContext).toContain('本段落产自作家部');
  });
});
