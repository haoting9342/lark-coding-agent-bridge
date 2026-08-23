import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const READY_STATUSES = new Set(['available', 'installed']);
const ALL_STATUSES = [
  'available', 'installed', 'pending_authorization', 'pending_manual', 'conflict', 'failed',
];
const SOURCE_METADATA = '.department-capability-source.json';

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ensureDirectory(directory, label) {
  if (!existsSync(directory)) throw new Error(`${label} must be an existing directory`);
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular directory`);
  }
  return path.resolve(directory);
}

function writeJsonAtomic(file, value) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function validSkillManifest(target, id) {
  const manifest = path.join(target, 'SKILL.md');
  if (!existsSync(manifest)) return false;
  const info = lstatSync(manifest);
  if (!info.isFile() || info.isSymbolicLink()) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\n)name:\\s*["']?${escaped}["']?\\s*(?:\\n|$)`)
    .test(readFileSync(manifest, 'utf8'));
}

function treeHasSymlink(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    const info = lstatSync(candidate);
    if (info.isSymbolicLink()) return true;
    if (info.isDirectory() && treeHasSymlink(candidate)) return true;
  }
  return false;
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.includes('\0')) return false;
  return value.split(/[\\/]+/).every((part) => part && part !== '.' && part !== '..');
}

function sourceFingerprint(capability) {
  return { schemaVersion: 1, id: capability.id, kind: capability.kind, source: capability.source };
}

