import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { assertDepartmentDraft } from './department-draft-schema.mjs';
import { mergeDepartmentOverlay, renderDepartmentOverlay } from './department-overlay.mjs';
import { buildDepartmentPackage } from './department-package-writer.mjs';
import { validateDepartmentPackage } from './department-package-validator.mjs';
import { TransactionJournal, writeJsonAtomic } from './transaction-journal.mjs';
import { acquireDirectoryLock } from './directory-lock.mjs';

const EMPTY_CAPABILITY_RESULT = Object.freeze({
  schemaVersion: 1,
  status: 'ready',
  counts: {
    available: 0,
    installed: 0,
    pending_authorization: 0,
    pending_manual: 0,
    conflict: 0,
    failed: 0,
  },
  capabilities: [],
});

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function ensureRegularJson(file, label) {
  if (!existsSync(file)) throw new Error(`${label} is missing: ${file}`);
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function snapshotFile(file) {
  if (!existsSync(file)) return { file, exists: false };
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`transaction target must be a regular file: ${file}`);
  }
  return { file, exists: true, content: readFileSync(file), mode: statSync(file).mode & 0o777 };
}

function restoreFile(snapshot) {
  if (!snapshot.exists) {
    rmSync(snapshot.file, { force: true });
    return;
  }
  const temporary = `${snapshot.file}.rollback-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, snapshot.content, { mode: snapshot.mode });
  chmodSync(temporary, snapshot.mode);
  renameSync(temporary, snapshot.file);
}

function persistBackups(organizationRoot, transactionId, snapshots) {
  const backupRoot = path.join(organizationRoot, 'backups', transactionId);
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  writeJsonAtomic(path.join(backupRoot, 'manifest.json'), {
    schemaVersion: 1,
    transactionId,
    targets: snapshots.map((snapshot) => ({
      file: snapshot.file,
      existed: snapshot.exists,
      ...(snapshot.exists ? {
        mode: snapshot.mode,
        contentBase64: snapshot.content.toString('base64'),
      } : {}),
    })),
  });
  return backupRoot;
}

function validateWorkspace(workspace, organizationRoot, profileRoot) {
  const resolved = path.resolve(workspace);
  const protectedRoots = new Set([
    path.parse(resolved).root,
    path.resolve(homedir()),
    path.resolve(path.dirname(homedir())),
    path.resolve(organizationRoot),
    path.resolve(profileRoot),
  ]);
  if (protectedRoots.has(resolved) || isWithin(resolved, organizationRoot) || isWithin(resolved, profileRoot)) {
    throw new Error('workspace is a protected root or bridge state directory');
  }
  if (!existsSync(resolved)) throw new Error(`workspace is not an existing directory: ${resolved}`);
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('workspace must be a regular directory, not a symbolic link');
  }
  return realpathSync(resolved);
}

function validateRequest(request, organizationRoot, profileRoot) {
  for (const field of [
    'departmentId', 'departmentName', 'groupName', 'chatId', 'senderId',
    'host', 'profile', 'workspace',
  ]) {
    if (typeof request[field] !== 'string' || !request[field].trim()) {
      throw new Error(`missing ${field}`);
    }
  }
  if (!/^[a-z][a-z0-9_]*$/.test(request.departmentId)) {
    throw new Error('departmentId must be snake_case');
  }
  if (!/^oc_[A-Za-z0-9_-]+$/.test(request.chatId)) {
    throw new Error('chatId must begin with oc_');
  }
  const draft = assertDepartmentDraft(request.draft, { requireReady: true });
  if (request.departmentName !== draft.departmentName) {
    throw new Error('departmentName does not match the validated draft');
  }
  const workspace = validateWorkspace(request.workspace, organizationRoot, profileRoot);
  if (workspace !== realpathSync(path.resolve(draft.workspace))) {
    throw new Error('workspace does not match the validated draft workspace');
  }
  if (JSON.stringify(request.responsibilities) !== JSON.stringify(draft.responsibilities)) {
    throw new Error('responsibilities do not match the validated draft');
  }
  if (JSON.stringify(request.approvalBoundaries) !== JSON.stringify(draft.approvalBoundaries)) {
    throw new Error('approvalBoundaries do not match the validated draft');
  }
  return { draft, workspace };
}

function findLocalNode(draft, request, workspace) {
  const topology = draft.organizationTopology;
  const synthesized = topology.primaryNodeId === 'local_primary'
    && topology.nodes.length === 1
    && topology.nodes[0].host === 'current';
  const node = synthesized
    ? topology.nodes[0]
    : topology.nodes.find((candidate) =>
      candidate.host === request.host && path.resolve(candidate.workspace) === workspace);
  if (!node) throw new Error('organization topology does not contain the provisioning host/workspace');
  return node;
}

function cleanupInstalledCapabilities(result) {
  for (const capability of result?.capabilities ?? []) {
    if (capability.status === 'installed' && typeof capability.target === 'string') {
      rmSync(capability.target, { recursive: true, force: true });
    }
  }
}

export class DepartmentProvisioner {
  constructor({
    organizationRoot,
    profileRoot,
    routeController = { current: () => undefined, apply: () => {}, restore: () => {} },
    capabilityMaterializer = { materialize: () => structuredClone(EMPTY_CAPABILITY_RESULT) },
    now = () => new Date(),
    failAfter = null,
  }) {
    this.organizationRoot = path.resolve(organizationRoot);
    this.profileRoot = path.resolve(profileRoot);
    this.routeController = routeController;
    this.capabilityMaterializer = capabilityMaterializer;
    this.now = now;
    this.failAfter = failAfter;
    if (!routeController || !['current', 'apply', 'restore'].every((name) => typeof routeController[name] === 'function')) {
      throw new TypeError('routeController must provide current(), apply(), and restore()');
    }
    if (!capabilityMaterializer || typeof capabilityMaterializer.materialize !== 'function') {
      throw new TypeError('capabilityMaterializer must provide materialize()');
    }
  }

  provision(request) {
    const { draft, workspace } = validateRequest(request, this.organizationRoot, this.profileRoot);
    const normalizedRequest = { ...request, workspace, organizationRoot: this.organizationRoot };
    const registryFile = path.join(this.organizationRoot, 'company', 'department-registry.json');
    const routerFile = path.join(this.organizationRoot, 'router', 'group-router.json');
    const registry = ensureRegularJson(registryFile, 'department registry');
    const router = ensureRegularJson(routerFile, 'group router');
    if (!Array.isArray(registry.departments) || !Array.isArray(router.routes)) {
      throw new Error('organization registry or router schema is invalid');
    }
    if (registry.departments.some((item) => item.id === request.departmentId)) {
      throw new Error(`department already exists: ${request.departmentId}`);
    }
    if (router.routes.some((item) => item.chatId === request.chatId)) {
      throw new Error(`chat is already routed: ${request.chatId}`);
    }

    const finalDepartment = path.join(this.organizationRoot, 'departments', request.departmentId);
    if (existsSync(finalDepartment)) throw new Error(`department package already exists: ${request.departmentId}`);
    const transactionId = randomUUID();
    const pendingPackage = path.join(this.organizationRoot, 'onboarding', `.pending-${request.departmentId}-${transactionId}`);
    const receiptPath = path.join(this.organizationRoot, 'transactions', `${transactionId}.json`);
    const lock = path.join(this.organizationRoot, 'transactions', '.department-provision.lock');
    const agentsFile = path.join(workspace, 'AGENTS.md');
    const previousRoute = this.routeController.current(request.chatId);
    const snapshots = [snapshotFile(registryFile), snapshotFile(routerFile), snapshotFile(agentsFile)];
    const journal = new TransactionJournal(this.organizationRoot, transactionId, { now: this.now });
    let capabilityMaterialization = null;
    let routeApplied = false;
    let currentStage = 'lock';

    let releaseLock;
    try {
      releaseLock = acquireDirectoryLock(lock);
    } catch {
      throw new Error('another department transaction is active');
    }

    try {
      journal.start({
        profile: request.profile,
        host: request.host,
        chatId: request.chatId,
        senderId: request.senderId,
        departmentId: request.departmentId,
      });
      const backupRoot = persistBackups(this.organizationRoot, transactionId, snapshots);
      journal.step('backup', { backupRoot });

      currentStage = 'candidate_generation';
      mkdirSync(pendingPackage, { recursive: false, mode: 0o700 });
      const files = buildDepartmentPackage(normalizedRequest, draft, this.now().toISOString());
      for (const [relative, content] of files) {
        const target = path.join(pendingPackage, relative);
        writeFileSync(target, content, { mode: 0o600 });
        chmodSync(target, 0o600);
      }
      validateDepartmentPackage(pendingPackage, normalizedRequest);
      journal.step('candidate_generation');
      this.#maybeFail('candidate_generation');

      currentStage = 'promotion';
      renameSync(pendingPackage, finalDepartment);
      journal.step('promotion', { finalDepartment });
      this.#maybeFail('promotion');

      currentStage = 'overlay';
      const originalAgents = existsSync(agentsFile) ? readFileSync(agentsFile, 'utf8') : '';
      const overlay = renderDepartmentOverlay({
        departmentId: request.departmentId,
        departmentName: request.departmentName,
        draft,
        workflowPath: path.join(finalDepartment, 'workflow.json'),
      });
      const agentsMode = existsSync(agentsFile) ? statSync(agentsFile).mode & 0o777 : 0o600;
      const temporaryAgents = `${agentsFile}.tmp-${transactionId}`;
      writeFileSync(temporaryAgents, mergeDepartmentOverlay(originalAgents, overlay, request.departmentId), {
        mode: agentsMode,
      });
      chmodSync(temporaryAgents, agentsMode);
      renameSync(temporaryAgents, agentsFile);
      journal.step('overlay', { agentsFile });
      this.#maybeFail('overlay');

      currentStage = 'registry';
      const primaryNodeId = draft.organizationTopology.primaryNodeId;
      writeJsonAtomic(registryFile, {
        ...registry,
        departments: [...registry.departments, {
          id: request.departmentId,
          name: request.departmentName,
          kind: draft.kind,
          status: draft.lifecycle,
          chatId: request.chatId,
          workspace,
          profile: request.profile,
          primaryNodeId,
          createdAt: this.now().toISOString(),
        }],
      });
      journal.step('registry');
      this.#maybeFail('registry');

      currentStage = 'router';
      writeJsonAtomic(routerFile, {
        ...router,
        routes: [...router.routes, {
          chatId: request.chatId,
          departmentId: request.departmentId,
          workspace,
          profile: request.profile,
        }],
      });
      journal.step('router');
      this.#maybeFail('router');

      currentStage = 'workspace_route';
      const routeResult = this.routeController.apply({ chatId: request.chatId, cwd: workspace });
      if (routeResult && typeof routeResult.then === 'function') {
        throw new Error('routeController.apply() must be synchronous');
      }
      routeApplied = true;
      journal.step('workspace_route');
      this.#maybeFail('workspace_route');

      currentStage = 'capability_materialization';
      const localNode = findLocalNode(draft, request, workspace);
      capabilityMaterialization = this.capabilityMaterializer.materialize({
        departmentId: request.departmentId,
        workspace,
        capabilities: draft.capabilityPlan.filter((capability) => capability.nodeId === localNode.id),
      });
      const unresolvedRequired = (capabilityMaterialization.capabilities ?? [])
        .filter((capability) => capability.required === true && !['available', 'installed'].includes(capability.status))
        .map((capability) => capability.id);
      if (unresolvedRequired.length > 0) {
        throw new Error(`required capability is not ready: ${unresolvedRequired.join(', ')}`);
      }
      journal.step('capability_materialization', {
        status: capabilityMaterialization.status,
        counts: capabilityMaterialization.counts,
      });
      this.#maybeFail('capability_materialization');

      currentStage = 'receipt';
      const topology = {
        primaryNodeId: draft.organizationTopology.primaryNodeId,
        localNodeId: localNode.id,
        nodeCount: draft.organizationTopology.nodes.length,
        adapterId: draft.organizationTopology.handoffPolicy.adapterId,
      };
      const receipt = {
        schemaVersion: 1,
        transactionId,
        status: 'completed',
        host: request.host,
        profile: request.profile,
        departmentId: request.departmentId,
        kind: draft.kind,
        chatId: request.chatId,
        workspace,
        readiness: capabilityMaterialization.status,
        capabilityMaterialization,
        topology,
        createdAt: this.now().toISOString(),
      };
      writeJsonAtomic(receiptPath, receipt);
      journal.step('receipt', { receiptPath });
      this.#maybeFail('receipt');
      journal.finish('completed', { receiptPath });
      return {
        status: 'completed',
        transactionId,
        receiptPath,
        workspaceRoute: { chatId: request.chatId, cwd: workspace },
        workspaceRouteApplied: true,
        readiness: capabilityMaterialization.status,
        capabilitySummary: capabilityMaterialization.counts,
        capabilityMaterialization,
        topology,
      };
    } catch (error) {
      error.stage ??= currentStage;
      error.transactionId ??= transactionId;
      cleanupInstalledCapabilities(capabilityMaterialization);
      if (routeApplied) this.routeController.restore(request.chatId, previousRoute);
      for (const snapshot of [...snapshots].reverse()) restoreFile(snapshot);
      rmSync(pendingPackage, { recursive: true, force: true });
      rmSync(finalDepartment, { recursive: true, force: true });
      rmSync(receiptPath, { force: true });
      journal.finish('failed', { stage: error.stage, error: error.message });
      throw error;
    } finally {
      releaseLock();
    }
  }

  join({ departmentId, chatId, profile }) {
    if (typeof departmentId !== 'string' || !/^[a-z][a-z0-9_]*$/.test(departmentId)) {
      throw new Error('部门编号无效，必须使用小写字母、数字和下划线');
    }
    if (typeof chatId !== 'string' || !/^oc_[A-Za-z0-9_-]+$/.test(chatId)) {
      throw new Error('群聊编号无效');
    }
    if (typeof profile !== 'string' || !profile.trim()) {
      throw new Error('当前配置身份无效');
    }

    const registryFile = path.join(this.organizationRoot, 'company', 'department-registry.json');
    const routerFile = path.join(this.organizationRoot, 'router', 'group-router.json');
    const lockFile = path.join(this.organizationRoot, 'transactions', '.department-provision.lock');
    let releaseLock;
    try {
      releaseLock = acquireDirectoryLock(lockFile);
    } catch {
      throw new Error('另一个部门事务正在执行，请稍后重试');
    }

    try {
      const registry = ensureRegularJson(registryFile, 'department registry');
      const router = ensureRegularJson(routerFile, 'group router');
      if (!Array.isArray(registry.departments) || !Array.isArray(router.routes)) {
        throw new Error('组织注册表或群路由结构无效');
      }
      const department = registry.departments.find((item) => item?.id === departmentId);
      if (!department) throw new Error(`部门不存在：${departmentId}`);
      if (department.profile && department.profile !== profile) {
        throw new Error(`部门属于配置身份 ${department.profile}，当前身份不能加入`);
      }
      if (typeof department.workspace !== 'string' || !path.isAbsolute(department.workspace)) {
        throw new Error('部门工作区无效');
      }
      const workspace = validateWorkspace(department.workspace, this.organizationRoot, this.profileRoot);
      const existing = router.routes.find((item) => item?.chatId === chatId);
      if (existing) {
        const sameDepartment = existing.departmentId === departmentId
          && path.resolve(existing.workspace ?? '') === workspace
          && (existing.profile ?? profile) === profile;
        if (!sameDepartment) throw new Error('当前群已经绑定其他部门');
        this.routeController.apply({ chatId, cwd: workspace });
        return {
          status: 'already_joined',
          departmentId,
          departmentName: department.name,
          chatId,
          workspace,
          profile,
        };
      }

      const previousRoute = this.routeController.current(chatId);
      const routerSnapshot = snapshotFile(routerFile);
      let routeApplied = false;
      try {
        writeJsonAtomic(routerFile, {
          ...router,
          routes: [...router.routes, { chatId, departmentId, workspace, profile }],
        });
        const routeResult = this.routeController.apply({ chatId, cwd: workspace });
        if (routeResult && typeof routeResult.then === 'function') {
          throw new Error('routeController.apply() must be synchronous');
        }
        routeApplied = true;
        return {
          status: 'joined',
          departmentId,
          departmentName: department.name,
          chatId,
          workspace,
          profile,
        };
      } catch (error) {
        if (routeApplied) this.routeController.restore(chatId, previousRoute);
        restoreFile(routerSnapshot);
        throw error;
      }
    } finally {
      releaseLock();
    }
  }

  #maybeFail(stage) {
    if (this.failAfter === stage) throw new Error(`injected failure after ${stage}`);
  }
}
