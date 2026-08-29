import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  runWorkBuddyDepartmentDraft,
  runWorkBuddyDepartmentImport,
  runWorkBuddyDepartmentInit,
} from '../../../src/cli/commands/workbuddy-department.js';
import { runWorkBuddyCreate } from '../../../src/cli/commands/workbuddy.js';

function readySpec(workspace: string) {
  return {
    departmentId: 'content', departmentName: '内容部', kind: 'permanent', purpose: '内容生产', workspace,
    responsibilities: ['选题'], outOfScope: [], workflow: ['理解', '执行'], businessLifecycle: [],
    taskProtocols: [], capabilityPlan: [], approvalBoundaries: ['发布前确认'], confirmedFacts: [],
    historicalRules: [], contextSources: [], openQuestions: [], mission: '内容生产', serviceCatalog: ['内容'],
    recurringWorkflows: [], defaultProjects: [], taskTypes: ['内容'], lifecycle: 'active',
  };
}

describe('WorkBuddy department CLI', () => {
  it('initializes a conversational design assistant without creating a formal department', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-cli-'));

    await runWorkBuddyDepartmentInit({ workspace, output: () => {} });

    expect(existsSync(path.join(workspace, '.codebuddy/skills/department-designer/SKILL.md'))).toBe(true);
    expect(existsSync(path.join(workspace, '.workbuddy-department/sessions'))).toBe(true);
    expect(existsSync(path.join(workspace, '.workbuddy-department/content/manifest.json'))).toBe(false);
    const entry = readFileSync(path.join(workspace, 'CODEBUDDY.md'), 'utf8');
    expect(entry).toContain('与用户自由讨论');
    expect(entry).toContain('.codebuddy/skills/department-designer/SKILL.md');
  });

  it('refuses to create formal files without explicit confirmation', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-cli-'));
    const spec = path.join(workspace, '部门规格.json');
    writeFileSync(spec, JSON.stringify(readySpec(workspace)));

    await expect(runWorkBuddyDepartmentImport({ workspace, spec, confirmCreate: false, output: () => {} }))
      .rejects.toThrow(/confirm-create/);
    expect(existsSync(path.join(workspace, '.workbuddy-department/content'))).toBe(false);
  });

  it('does not accept confirmation evidence embedded in a legacy spec file', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-cli-'));
    const spec = path.join(workspace, '部门规格.json');
    writeFileSync(spec, JSON.stringify({
      ...readySpec(workspace),
      confirmCreate: true,
      confirmationMessage: '同意创建',
    }));

    await expect(runWorkBuddyCreate({ spec })).rejects.toThrow(/明确确认/);
    expect(existsSync(path.join(workspace, '.workbuddy-department/content'))).toBe(false);
  });

  it('persists an incomplete conversational draft without creating formal files', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-cli-'));
    const spec = path.join(workspace, '部分草案.json');
    writeFileSync(spec, JSON.stringify({ departmentName: '内容部' }));

    const state = await runWorkBuddyDepartmentDraft({ workspace, spec, output: () => {} });

    writeFileSync(spec, JSON.stringify({ purpose: '持续生产内容' }));
    const updated = await runWorkBuddyDepartmentDraft({ workspace, spec, output: () => {} });

    expect(state.status).toBe('designing');
    expect(updated.revision).toBe(2);
    const persisted = JSON.parse(readFileSync(path.join(workspace, '.workbuddy-department/sessions/current.json'), 'utf8'));
    expect(persisted.draft.departmentName).toBe('内容部');
    expect(persisted.draft.purpose).toBe('持续生产内容');
    expect(persisted.history).toHaveLength(2);
    expect(existsSync(path.join(workspace, '.workbuddy-department/content'))).toBe(false);
  });

  it('creates the confirmed WorkBuddy package from one shared department spec', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-cli-'));
    const spec = path.join(workspace, '部门规格.json');
    writeFileSync(spec, JSON.stringify(readySpec(workspace)));

    const result = await runWorkBuddyDepartmentImport({
      workspace, spec, confirmCreate: true, confirmationMessage: '同意创建', output: () => {},
    });

    expect(result.status).toBe('completed');
    expect(existsSync(path.join(workspace, '.codebuddy/skills/content-department/SKILL.md'))).toBe(true);
    expect(existsSync(path.join(workspace, '.workbuddy-department/content/manifest.json'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(workspace, '.workbuddy-department/sessions/current.json'), 'utf8')).status).toBe('confirmed');
  });

  it('rejects a vague confirmation even when the CLI flag is present', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-cli-'));
    const spec = path.join(workspace, '部门规格.json');
    writeFileSync(spec, JSON.stringify(readySpec(workspace)));

    await expect(runWorkBuddyDepartmentImport({
      workspace, spec, confirmCreate: true, confirmationMessage: '可以', output: () => {},
    })).rejects.toThrow(/明确确认/);
    expect(existsSync(path.join(workspace, '.workbuddy-department/content'))).toBe(false);
  });

  it('starts a fresh draft after a previous department was confirmed', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-cli-'));
    const spec = path.join(workspace, '部门规格.json');
    writeFileSync(spec, JSON.stringify(readySpec(workspace)));
    await runWorkBuddyDepartmentImport({
      workspace, spec, confirmCreate: true, confirmationMessage: '同意创建', output: () => {},
    });
    writeFileSync(spec, JSON.stringify({ departmentName: '研究部' }));

    const next = await runWorkBuddyDepartmentDraft({ workspace, spec, output: () => {} });

    expect(next.status).toBe('designing');
    expect(next.revision).toBe(1);
    expect(next.draft).toMatchObject({ departmentName: '研究部', workspace });
    expect(next.draft).not.toHaveProperty('purpose');
  });
});