function sameSource(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function targetRootFor(capability, hostSkillsRoot, workspace) {
  if (capability.scope === 'host') return ensureDirectory(hostSkillsRoot, 'host skill root');
  const resolvedWorkspace = ensureDirectory(workspace, 'workspace');
  const root = path.join(resolvedWorkspace, '.agents', 'skills');
  if (!isWithin(root, resolvedWorkspace)) throw new Error('workspace skill target escapes workspace');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return ensureDirectory(root, 'workspace skill root');
}

function defaultGitHubInstaller({ capability, destinationRoot }) {
  const { repo, path: sourcePath, ref } = capability.source ?? {};
  if (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('invalid GitHub repository');
  }
  if (!safeRelativePath(sourcePath)) throw new Error('unsafe GitHub skill path');
  if (typeof ref !== 'string' || !/^(?:v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?|[a-f0-9]{40})$/i.test(ref)) {
    throw new Error('GitHub skill source must use a pinned version or commit');
  }
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'department-skill-'));
  const checkout = path.join(temporaryRoot, 'repo');
  try {
    mkdirSync(checkout, { mode: 0o700 });
    execFileSync('git', ['-C', checkout, 'init', '--quiet'], { stdio: 'ignore', timeout: 30_000 });
    execFileSync('git', ['-C', checkout, 'remote', 'add', 'origin', `https://github.com/${repo}.git`], {
      stdio: 'ignore', timeout: 30_000,
    });
    execFileSync('git', ['-C', checkout, 'fetch', '--quiet', '--depth', '1', 'origin', ref], {
      stdio: 'ignore', timeout: 120_000,
    });
    execFileSync('git', ['-C', checkout, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], {
      stdio: 'ignore', timeout: 30_000,
    });
    const source = path.resolve(checkout, sourcePath);
    if (!isWithin(source, checkout) || !existsSync(source)) throw new Error('GitHub skill path is missing');
    const info = lstatSync(source);
    if (!info.isDirectory() || info.isSymbolicLink() || treeHasSymlink(source)) {
      throw new Error('GitHub skill source is not a safe directory');
    }
    cpSync(source, path.join(destinationRoot, capability.id), {
      recursive: true,
      dereference: false,
      errorOnExist: true,
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function countsFor(items) {
  const counts = Object.fromEntries(ALL_STATUSES.map((status) => [status, 0]));
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1;
  return counts;
}

export class DepartmentCapabilityMaterializer {
  constructor({
    hostSkillsRoot,
    skillRoots = [],
    builtinCapabilities = [],
    allowedLocalSkillRoots = [],
    installGitHubSkill = defaultGitHubInstaller,
  }) {
    this.hostSkillsRoot = path.resolve(hostSkillsRoot);
    this.skillRoots = [...new Set([this.hostSkillsRoot, ...skillRoots.map((root) => path.resolve(root))])];
    this.builtinCapabilities = new Set(builtinCapabilities);
    this.allowedLocalSkillRoots = allowedLocalSkillRoots.map((root) => path.resolve(root));
    this.installGitHubSkill = installGitHubSkill;
  }

  materialize({ departmentId, workspace, capabilities = [] }) {
    if (typeof departmentId !== 'string' || !departmentId) throw new TypeError('departmentId is required');
    ensureDirectory(workspace, 'workspace');
    mkdirSync(this.hostSkillsRoot, { recursive: true, mode: 0o700 });
    ensureDirectory(this.hostSkillsRoot, 'host skill root');
    const results = capabilities.map((capability) => this.#materializeOne(capability, workspace));
    const unresolvedRequired = results.some(
      (item) => item.required === true && !READY_STATUSES.has(item.status),
    );
    return {
      schemaVersion: 1,
      status: unresolvedRequired ? 'created_with_pending_capabilities' : 'ready',
      counts: countsFor(results),
      capabilities: results,
    };
  }

  #materializeOne(capability, workspace) {
    const base = {
      id: capability.id,
      kind: capability.kind,
      required: capability.required,
      scope: capability.scope,
      installPolicy: capability.installPolicy,
      ...(capability.nodeId ? { nodeId: capability.nodeId } : {}),
      ...(capability.bindingMode ? { bindingMode: capability.bindingMode } : {}),
    };
    if (capability.installPolicy === 'approval_required') {
      return { ...base, status: 'pending_authorization', reason: 'explicit capability authorization required' };
    }
    if (capability.installPolicy === 'manual') {
      return { ...base, status: 'pending_manual', reason: 'manual capability setup requested' };
    }
    if (capability.source?.type === 'builtin') {
      return this.builtinCapabilities.has(capability.source.name)
        ? { ...base, status: 'available', verification: 'builtin_registry' }
        : { ...base, status: 'failed', reason: 'builtin capability is not registered' };
    }
    if (capability.source?.type === 'local_skill') {
      return this.#materializeLocalSkill(capability, workspace, base);
    }
    if (capability.source?.type !== 'github_skill') {
      return { ...base, status: 'pending_manual', reason: 'no supported automatic adapter' };
    }
    return this.#materializeGitHubSkill(capability, workspace, base);
  }

  #materializeGitHubSkill(capability, workspace, base) {
    let target;
    let installStarted = false;
    try {
      const destinationRoot = targetRootFor(capability, this.hostSkillsRoot, workspace);
      target = path.resolve(destinationRoot, capability.id);
      if (!isWithin(target, destinationRoot)) throw new Error('capability target escapes destination');
      const expectedSource = sourceFingerprint(capability);
      const metadataFile = path.join(target, SOURCE_METADATA);
      if (existsSync(target)) {
        const info = lstatSync(target);
        if (!info.isDirectory() || info.isSymbolicLink() || !validSkillManifest(target, capability.id)) {
          return { ...base, target, status: 'conflict', reason: 'existing target is not the expected skill' };
        }
        const recordedSource = existsSync(metadataFile) ? readJson(metadataFile) : null;
        if (!recordedSource) {
          return { ...base, target, status: 'conflict', reason: 'existing skill has no pinned source metadata' };
        }
        return sameSource(recordedSource, expectedSource)
          ? { ...base, target, status: 'available', verification: 'skill_manifest' }
          : { ...base, target, status: 'conflict', reason: 'existing skill has a different recorded source' };
      }
      if (typeof this.installGitHubSkill !== 'function') {
        return { ...base, target, status: 'pending_manual', reason: 'GitHub skill installer is not configured' };
      }
      installStarted = true;
      this.installGitHubSkill({ capability, destinationRoot });
      if (!validSkillManifest(target, capability.id) || treeHasSymlink(target)) {
        throw new Error('installed skill did not pass manifest verification');
      }
      writeJsonAtomic(metadataFile, expectedSource);
      return { ...base, target, status: 'installed', verification: 'skill_manifest' };
    } catch {
      if (installStarted && target && existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
      }
      return { ...base, ...(target ? { target } : {}), status: 'failed', reason: 'capability installation failed' };
    }
  }

  #materializeLocalSkill(capability, workspace, base) {
    let target;
    try {
      const source = path.resolve(capability.source.path);
      const allowedRoots = [
        ...this.allowedLocalSkillRoots,
        path.resolve(workspace, '.agents', 'skills'),
      ];
      if (!allowedRoots.some((root) => isWithin(source, root))) {
        return { ...base, status: 'failed', reason: 'local skill source is not allowed' };
      }
      const sourceInfo = lstatSync(source);
      if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink() || treeHasSymlink(source)) {
        return { ...base, status: 'failed', reason: 'local skill source is not a safe directory' };
      }
      if (!validSkillManifest(source, capability.id)) {
        return { ...base, status: 'failed', reason: 'local skill manifest is invalid' };
      }
      const manifestHash = createHash('sha256')
        .update(readFileSync(path.join(source, 'SKILL.md')))
        .digest('hex');
      if (manifestHash !== capability.source.sha256) {
        return { ...base, status: 'failed', reason: 'local skill fingerprint mismatch' };
      }
      if (capability.bindingMode === 'bind_existing') {
        return { ...base, bindingMode: 'bind_existing', target: source, status: 'available', verification: 'skill_manifest' };
      }
      const destinationRoot = targetRootFor(capability, this.hostSkillsRoot, workspace);
      target = path.resolve(destinationRoot, capability.id);
      if (!isWithin(target, destinationRoot)) throw new Error('capability target escapes destination');
      const expected = sourceFingerprint(capability);
      if (existsSync(target)) {
        if (!validSkillManifest(target, capability.id)) {
          return { ...base, target, status: 'conflict', reason: 'existing target is not the expected skill' };
        }
        const metadata = readJson(path.join(target, SOURCE_METADATA));
        return sameSource(metadata, expected)
          ? { ...base, target, status: 'available', verification: 'skill_manifest' }
          : { ...base, target, status: 'conflict', reason: 'existing skill has a different recorded source' };
      }
      cpSync(source, target, { recursive: true, dereference: false, errorOnExist: true });
      writeJsonAtomic(path.join(target, SOURCE_METADATA), expected);
      return { ...base, target, status: 'installed', verification: 'skill_manifest' };
    } catch {
      if (target && existsSync(target) && !validSkillManifest(target, capability.id)) {
        rmSync(target, { recursive: true, force: true });
      }
      return { ...base, ...(target ? { target } : {}), status: 'failed', reason: 'capability installation failed' };
    }
  }
}
