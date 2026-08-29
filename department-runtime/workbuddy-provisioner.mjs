import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { assertDepartmentDraft } from './department-draft-schema.mjs';
import { acquireDirectoryLock } from './directory-lock.mjs';
import { buildWorkBuddyPackage } from './workbuddy-package-writer.mjs';
import { assertSafeWorkBuddyPath } from './workbuddy-safe-path.mjs';

const DEPARTMENT_ID = /^[a-z][a-z0-9_]*$/;
const TRANSACTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STARTED_ROLLBACK_FIELDS = new Set([
  'schemaVersion', 'platform', 'status', 'transactionId', 'departmentId', 'relativeSnapshots', 'startedAt',
  'workspaceSha256', 'signature', 'packageFiles',
]);
const PACKAGE_FILE_NAMES = Object.freeze(['manifest.json', 'department.json', 'workflow.json', 'memory.md', 'skills-plan.md']);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function transactionKeyPath() {
  const stateRoot = process.env.WORKBUDDY_TRUSTED_STATE_HOME
    ? path.resolve(process.env.WORKBUDDY_TRUSTED_STATE_HOME)
    : path.join(os.homedir(), '.local', 'state', 'lark-coding-agent-bridge', 'workbuddy');
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  const rootInfo = lstatSync(stateRoot);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('WorkBuddy trusted state root must be a regular directory');
  if ((rootInfo.mode & 0o077) !== 0) throw new Error('WorkBuddy trusted state root permissions are too broad');
  return path.join(stateRoot, 'transaction.key');
}

