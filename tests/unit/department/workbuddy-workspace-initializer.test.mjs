import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as initializer from '../../../department-runtime/workbuddy-workspace-initializer.mjs';
import { signWorkBuddyRollbackRecord } from '../../../department-runtime/workbuddy-provisioner.mjs';

describe('WorkBuddy workspace initializer safety', () => {
  it('rejects the filesystem root before writing any project rules', () => {
    const filesystemRoot = path.parse(process.cwd()).root;

    expect(() => initializer.validateWorkBuddyWorkspace(filesystemRoot)).toThrow(/危险目录/);
  });

  it('rejects a nested .codebuddy symlink before writing outside the workspace', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-init-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'workbuddy-outside-'));
    symlinkSync(outside, path.join(workspace, '.codebuddy'), 'dir');

    expect(() => initializer.initializeWorkBuddyWorkspace({ workspace })).toThrow(/符号链接/);
    expect(existsSync(path.join(outside, 'skills/department-designer/SKILL.md'))).toBe(false);
  });

  it('recovers an interrupted department transaction during initialization', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-init-'));
    const transactionId = '33333333-3333-4333-8333-333333333333';
    const transactionRoot = path.join(workspace, '.workbuddy-department/transactions');
    const packageRoot = path.join(workspace, '.workbuddy-department/content');
    const pendingRoot = path.join(workspace, `.workbuddy-department/.pending-content-${transactionId}`);
    const original = '# 原有内容\n';
    const interrupted = `${original}\n<!-- workbuddy-department:start content -->\n<!-- workbuddy-transaction:${transactionId} -->\n# 中断内容\n<!-- workbuddy-department:end content -->\n`;
    mkdirSync(transactionRoot, { recursive: true });
    mkdirSync(pendingRoot, { recursive: true });
    writeFileSync(path.join(workspace, 'CODEBUDDY.md'), interrupted);
    writeFileSync(path.join(transactionRoot, `${transactionId}.rollback.json`), JSON.stringify(
      signWorkBuddyRollbackRecord(workspace, {
      schemaVersion: 1,
      platform: 'workbuddy',
      status: 'started',
      transactionId,
      departmentId: 'content',
      startedAt: '2026-08-29T00:00:00.000Z',
      packageFiles: ['manifest.json', 'department.json', 'workflow.json', 'memory.md', 'skills-plan.md']
        .map((relative) => ({ relative, sha256: '0'.repeat(64) })),
      relativeSnapshots: [{
        relative: 'CODEBUDDY.md',
        existed: true,
        mode: 0o600,
        originalSize: Buffer.byteLength(original),
        originalSha256: createHash('sha256').update(original).digest('hex'),
        writtenSha256: createHash('sha256').update(interrupted).digest('hex'),
      }],
      }),
    ));

    initializer.initializeWorkBuddyWorkspace({ workspace });

    const index = readFileSync(path.join(workspace, 'CODEBUDDY.md'), 'utf8');
    expect(index).toContain('# 原有内容');
    expect(index).not.toContain('# 中断内容');
    expect(existsSync(packageRoot)).toBe(false);
    expect(existsSync(pendingRoot)).toBe(false);
  });

  it('makes the conversational gate explicit in the generated WorkBuddy skill', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-init-'));

    initializer.initializeWorkBuddyWorkspace({ workspace });

    const skill = readFileSync(path.join(workspace, '.codebuddy/skills/department-designer/SKILL.md'), 'utf8');
    expect(skill).toContain('禁止调用旧版 `workbuddy create`');
    expect(skill).toContain('必须先通过 `workbuddy department draft` 保存至少一轮讨论草案');
  });
});
