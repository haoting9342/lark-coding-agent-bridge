import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkBuddyDepartment } from '../../../department-runtime/workbuddy-department-installer.mjs';

describe('WorkBuddy department installer', () => {
  it('writes a local department package without Feishu routing', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-department-'));
    const result = createWorkBuddyDepartment({
      departmentId: 'content',
      departmentName: '自媒体部门',
      purpose: '负责内容策划和发布',
      responsibilities: ['制定选题', '检查发布内容'],
      workspace,
      taskProtocols: [{
        id: 'content_review',
        name: '内容审核',
        intents: ['审核稿件'],
        purpose: '检查稿件',
        requiredInputs: ['稿件'],
        clarificationPolicy: '信息不足时先询问',
        steps: ['检查事实'],
        qualityChecks: ['无明显错误'],
        deliverables: ['审核意见'],
        completionCriteria: ['完成审核'],
        skills: [],
        revisionPolicy: '用户确认后更新',
      }],
    });

    expect(result.platform).toBe('workbuddy');
    expect(readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8')).toContain('内容审核');
    expect(readFileSync(path.join(result.packageRoot, 'department.json'), 'utf8')).toContain('"platform": "workbuddy"');
    expect(readFileSync(path.join(result.packageRoot, 'workflow.json'), 'utf8')).not.toContain('chatId');
  });
});
