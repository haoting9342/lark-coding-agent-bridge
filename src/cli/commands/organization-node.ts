import { existsSync, lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAppPaths } from '../../config/app-paths';
import { ensureDefaultOrganization } from '../../organization/initializer';
import {
  activateAuxiliaryNode,
  listOrganizationNodes,
  planAuxiliaryNodeInvite,
  registerAuxiliaryNode,
  type AuxiliaryNodeInvitePlan,
} from '../../organization/nodes';
import { organizationRoot } from '../../organization/paths';

interface BaseOptions {
  rootDir?: string;
  output?: (line: string) => void;
}

export interface NodePlanOptions extends BaseOptions {
  hostAlias: string;
  capabilities?: string[];
}

export async function runOrganizationNodeList(options: BaseOptions = {}): Promise<unknown[]> {
  const rootDir = options.rootDir ?? resolveAppPaths().rootDir;
  const initialized = await ensureDefaultOrganization({ rootDir });
  const nodes = await listOrganizationNodes(initialized.organizationRoot);
  (options.output ?? console.log)(JSON.stringify({ schemaVersion: 1, nodes }, null, 2));
  return nodes;
}

export async function runOrganizationNodePlan(
  nodeId: string,
  options: NodePlanOptions,
): Promise<AuxiliaryNodeInvitePlan> {
  const rootDir = options.rootDir ?? resolveAppPaths().rootDir;
  const initialized = await ensureDefaultOrganization({ rootDir });
  const plan = planAuxiliaryNodeInvite({
    organizationRoot: initialized.organizationRoot,
    nodeId,
    hostAlias: options.hostAlias,
    capabilities: options.capabilities ?? [],
  });
  (options.output ?? console.log)(JSON.stringify(plan, null, 2));
  return plan;
}

export async function runOrganizationNodeRegister(
  planFile: string,
  options: BaseOptions & { actorNodeId: string; fingerprint: string },
): Promise<unknown> {
  const rootDir = options.rootDir ?? resolveAppPaths().rootDir;
  const initialized = await ensureDefaultOrganization({ rootDir });
  const absolutePlan = resolve(process.cwd(), planFile);
  const info = lstatSync(absolutePlan);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('node plan must be a regular file');
  const plan = JSON.parse(await readFile(absolutePlan, 'utf8')) as AuxiliaryNodeInvitePlan;
  const node = await registerAuxiliaryNode({
    organizationRoot: initialized.organizationRoot,
    actorNodeId: options.actorNodeId,
    plan,
    identityPublicKeyFingerprint: options.fingerprint,
  });
  (options.output ?? console.log)(JSON.stringify(node, null, 2));
  return node;
}

export async function runOrganizationNodeActivate(
  nodeId: string,
  options: BaseOptions & { actorNodeId: string; bridgeProfile: string; workspace: string },
): Promise<unknown> {
  const rootDir = options.rootDir ?? resolveAppPaths().rootDir;
  const initialized = await ensureDefaultOrganization({ rootDir });
  const node = await activateAuxiliaryNode({
    organizationRoot: initialized.organizationRoot,
    actorNodeId: options.actorNodeId,
    nodeId,
    bridgeProfile: options.bridgeProfile,
    workspace: options.workspace,
  });
  (options.output ?? console.log)(JSON.stringify(node, null, 2));
  return node;
}

async function readBoundedStdin(maxBytes = 256 * 1024): Promise<string> {
  let value = '';
  for await (const chunk of process.stdin) {
    value += String(chunk);
    if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error('handoff input is too large');
  }
  return value.trim();
}

function departmentRuntimeEntry(name: string): string {
  const source = join(process.cwd(), 'department-runtime', name);
  if (existsSync(source)) return pathToFileURL(source).href;
  return new URL(`../department-runtime/${name}`, import.meta.url).href;
}

export async function runOrganizationHandoffOperation(
  departmentId: string,
  nodeId: string,
  operation: string,
  options: BaseOptions & { input?: string } = {},
): Promise<unknown> {
  if (!/^[a-z][a-z0-9_]*$/.test(departmentId) || !/^[a-z][a-z0-9_]*$/.test(nodeId)) {
    throw new Error('departmentId or nodeId is invalid');
  }
  const rootDir = options.rootDir ?? resolveAppPaths().rootDir;
  await ensureDefaultOrganization({ rootDir });
  const departmentRoot = join(organizationRoot(rootDir), 'departments', departmentId);
  const info = lstatSync(departmentRoot);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('department package is invalid');
  const { DepartmentHandoffLedger } = await import(departmentRuntimeEntry('department-handoff-ledger.mjs'));
  const { InProcessHandoffAdapter } = await import(departmentRuntimeEntry('department-handoff-adapter.mjs'));
  const ledger = new DepartmentHandoffLedger({
    ledgerFile: join(departmentRoot, 'handoff-ledger.json'),
    departmentId,
  });
  const adapter = new InProcessHandoffAdapter({ ledger });
  const raw = options.input ?? await readBoundedStdin();
  const input = raw ? JSON.parse(raw) : {};
  const operations: Record<string, () => unknown> = {
    claim: () => adapter.claim(nodeId),
    accept: () => adapter.accept(nodeId, input),
    progress: () => adapter.progress(nodeId, input),
    complete: () => adapter.complete(nodeId, input),
    receipt: () => adapter.receipt(nodeId, input),
    fail: () => adapter.fail(nodeId, input),
    silence: () => ({ tasks: ledger.findSilentTasks() }),
  };
  const invoke = operations[operation];
  if (!invoke) throw new Error('handoff operation is invalid');
  const result = invoke();
  (options.output ?? console.log)(JSON.stringify(result));
  return result;
}

export async function runOrganizationHandoffSubmit(
  departmentId: string,
  options: BaseOptions & { input?: string } = {},
): Promise<unknown> {
  if (!/^[a-z][a-z0-9_]*$/.test(departmentId)) throw new Error('departmentId is invalid');
  const rootDir = options.rootDir ?? resolveAppPaths().rootDir;
  await ensureDefaultOrganization({ rootDir });
  const { DepartmentHandoffService } = await import(
    departmentRuntimeEntry('department-handoff-service.mjs')
  );
  const service = new DepartmentHandoffService({
    organizationRoot: organizationRoot(rootDir),
    departmentId,
  });
  const raw = options.input ?? await readBoundedStdin();
  if (!raw) throw new Error('handoff submit requires one JSON object on stdin');
  const result = service.submit(JSON.parse(raw));
  (options.output ?? console.log)(JSON.stringify(result));
  return result;
}

export async function runOrganizationHandoffStatus(
  departmentId: string,
  taskId: string,
  options: BaseOptions = {},
): Promise<unknown> {
  if (!/^[a-z][a-z0-9_]*$/.test(departmentId)) throw new Error('departmentId is invalid');
  const rootDir = options.rootDir ?? resolveAppPaths().rootDir;
  await ensureDefaultOrganization({ rootDir });
  const { DepartmentHandoffService } = await import(
    departmentRuntimeEntry('department-handoff-service.mjs')
  );
  const service = new DepartmentHandoffService({
    organizationRoot: organizationRoot(rootDir),
    departmentId,
  });
  const result = service.status(taskId);
  (options.output ?? console.log)(JSON.stringify(result));
  return result;
}
