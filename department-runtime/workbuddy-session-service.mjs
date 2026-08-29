import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { acquireDirectoryLock } from './directory-lock.mjs';
import { WorkBuddyDesignSession } from './workbuddy-design-session.mjs';
import { recoverInterruptedWorkBuddyTransactions, WorkBuddyProvisioner } from './workbuddy-provisioner.mjs';
import { assertSafeWorkBuddyPath } from './workbuddy-safe-path.mjs';
import { validateWorkBuddyWorkspace } from './workbuddy-workspace-initializer.mjs';

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
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

function sessionPaths(workspace) {
  const resolvedWorkspace = validateWorkBuddyWorkspace(workspace);
  const sessionsRoot = path.join(resolvedWorkspace, '.workbuddy-department', 'sessions');
  const statePath = path.join(sessionsRoot, 'current.json');
  const lockPath = path.join(sessionsRoot, '.session.lock');
  for (const target of [sessionsRoot, statePath, lockPath]) assertSafeWorkBuddyPath(resolvedWorkspace, target);
  return { resolvedWorkspace, sessionsRoot, statePath, lockPath };
}

function readState(statePath) {
  if (!existsSync(statePath)) return undefined;
  const info = lstatSync(statePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('WorkBuddy 会话状态必须是普通文件');
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

function withSessionLock(workspace, operation) {
  const paths = sessionPaths(workspace);
  mkdirSync(paths.sessionsRoot, { recursive: true, mode: 0o700 });
  const release = acquireDirectoryLock(paths.lockPath);
  try {
    return operation(paths);
  } finally {
    release();
  }
}

function createSession(statePath) {
  const persisted = readState(statePath);
  return new WorkBuddyDesignSession({
    ...(persisted?.status === 'confirmed' ? {} : { state: persisted }),
    onSnapshot: (snapshot) => atomicWrite(statePath, json(snapshot)),
  });
}

export function saveWorkBuddyDesignDraft({ workspace, proposal, source = 'workbuddy_conversation' }) {
  recoverInterruptedWorkBuddyTransactions(workspace);
  return withSessionLock(workspace, ({ resolvedWorkspace, statePath }) => {
    const session = createSession(statePath);
    return session.applyProposal({ ...proposal, workspace: resolvedWorkspace }, {
      source,
      changedPaths: [...new Set([...Object.keys(proposal), 'workspace'])],
    });
  });
}

export function confirmAndProvisionWorkBuddyDepartment({
  workspace,
  departmentId,
  draft,
  confirmationMessage,
  provisioner = new WorkBuddyProvisioner(),
}) {
  return withSessionLock(workspace, ({ resolvedWorkspace, statePath }) => {
    const session = createSession(statePath);
    session.applyProposal({ ...draft, workspace: resolvedWorkspace }, {
      source: 'confirmed_spec',
      changedPaths: [...new Set([...Object.keys(draft), 'workspace'])],
    });
    session.requestConfirmation();
    const confirmation = session.acceptMessage(confirmationMessage);
    if (!confirmation.confirmed) {
      throw new Error('缺少明确确认：请使用“同意创建”“确认创建”“按这个方案创建”或“确认部门创建”');
    }
    try {
      return provisioner.provision({
        workspace: resolvedWorkspace,
        departmentId,
        draft: confirmation.state.draft,
      });
    } catch (error) {
      session.markFailed(error);
      throw error;
    }
  });
}
