import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkBuddyProvisioner } from '../../../department-runtime/workbuddy-provisioner.mjs';
import * as workbuddyProvisioning from '../../../department-runtime/workbuddy-provisioner.mjs';
import { acquireDirectoryLock } from '../../../department-runtime/directory-lock.mjs';
import { buildWorkBuddyPackage } from '../../../department-runtime/workbuddy-package-writer.mjs';

function draft(workspace) {
  return { departmentName: '内容部', kind: 'permanent', purpose: '内容生产', workspace, responsibilities: ['选题'], outOfScope: [], workflow: ['理解', '执行'], businessLifecycle: [], taskProtocols: [], capabilityPlan: [], approvalBoundaries: ['发布前确认'], confirmedFacts: [], historicalRules: [], contextSources: [], openQuestions: [], mission: '内容生产', serviceCatalog: ['内容'], recurringWorkflows: [], defaultProjects: [], taskTypes: ['内容'], lifecycle: 'active' };
}

const dummyPackageFiles = ['manifest.json', 'department.json', 'workflow.json', 'memory.md', 'skills-plan.md']
  .map((relative) => ({ relative, sha256: '0'.repeat(64) }));

describe('WorkBuddy provisioner', () => {
  it('writes package and receipt without chat routing', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const result = new WorkBuddyProvisioner().provision({ workspace, departmentId: 'content', draft: draft(workspace) });
    expect(existsSync(path.join(workspace, 'CODEBUDDY.md'))).toBe(true);
    expect(existsSync(path.join(workspace, '.codebuddy/skills'))).toBe(true);
    expect(existsSync(path.join(workspace, '.workbuddy-department/content/workflow.json'))).toBe(true);
    expect(readFileSync(path.join(workspace, '.workbuddy-department/content/workflow.json'), 'utf8')).not.toContain('chatId');
    expect(result.status).toBe('completed');
    const rollback = readFileSync(path.join(
      workspace, '.workbuddy-department/transactions', `${result.transactionId}.rollback.json`,
    ), 'utf8');
    expect(rollback).not.toContain('contentBase64');
    expect(rollback).not.toContain('snapshots');
  });

  it('preserves existing CODEBUDDY content and appends one marked department section', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    writeFileSync(path.join(workspace, 'CODEBUDDY.md'), '# 用户原有规则\n\n不要改写。\n');

    new WorkBuddyProvisioner().provision({ workspace, departmentId: 'content', draft: draft(workspace) });

    const content = readFileSync(path.join(workspace, 'CODEBUDDY.md'), 'utf8');
    expect(content).toContain('# 用户原有规则');
    expect(content).toContain('<!-- workbuddy-department:start content -->');
    expect(content.match(/workbuddy-department:start content/g)).toHaveLength(1);
  });

  it.each([
    '# 没有末尾换行',
    '# 保留末尾空格   ',
    '# 保留多个换行\n\n\n',
  ])('preserves every original CODEBUDDY byte before the appended section', (original) => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    writeFileSync(path.join(workspace, 'CODEBUDDY.md'), original);

    new WorkBuddyProvisioner().provision({ workspace, departmentId: 'content', draft: draft(workspace) });

    expect(readFileSync(path.join(workspace, 'CODEBUDDY.md'), 'utf8').startsWith(original)).toBe(true);
  });

  it('rejects a duplicate department without changing existing files', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const provisioner = new WorkBuddyProvisioner();
    provisioner.provision({ workspace, departmentId: 'content', draft: draft(workspace) });
    const original = readFileSync(path.join(workspace, 'CODEBUDDY.md'), 'utf8');

    expect(() => provisioner.provision({ workspace, departmentId: 'content', draft: draft(workspace) })).toThrow(/already exists/);
    expect(readFileSync(path.join(workspace, 'CODEBUDDY.md'), 'utf8')).toBe(original);
  });

  it('restores existing files and records a failed transaction when a write fails', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const indexPath = path.join(workspace, 'CODEBUDDY.md');
    const original = '# 用户原有规则   \n\n\n';
    writeFileSync(indexPath, original);
    let activeRollback = '';
    const writer = (file, content) => {
      if (file.endsWith('content-department/SKILL.md')) {
        const rollback = readdirSync(path.join(workspace, '.workbuddy-department/transactions'))
          .find((name) => name.endsWith('.rollback.json'));
        activeRollback = readFileSync(path.join(workspace, '.workbuddy-department/transactions', rollback), 'utf8');
        throw new Error('simulated write failure');
      }
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    };

    expect(() => new WorkBuddyProvisioner({ writer }).provision({
      workspace, departmentId: 'content', draft: draft(workspace),
    })).toThrow('simulated write failure');

    expect(readFileSync(indexPath, 'utf8')).toBe(original);
    expect(activeRollback).not.toContain('contentBase64');
    expect(activeRollback).not.toContain(Buffer.from(original).toString('base64'));
    expect(existsSync(path.join(workspace, '.workbuddy-department/content'))).toBe(false);
    const receipts = readdirSync(path.join(workspace, '.workbuddy-department/transactions'))
      .filter((name) => name.endsWith('.json') && !name.endsWith('.rollback.json'));
    expect(receipts).toHaveLength(1);
    expect(JSON.parse(readFileSync(path.join(workspace, '.workbuddy-department/transactions', receipts[0]), 'utf8')).status).toBe('failed');
    const rollback = readdirSync(path.join(workspace, '.workbuddy-department/transactions'))
      .find((name) => name.endsWith('.rollback.json'));
    const rollbackContent = readFileSync(path.join(workspace, '.workbuddy-department/transactions', rollback), 'utf8');
    expect(rollbackContent).not.toContain('contentBase64');
    expect(rollbackContent).not.toContain('snapshots');
  });

  it('finalizes instead of rolling back when the first receipt write fails after promotion', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    let receiptWrites = 0;
    const receiptWriter = (file, content) => {
      receiptWrites += 1;
      if (receiptWrites === 1) throw new Error('simulated receipt failure after promotion');
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
    };

    const result = new WorkBuddyProvisioner({ receiptWriter }).provision({
      workspace, departmentId: 'content', draft: draft(workspace),
    });

    expect(result.status).toBe('completed');
    expect(result.recoveredAfterCommitError).toBe(true);
    expect(existsSync(path.join(workspace, 'CODEBUDDY.md'))).toBe(true);
    expect(existsSync(path.join(workspace, '.workbuddy-department/content/workflow.json'))).toBe(true);
    const rollback = JSON.parse(readFileSync(path.join(
      workspace, '.workbuddy-department/transactions', `${result.transactionId}.rollback.json`,
    ), 'utf8'));
    expect(rollback.status).toBe('completed');
  });

  it('rejects nested symlinks before writing outside the workspace', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const outside = mkdtempSync(path.join(tmpdir(), 'workbuddy-outside-'));
    symlinkSync(outside, path.join(workspace, '.codebuddy'), 'dir');

    expect(() => new WorkBuddyProvisioner().provision({
      workspace, departmentId: 'content', draft: draft(workspace),
    })).toThrow(/symbolic link|符号链接/i);

    expect(existsSync(path.join(outside, 'skills/content-department/SKILL.md'))).toBe(false);
  });

  it('rejects concurrent provisioning while the workspace transaction lock is active', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const lockPath = path.join(workspace, '.workbuddy-department/transactions/.provision.lock');
    const release = acquireDirectoryLock(lockPath);

    try {
      expect(() => new WorkBuddyProvisioner().provision({
        workspace, departmentId: 'content', draft: draft(workspace),
      })).toThrow(/transaction|事务|active/i);
    } finally {
      release();
    }
    expect(existsSync(path.join(workspace, '.workbuddy-department/content'))).toBe(false);
  });

  it('does not delete a same-name department directory created before promotion', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const packageRoot = path.join(workspace, '.workbuddy-department/content');
    const foreignFile = path.join(packageRoot, 'foreign.txt');
    const writer = (file, content) => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
      if (file.endsWith('.codebuddy/skills/content-department/SKILL.md')) {
        mkdirSync(packageRoot, { recursive: true });
        writeFileSync(foreignFile, '由另一进程创建');
      }
    };

    expect(() => new WorkBuddyProvisioner({ writer }).provision({
      workspace, departmentId: 'content', draft: draft(workspace),
    })).toThrow();

    expect(readFileSync(foreignFile, 'utf8')).toBe('由另一进程创建');
    expect(existsSync(path.join(workspace, 'CODEBUDDY.md'))).toBe(false);
  });

  it('does not overwrite CODEBUDDY changes made after the transaction snapshot', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const indexPath = path.join(workspace, 'CODEBUDDY.md');
    writeFileSync(indexPath, '# 原始内容\n');
    const writer = (file, content) => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, content);
      if (file.includes('.pending-content-') && file.endsWith('skills-plan.md')) {
        writeFileSync(indexPath, '# 另一进程的新内容\n');
      }
    };

    expect(() => new WorkBuddyProvisioner({ writer }).provision({
      workspace, departmentId: 'content', draft: draft(workspace),
    })).toThrow(/changed|conflict|并发|变化/i);

    expect(readFileSync(indexPath, 'utf8')).toBe('# 另一进程的新内容\n');
    expect(existsSync(path.join(workspace, '.workbuddy-department/content'))).toBe(false);
    expect(readdirSync(path.join(workspace, '.workbuddy-department')).some((name) => name.startsWith('.pending-'))).toBe(false);
  });

  it('recovers an interrupted transaction from its persistent rollback record', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const indexPath = path.join(workspace, 'CODEBUDDY.md');
    const skillPath = path.join(workspace, '.codebuddy/skills/content-department/SKILL.md');
    const packageRoot = path.join(workspace, '.workbuddy-department/content');
    const transactionRoot = path.join(workspace, '.workbuddy-department/transactions');
    const original = '# 原有规则\n';
    const transactionId = '11111111-1111-4111-8111-111111111111';
    const pendingRoot = path.join(workspace, `.workbuddy-department/.pending-content-${transactionId}`);
    const interruptedIndex = `${original}\n<!-- workbuddy-department:start content -->\n<!-- workbuddy-transaction:${transactionId} -->\n# 中断后的内容\n<!-- workbuddy-department:end content -->\n`;
    const interruptedSkill = '---\nname: content-department\n---\n\n# 半成品章程\n';
    mkdirSync(path.dirname(skillPath), { recursive: true });
    mkdirSync(pendingRoot, { recursive: true });
    mkdirSync(transactionRoot, { recursive: true });
    writeFileSync(indexPath, interruptedIndex);
    writeFileSync(skillPath, interruptedSkill);
    writeFileSync(path.join(pendingRoot, 'manifest.json'), '{}');
    writeFileSync(path.join(transactionRoot, `${transactionId}.rollback.json`), JSON.stringify(
      workbuddyProvisioning.signWorkBuddyRollbackRecord(workspace, {
      schemaVersion: 1,
      platform: 'workbuddy',
      status: 'started',
      transactionId,
      departmentId: 'content',
      startedAt: '2026-08-29T00:00:00.000Z',
      packageFiles: dummyPackageFiles,
      relativeSnapshots: [
        {
          relative: 'CODEBUDDY.md',
          existed: true,
          mode: 0o600,
          originalSize: Buffer.byteLength(original),
          originalSha256: createHash('sha256').update(original).digest('hex'),
          writtenSha256: createHash('sha256').update(interruptedIndex).digest('hex'),
        },
        {
          relative: '.codebuddy/skills/content-department/SKILL.md',
          existed: false,
          writtenSha256: createHash('sha256').update(interruptedSkill).digest('hex'),
        },
      ],
      }),
    ));
    const abandonedLock = path.join(transactionRoot, '.provision.lock');
    mkdirSync(abandonedLock);
    writeFileSync(path.join(abandonedLock, 'owner.json'), JSON.stringify({
      schemaVersion: 1,
      pid: 2147483647,
      token: 'abandoned',
      createdAt: Date.now(),
    }));

    const result = workbuddyProvisioning.recoverInterruptedWorkBuddyTransactions(workspace);

    expect(result.recovered).toBe(1);
    expect(readFileSync(indexPath, 'utf8')).toBe(original);
    expect(existsSync(skillPath)).toBe(false);
    expect(existsSync(packageRoot)).toBe(false);
    expect(existsSync(pendingRoot)).toBe(false);
    const recovered = readFileSync(path.join(transactionRoot, `${transactionId}.rollback.json`), 'utf8');
    expect(recovered).not.toContain('contentBase64');
    expect(recovered).not.toContain('relativeSnapshots');
  });

  it('finalizes a committed package after interruption without rolling it back', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const transactionId = '55555555-5555-4555-8555-555555555555';
    const transactionRoot = path.join(workspace, '.workbuddy-department/transactions');
    const files = buildWorkBuddyPackage({
      departmentId: 'content', draft: draft(workspace), workspace, transactionId,
    });
    const snapshots = [];
    const packageFiles = [];
    for (const [relative, content] of files) {
      const target = path.join(workspace, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
      if (!relative.startsWith('.workbuddy-department/content/')) {
        snapshots.push({
          relative,
          existed: false,
          writtenSha256: createHash('sha256').update(content).digest('hex'),
        });
      } else {
        packageFiles.push({
          relative: relative.slice('.workbuddy-department/content/'.length),
          sha256: createHash('sha256').update(content).digest('hex'),
        });
      }
    }
    mkdirSync(transactionRoot, { recursive: true });
    writeFileSync(path.join(transactionRoot, `${transactionId}.rollback.json`), JSON.stringify(
      workbuddyProvisioning.signWorkBuddyRollbackRecord(workspace, {
      schemaVersion: 1,
      platform: 'workbuddy',
      status: 'started',
      transactionId,
      departmentId: 'content',
      startedAt: '2026-08-29T00:00:00.000Z',
      packageFiles,
      relativeSnapshots: snapshots,
      }),
    ));

    const result = workbuddyProvisioning.recoverInterruptedWorkBuddyTransactions(workspace);

    expect(result.recovered).toBe(1);
    expect(existsSync(path.join(workspace, '.workbuddy-department/content'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(transactionRoot, `${transactionId}.json`), 'utf8')).status).toBe('completed');
    const rollback = JSON.parse(readFileSync(path.join(transactionRoot, `${transactionId}.rollback.json`), 'utf8'));
    expect(rollback.status).toBe('completed');
    expect(rollback.recoveredFromInterruption).toBe(true);
    expect(rollback).not.toHaveProperty('relativeSnapshots');
  });

  it('refuses to finalize an interrupted commit with missing package files', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const transactionId = '66666666-6666-4666-8666-666666666666';
    const transactionRoot = path.join(workspace, '.workbuddy-department/transactions');
    const files = buildWorkBuddyPackage({
      departmentId: 'content', draft: draft(workspace), workspace, transactionId,
    });
    const snapshots = [];
    const packageFiles = [];
    for (const [relative, content] of files) {
      if (relative.endsWith('/workflow.json') || relative.endsWith('/memory.md') || relative.endsWith('/skills-plan.md')) {
        packageFiles.push({
          relative: relative.slice('.workbuddy-department/content/'.length),
          sha256: createHash('sha256').update(content).digest('hex'),
        });
        continue;
      }
      const target = path.join(workspace, relative);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, content);
      if (relative.startsWith('.workbuddy-department/content/')) {
        packageFiles.push({
          relative: relative.slice('.workbuddy-department/content/'.length),
          sha256: createHash('sha256').update(content).digest('hex'),
        });
      } else {
        snapshots.push({ relative, existed: false, writtenSha256: createHash('sha256').update(content).digest('hex') });
      }
    }
    mkdirSync(transactionRoot, { recursive: true });
    const record = workbuddyProvisioning.signWorkBuddyRollbackRecord(workspace, {
      schemaVersion: 1,
      platform: 'workbuddy',
      status: 'started',
      transactionId,
      departmentId: 'content',
      startedAt: '2026-08-29T00:00:00.000Z',
      packageFiles,
      relativeSnapshots: snapshots,
    });
    writeFileSync(path.join(transactionRoot, `${transactionId}.rollback.json`), JSON.stringify(record));

    expect(() => workbuddyProvisioning.recoverInterruptedWorkBuddyTransactions(workspace)).toThrow(/incomplete|package/i);
    expect(existsSync(path.join(workspace, '.workbuddy-department/content'))).toBe(true);
    expect(existsSync(path.join(transactionRoot, `${transactionId}.json`))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(transactionRoot, `${transactionId}.rollback.json`), 'utf8')).status).toBe('started');
  });

  it('rejects a forged rollback record without deleting arbitrary workspace files', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const sourceRoot = path.join(workspace, 'src');
    const transactionRoot = path.join(workspace, '.workbuddy-department/transactions');
    const transactionId = '22222222-2222-4222-8222-222222222222';
    mkdirSync(sourceRoot);
    mkdirSync(transactionRoot, { recursive: true });
    writeFileSync(path.join(sourceRoot, 'keep.txt'), '保留');
    writeFileSync(path.join(transactionRoot, `${transactionId}.rollback.json`), JSON.stringify({
      schemaVersion: 1,
      status: 'started',
      transactionId,
      departmentId: 'content',
      packageRoot: sourceRoot,
      relativeSnapshots: [],
    }));

    expect(() => workbuddyProvisioning.recoverInterruptedWorkBuddyTransactions(workspace)).toThrow(/rollback|回滚|record/i);
    expect(readFileSync(path.join(sourceRoot, 'keep.txt'), 'utf8')).toBe('保留');
  });

  it('does not trust a schema-valid forged rollback record to delete a completed department', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const indexPath = path.join(workspace, 'CODEBUDDY.md');
    const packageRoot = path.join(workspace, '.workbuddy-department/content');
    const transactionRoot = path.join(workspace, '.workbuddy-department/transactions');
    const transactionId = '44444444-4444-4444-8444-444444444444';
    mkdirSync(packageRoot, { recursive: true });
    mkdirSync(transactionRoot, { recursive: true });
    writeFileSync(indexPath, '# 用户正式索引\n');
    writeFileSync(path.join(packageRoot, 'manifest.json'), '{"id":"content"}\n');
    writeFileSync(path.join(packageRoot, 'department.json'), '{"platform":"workbuddy","id":"content"}\n');
    writeFileSync(path.join(transactionRoot, `${transactionId}.rollback.json`), JSON.stringify({
      schemaVersion: 1,
      platform: 'workbuddy',
      status: 'started',
      transactionId,
      departmentId: 'content',
      startedAt: '2026-08-29T00:00:00.000Z',
      workspaceSha256: createHash('sha256').update(path.resolve(workspace)).digest('hex'),
      signature: '0'.repeat(64),
      relativeSnapshots: [{
        relative: 'CODEBUDDY.md',
        existed: false,
        writtenSha256: createHash('sha256').update('# 用户正式索引\n').digest('hex'),
      }],
    }));

    expect(() => workbuddyProvisioning.recoverInterruptedWorkBuddyTransactions(workspace)).toThrow(/authentication|认证|WorkBuddy/i);
    expect(readFileSync(indexPath, 'utf8')).toBe('# 用户正式索引\n');
    expect(existsSync(packageRoot)).toBe(true);
  });

  it('rejects a broadly accessible trusted state directory or transaction key', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'workbuddy-provision-'));
    const stateRoot = mkdtempSync(path.join(tmpdir(), 'workbuddy-state-'));
    const previous = process.env.WORKBUDDY_TRUSTED_STATE_HOME;
    process.env.WORKBUDDY_TRUSTED_STATE_HOME = stateRoot;
    const record = { schemaVersion: 1, platform: 'workbuddy', status: 'started' };
    try {
      chmodSync(stateRoot, 0o777);
      expect(() => workbuddyProvisioning.signWorkBuddyRollbackRecord(workspace, record)).toThrow(/permissions/i);

      chmodSync(stateRoot, 0o700);
      writeFileSync(path.join(stateRoot, 'transaction.key'), Buffer.alloc(32), { mode: 0o644 });
      expect(() => workbuddyProvisioning.signWorkBuddyRollbackRecord(workspace, record)).toThrow(/permissions/i);
    } finally {
      if (previous === undefined) delete process.env.WORKBUDDY_TRUSTED_STATE_HOME;
      else process.env.WORKBUDDY_TRUSTED_STATE_HOME = previous;
    }
  });
});