function transactionKey() {
  const keyPath = transactionKeyPath();
  if (!existsSync(keyPath)) {
    try {
      writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  const info = lstatSync(keyPath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('WorkBuddy transaction key must be a regular file');
  if ((info.mode & 0o077) !== 0 || (info.mode & 0o600) !== 0o600) {
    throw new Error('WorkBuddy transaction key permissions are too broad');
  }
  const key = readFileSync(keyPath);
  if (key.length !== 32) throw new Error('invalid WorkBuddy transaction key');
  return key;
}

function rollbackSignature(record) {
  const { signature: _signature, ...unsigned } = record;
  return createHmac('sha256', transactionKey()).update(canonicalJson(unsigned)).digest('hex');
}

export function signWorkBuddyRollbackRecord(workspace, record) {
  const signed = {
    ...record,
    workspaceSha256: sha256(path.resolve(workspace)),
  };
  return { ...signed, signature: rollbackSignature(signed) };
}

function verifyRollbackSignature(workspace, record) {
  if (record.workspaceSha256 !== sha256(path.resolve(workspace)) || !/^[0-9a-f]{64}$/.test(record.signature ?? '')) {
    throw new Error('invalid WorkBuddy rollback authentication');
  }
  const expected = Buffer.from(rollbackSignature(record), 'hex');
  const actual = Buffer.from(record.signature, 'hex');
  if (!timingSafeEqual(expected, actual)) throw new Error('invalid WorkBuddy rollback authentication');
}

function atomicWrite(file, content) {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(temporary, content, { mode: 0o600 });
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateWorkspace(workspace) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new Error('workspace must be an absolute path');
  const resolved = path.resolve(workspace);
  if (!existsSync(resolved)) throw new Error(`workspace does not exist: ${resolved}`);
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('workspace must be a regular directory');
  return resolved;
}

function appendSection(original, section) {
  if (!original) return section;
  return `${original}${original.endsWith('\n') ? '\n' : '\n\n'}${section}`;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function snapshotFile(workspace, relative, writtenContent) {
  const file = path.join(workspace, ...relative.split('/'));
  const writtenSha256 = sha256(writtenContent);
  if (!existsSync(file)) return { relative, existed: false, writtenSha256 };
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`transaction target must be a regular file: ${file}`);
  const original = readFileSync(file);
  return {
    relative,
    existed: true,
    mode: info.mode & 0o777,
    originalSize: original.length,
    originalSha256: sha256(original),
    writtenSha256,
  };
}

function contentBelongsToTransaction(snapshot, content, record) {
  const text = content.toString('utf8');
  if (snapshot.relative === 'CODEBUDDY.md') {
    return text.includes(`<!-- workbuddy-transaction:${record.transactionId} -->`)
      && text.includes(`<!-- workbuddy-department:start ${record.departmentId} -->`)
      && text.includes(`<!-- workbuddy-department:end ${record.departmentId} -->`);
  }
  const skill = snapshot.relative.match(/^\.codebuddy\/skills\/([^/]+)\/SKILL\.md$/)?.[1];
  return Boolean(skill && text.includes(`\nname: ${skill}\n`));
}

function assertSnapshotUnchanged(workspace, snapshot) {
  const target = path.join(workspace, ...snapshot.relative.split('/'));
  assertSafeWorkBuddyPath(workspace, target);
  if (!snapshot.existed) {
    if (existsSync(target)) throw new Error(`WorkBuddy target changed after snapshot: ${snapshot.relative}`);
    return;
  }
  if (!existsSync(target)) throw new Error(`WorkBuddy target changed after snapshot: ${snapshot.relative}`);
  const info = lstatSync(target);
  if (!info.isFile() || info.isSymbolicLink() || sha256(readFileSync(target)) !== snapshot.originalSha256) {
    throw new Error(`WorkBuddy target changed after snapshot: ${snapshot.relative}`);
  }
}

function assertSnapshotWritten(workspace, snapshot, record) {
  const target = path.join(workspace, ...snapshot.relative.split('/'));
  assertSafeWorkBuddyPath(workspace, target);
  if (!existsSync(target)) throw new Error(`WorkBuddy target disappeared during write: ${snapshot.relative}`);
  const info = lstatSync(target);
  const content = info.isFile() && !info.isSymbolicLink() ? readFileSync(target) : null;
  if (!content || sha256(content) !== snapshot.writtenSha256 || !contentBelongsToTransaction(snapshot, content, record)) {
    throw new Error(`WorkBuddy target changed during write: ${snapshot.relative}`);
  }
}

function restoreSnapshot(workspace, snapshot, record) {
  const target = path.join(workspace, ...snapshot.relative.split('/'));
  assertSafeWorkBuddyPath(workspace, target);
  if (!snapshot.existed) {
    if (!existsSync(target)) return;
    const current = readFileSync(target);
    if (sha256(current) !== snapshot.writtenSha256 || !contentBelongsToTransaction(snapshot, current, record)) {
      return;
    }
    rmSync(target, { force: true });
    return;
  }
  if (!existsSync(target)) return;
  const current = readFileSync(target);
  if (current.length === snapshot.originalSize && sha256(current) === snapshot.originalSha256) return;
  if (sha256(current) !== snapshot.writtenSha256 || !contentBelongsToTransaction(snapshot, current, record)) {
    return;
  }
  if (current.length < snapshot.originalSize) {
    throw new Error(`cannot verify WorkBuddy rollback prefix: ${snapshot.relative}`);
  }
  const original = current.subarray(0, snapshot.originalSize);
  const originalSha256 = sha256(original);
  if (originalSha256 !== snapshot.originalSha256) {
    throw new Error(`WorkBuddy rollback prefix changed: ${snapshot.relative}`);
  }
  atomicWrite(target, original);
  chmodSync(target, snapshot.mode);
}

function readRollback(file) {
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`rollback record must be a regular file: ${file}`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function allowedSnapshotRelative(departmentId, relative) {
  if (relative === 'CODEBUDDY.md') return true;
  const skillDepartment = departmentId.replace(/_/g, '-');
  const escaped = skillDepartment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\.codebuddy/skills/${escaped}-(?:department|protocol-[a-z0-9-]+)/SKILL\\.md$`).test(relative);
}

function validateStartedRollback(workspace, file, record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('invalid WorkBuddy rollback record');
  if (Object.keys(record).some((field) => !STARTED_ROLLBACK_FIELDS.has(field))) {
    throw new Error('invalid WorkBuddy rollback record fields');
  }
  if (record.schemaVersion !== 1 || record.platform !== 'workbuddy' || record.status !== 'started'
    || !TRANSACTION_ID.test(record.transactionId ?? '') || typeof record.startedAt !== 'string') {
    throw new Error('invalid WorkBuddy rollback record identity');
  }
  if (!DEPARTMENT_ID.test(record.departmentId ?? '')) throw new Error('invalid WorkBuddy rollback department');
  if (path.basename(file) !== `${record.transactionId}.rollback.json`) throw new Error('WorkBuddy rollback filename mismatch');
  verifyRollbackSignature(workspace, record);
  if (!Array.isArray(record.relativeSnapshots)) throw new Error('invalid WorkBuddy rollback snapshots');
  if (!Array.isArray(record.packageFiles) || record.packageFiles.length !== PACKAGE_FILE_NAMES.length) {
    throw new Error('invalid WorkBuddy rollback package files');
  }
  const packageNames = new Set();
  for (const file of record.packageFiles) {
    if (!file || typeof file !== 'object' || Array.isArray(file)
      || Object.keys(file).some((field) => !['relative', 'sha256'].includes(field))
      || !PACKAGE_FILE_NAMES.includes(file.relative)
      || packageNames.has(file.relative)
      || !/^[0-9a-f]{64}$/.test(file.sha256 ?? '')) {
      throw new Error('invalid WorkBuddy rollback package file');
    }
    packageNames.add(file.relative);
  }
  const seen = new Set();
  for (const snapshot of record.relativeSnapshots) {
    const fields = Object.keys(snapshot ?? {});
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
      || fields.some((field) => !['relative', 'existed', 'mode', 'originalSize', 'originalSha256', 'writtenSha256'].includes(field))
      || typeof snapshot.relative !== 'string'
      || !allowedSnapshotRelative(record.departmentId, snapshot.relative)
      || seen.has(snapshot.relative)
      || typeof snapshot.existed !== 'boolean') {
      throw new Error('invalid WorkBuddy rollback snapshot');
    }
    if (!/^[0-9a-f]{64}$/.test(snapshot.writtenSha256 ?? '')) {
      throw new Error('invalid WorkBuddy rollback written content');
    }
    if (snapshot.existed && (snapshot.relative !== 'CODEBUDDY.md'
      || !Number.isInteger(snapshot.mode)
      || !Number.isInteger(snapshot.originalSize)
      || snapshot.originalSize < 0
      || !/^[0-9a-f]{64}$/.test(snapshot.originalSha256 ?? ''))) {
      throw new Error('invalid WorkBuddy rollback snapshot content');
    }
    if (!snapshot.existed && ('mode' in snapshot || 'originalSize' in snapshot || 'originalSha256' in snapshot)) {
      throw new Error('invalid WorkBuddy rollback empty snapshot');
    }
    seen.add(snapshot.relative);
  }
  return record;
}

function scrubRollback(record, status, fields = {}) {
  return {
    schemaVersion: 1,
    platform: 'workbuddy',
    status,
    transactionId: record.transactionId,
    departmentId: record.departmentId,
    startedAt: record.startedAt,
    ...fields,
  };
}

function committedPackageFiles(packageRoot, record) {
  return record.packageFiles.map((file) => path.join(packageRoot, file.relative));
}

function validateCommittedPackage(workspace, packageRoot, record) {
  const manifestPath = path.join(packageRoot, 'manifest.json');
  const departmentPath = path.join(packageRoot, 'department.json');
  for (const file of record.packageFiles) {
    const target = path.join(packageRoot, file.relative);
    assertSafeWorkBuddyPath(workspace, target);
    if (!existsSync(target)) throw new Error(`incomplete WorkBuddy committed package: ${record.departmentId}`);
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('WorkBuddy committed package metadata must be regular files');
    if (sha256(readFileSync(target)) !== file.sha256) throw new Error(`WorkBuddy committed package file changed: ${file.relative}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const department = JSON.parse(readFileSync(departmentPath, 'utf8'));
  if (manifest.id !== record.departmentId || department.id !== record.departmentId || department.platform !== 'workbuddy') {
    throw new Error('WorkBuddy committed package identity mismatch');
  }
  for (const snapshot of record.relativeSnapshots) {
    const target = path.join(workspace, ...snapshot.relative.split('/'));
    assertSafeWorkBuddyPath(workspace, target);
    if (!existsSync(target)) throw new Error(`missing WorkBuddy committed target: ${snapshot.relative}`);
    const content = readFileSync(target);
    if (sha256(content) !== snapshot.writtenSha256 || !contentBelongsToTransaction(snapshot, content, record)) {
      throw new Error(`WorkBuddy committed target identity mismatch: ${snapshot.relative}`);
    }
  }
}

function completedReceipt(workspace, packageRoot, record, createdAt) {
  return {
    schemaVersion: 1,
    platform: 'workbuddy',
    transactionId: record.transactionId,
    departmentId: record.departmentId,
    status: 'completed',
    createdAt,
    files: [
      ...record.relativeSnapshots.map((item) => path.join(workspace, ...item.relative.split('/'))),
      ...committedPackageFiles(packageRoot, record),
    ],
  };
}

function recoverLocked(workspace, transactionRoot) {
  if (!existsSync(transactionRoot)) return { recovered: 0 };
  let recovered = 0;
  for (const name of readdirSync(transactionRoot)) {
    if (!name.endsWith('.rollback.json')) continue;
    const file = path.join(transactionRoot, name);
    const record = readRollback(file);
    if (record.status !== 'started') continue;
    validateStartedRollback(workspace, file, record);
    const packageRoot = path.join(workspace, '.workbuddy-department', record.departmentId);
    const pendingRoot = path.join(workspace, '.workbuddy-department', `.pending-${record.departmentId}-${record.transactionId}`);
    const snapshotTargets = record.relativeSnapshots.map((item) => path.join(workspace, ...item.relative.split('/')));
    for (const target of [packageRoot, pendingRoot, ...snapshotTargets]) {
      assertSafeWorkBuddyPath(workspace, target);
    }
    if (existsSync(packageRoot)) {
      validateCommittedPackage(workspace, packageRoot, record);
      const recoveredAt = new Date().toISOString();
      const receiptPath = path.join(transactionRoot, `${record.transactionId}.json`);
      atomicWrite(receiptPath, json(completedReceipt(workspace, packageRoot, record, recoveredAt)));
      atomicWrite(file, json(scrubRollback(record, 'completed', { completedAt: recoveredAt, recoveredFromInterruption: true })));
      rmSync(pendingRoot, { recursive: true, force: true });
      recovered += 1;
      continue;
    }
    for (const snapshot of [...record.relativeSnapshots].reverse()) restoreSnapshot(workspace, snapshot, record);
    rmSync(pendingRoot, { recursive: true, force: true });
    atomicWrite(file, json(scrubRollback(record, 'recovered', { recoveredAt: new Date().toISOString() })));
    recovered += 1;
  }
  return { recovered };
}

export function recoverInterruptedWorkBuddyTransactions(workspace, { lockHeld = false } = {}) {
  const resolvedWorkspace = validateWorkspace(workspace);
  const transactionRoot = path.join(resolvedWorkspace, '.workbuddy-department', 'transactions');
  const lockPath = path.join(transactionRoot, '.provision.lock');
  for (const target of [transactionRoot, lockPath]) assertSafeWorkBuddyPath(resolvedWorkspace, target);
  const release = lockHeld ? null : acquireDirectoryLock(lockPath);
  try {
    return recoverLocked(resolvedWorkspace, transactionRoot);
  } finally {
    release?.();
  }
}

export class WorkBuddyProvisioner {
  constructor({ now = () => new Date(), writer = atomicWrite, receiptWriter = atomicWrite } = {}) {
    this.now = now;
    this.writer = writer;
    this.receiptWriter = receiptWriter;
  }

  provision({ workspace, departmentId, draft }) {
    const resolvedWorkspace = validateWorkspace(workspace);
    if (!DEPARTMENT_ID.test(departmentId)) throw new Error('departmentId must be snake_case');
    const normalizedDraft = assertDepartmentDraft({ ...draft, workspace: resolvedWorkspace }, { requireReady: true });
    const stateRoot = path.join(resolvedWorkspace, '.workbuddy-department');
    const transactionRoot = path.join(stateRoot, 'transactions');
    const lockPath = path.join(transactionRoot, '.provision.lock');
    for (const target of [stateRoot, transactionRoot, lockPath]) assertSafeWorkBuddyPath(resolvedWorkspace, target);
    let releaseLock;
    try {
      releaseLock = acquireDirectoryLock(lockPath);
    } catch {
      throw new Error('another WorkBuddy department transaction is active');
    }

    const transactionId = randomUUID();
    const packageRoot = path.join(stateRoot, departmentId);
    const pendingRoot = path.join(stateRoot, `.pending-${departmentId}-${transactionId}`);
    const receiptPath = path.join(transactionRoot, `${transactionId}.json`);
    const rollbackPath = path.join(transactionRoot, `${transactionId}.rollback.json`);
    const skillsDirectory = path.join(resolvedWorkspace, '.codebuddy', 'skills');
    let rollbackRecord = null;
    let packagePromoted = false;

    try {
      recoverInterruptedWorkBuddyTransactions(resolvedWorkspace, { lockHeld: true });
      if (existsSync(packageRoot)) throw new Error(`WorkBuddy department already exists: ${departmentId}`);
      const indexPath = path.join(resolvedWorkspace, 'CODEBUDDY.md');
      assertSafeWorkBuddyPath(resolvedWorkspace, indexPath);
      const originalIndex = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
      if (originalIndex.includes(`workbuddy-department:start ${departmentId}`)) {
        throw new Error(`WorkBuddy department index already exists: ${departmentId}`);
      }

      const files = buildWorkBuddyPackage({
        departmentId,
        draft: normalizedDraft,
        workspace: resolvedWorkspace,
        confirmedAt: this.now().toISOString(),
        transactionId,
      });
      files.set('CODEBUDDY.md', appendSection(originalIndex, files.get('CODEBUDDY.md')));
      const packagePrefix = `.workbuddy-department/${departmentId}/`;
      const packageFiles = [];
      const externalFiles = [];
      for (const [relative, content] of files) {
        if (relative.startsWith(packagePrefix)) {
          packageFiles.push([relative.slice(packagePrefix.length), content]);
        } else {
          externalFiles.push([relative, content]);
        }
      }
      for (const target of [packageRoot, pendingRoot, receiptPath, rollbackPath, skillsDirectory]) {
        assertSafeWorkBuddyPath(resolvedWorkspace, target);
      }
      const relativeSnapshots = externalFiles.map(([relative, content]) => {
        const target = path.join(resolvedWorkspace, relative);
        assertSafeWorkBuddyPath(resolvedWorkspace, target);
        const before = snapshotFile(resolvedWorkspace, relative, content);
        if (relative !== 'CODEBUDDY.md' && before.existed) {
          throw new Error(`WorkBuddy target already exists: ${relative}`);
        }
        return before;
      });
      rollbackRecord = signWorkBuddyRollbackRecord(resolvedWorkspace, {
        schemaVersion: 1,
        platform: 'workbuddy',
        status: 'started',
        transactionId,
        departmentId,
        relativeSnapshots,
        packageFiles: packageFiles.map(([relative, content]) => ({ relative, sha256: sha256(content) })),
        startedAt: this.now().toISOString(),
      });
      atomicWrite(rollbackPath, json(rollbackRecord));

      mkdirSync(pendingRoot, { recursive: false, mode: 0o700 });
      for (const [relative, content] of packageFiles) {
        const target = path.join(pendingRoot, relative);
        assertSafeWorkBuddyPath(resolvedWorkspace, target);
        this.writer(target, content);
      }
      for (const [index, [relative, content]] of externalFiles.entries()) {
        const snapshot = relativeSnapshots[index];
        assertSnapshotUnchanged(resolvedWorkspace, snapshot);
        this.writer(path.join(resolvedWorkspace, relative), content);
        assertSnapshotWritten(resolvedWorkspace, snapshot, rollbackRecord);
      }
      mkdirSync(skillsDirectory, { recursive: true, mode: 0o700 });
      renameSync(pendingRoot, packageRoot);
      packagePromoted = true;

      const finalFiles = [
        ...externalFiles.map(([relative]) => path.join(resolvedWorkspace, relative)),
        ...packageFiles.map(([relative]) => path.join(packageRoot, relative)),
      ];
      const receipt = { ...completedReceipt(resolvedWorkspace, packageRoot, rollbackRecord, this.now().toISOString()), files: finalFiles };
      this.receiptWriter(receiptPath, json(receipt));
      const completedRollback = scrubRollback(rollbackRecord, 'completed', { completedAt: this.now().toISOString() });
      atomicWrite(rollbackPath, json(completedRollback));
      rollbackRecord = completedRollback;
      return { ...receipt, packageRoot };
    } catch (error) {
      if (packagePromoted && rollbackRecord?.status === 'started') {
        validateCommittedPackage(resolvedWorkspace, packageRoot, rollbackRecord);
        const recoveredAt = this.now().toISOString();
        const receipt = completedReceipt(resolvedWorkspace, packageRoot, rollbackRecord, recoveredAt);
        this.receiptWriter(receiptPath, json(receipt));
        const completedRollback = scrubRollback(rollbackRecord, 'completed', {
          completedAt: recoveredAt,
          recoveredAfterCommitError: true,
        });
        atomicWrite(rollbackPath, json(completedRollback));
        rollbackRecord = completedRollback;
        return { ...receipt, packageRoot, recoveredAfterCommitError: true };
      }
      if (rollbackRecord) {
        for (const snapshot of [...rollbackRecord.relativeSnapshots ?? []].reverse()) restoreSnapshot(resolvedWorkspace, snapshot, rollbackRecord);
        rmSync(pendingRoot, { recursive: true, force: true });
        atomicWrite(rollbackPath, json(scrubRollback(rollbackRecord, 'failed', {
          failedAt: this.now().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        })));
      }
      atomicWrite(receiptPath, json({
        schemaVersion: 1,
        platform: 'workbuddy',
        transactionId,
        departmentId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }));
      throw error;
    } finally {
      releaseLock();
    }
  }
}
