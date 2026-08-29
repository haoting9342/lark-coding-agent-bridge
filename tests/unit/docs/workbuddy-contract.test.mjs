import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assertDepartmentDraft } from '../../../department-runtime/department-draft-schema.mjs';

describe('WorkBuddy 中文使用文档', () => {
  it('documents the conversational confirmed creation workflow and official layout', async () => {
    const document = await readFile(new URL('../../../docs/workbuddy-department.md', import.meta.url), 'utf8');

    for (const phrase of [
      'workbuddy department init',
      'workbuddy department draft',
      'workbuddy department import',
      '--confirm-create',
      '--confirmation-message',
      '自由讨论',
      '同意创建',
      '直接执行',
      '单规程',
      '组合规程',
      '自由探索',
      '按需加载',
      '失败回滚',
      'CODEBUDDY.md',
      '.codebuddy/skills',
      'WorkBuddy 自身负责飞书接入',
    ]) {
      expect(document).toContain(phrase);
    }
    expect(document).not.toContain('.mdc');
    expect(document).not.toContain('工作区根目录 `AGENTS.md`');
  });

  it('ships a complete example accepted by the shared department schema', async () => {
    const raw = JSON.parse(await readFile(
      new URL('../../../docs/workbuddy-department-example.json', import.meta.url),
      'utf8',
    ));
    const { departmentId, ...draft } = raw;

    expect(departmentId).toBe('content');
    expect(() => assertDepartmentDraft(draft, { requireReady: true })).not.toThrow();
  });
});
