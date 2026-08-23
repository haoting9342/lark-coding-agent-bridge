import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export interface NodeRegistryEntry {
  id: string;
  host: string;
  role: 'primary' | 'auxiliary';
  authority: 'governance' | 'execution_only';
  status: 'online' | 'pending' | 'offline';
  bridgeProfile: string | null;
  workspace: string | null;
  messageGate: 'every_message' | 'internal_only';
  capabilities: string[];
  adapterId: 'local' | 'restricted_ssh_pull';
  identityPublicKeyFingerprint?: string;
  updatedAt: string;
}

interface NodeRegistry {
  schemaVersion: 1;
  primaryNodeId: string;
  nodes: NodeRegistryEntry[];
}

export interface AuxiliaryNodeInvitePlan {
  schemaVersion: 1;
  nodeId: string;
  hostAlias: string;
  role: 'auxiliary';
  authority: 'execution_only';
  messageGate: 'internal_only';
  capabilities: string[];
  adapterId: 'restricted_ssh_pull';
  identityFile: string;
  forcedCommand: string;
}

const NODE_ID = /^[a-z][a-z0-9_]*$/;
const HOST_ALIAS = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validateNodeId(value: string, label = 'node id'): void {
  if (!NODE_ID.test(value)) throw new Error(`${label} is invalid`);
}

function validateCapabilities(value: string[]): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error('capabilities must be an array of non-empty strings');
  }
  return [...new Set(value.map((item) => item.trim()))].sort();
}

function registryPath(organizationRoot: string): string {
  return join(resolve(organizationRoot), 'nodes', 'node-registry.json');
}

async function readRegistry(file: string, primaryNodeId: string): Promise<NodeRegistry> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('node registry must be a regular file');
    const value = JSON.parse(await readFile(file, 'utf8')) as NodeRegistry;
    if (value.schemaVersion !== 1 || value.primaryNodeId !== primaryNodeId || !Array.isArray(value.nodes)) {
      throw new Error('node registry schema is invalid');
    }
    if (value.nodes.filter((node) => node.role === 'primary').length > 1) {
      throw new Error('node registry may contain only one primary');
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { schemaVersion: 1, primaryNodeId, nodes: [] };
    }
    throw error;
  }
}

async function writeRegistry(file: string, value: NodeRegistry): Promise<void> {
  await mkdir(dirname(resolve(file)), { recursive: true, mode: 0o700 });
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

async function withRegistryLock<T>(organizationRoot: string, callback: () => Promise<T>): Promise<T> {
  const directory = join(resolve(organizationRoot), 'nodes');
  const lock = join(directory, '.node-registry.lock');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('node registry is busy');
    throw error;
  }
  try {
    return await callback();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

export async function ensureLocalPrimaryNode(input: {
  organizationRoot: string;
  primaryNodeId: string;
  host: string;
  bridgeProfile: string;
  workspace: string;
  capabilities?: string[];
  now?: () => Date;
}): Promise<NodeRegistryEntry> {
  validateNodeId(input.primaryNodeId, 'primary node id');
  if (typeof input.host !== 'string' || !input.host.trim()) throw new Error('host is required');
  if (typeof input.bridgeProfile !== 'string' || !input.bridgeProfile.trim()) {
    throw new Error('bridge profile is required');
  }
  if (typeof input.workspace !== 'string' || !isAbsolute(input.workspace)) {
    throw new Error('workspace must be absolute');
  }
  const now = input.now ?? (() => new Date());
  return withRegistryLock(input.organizationRoot, async () => {
    const file = registryPath(input.organizationRoot);
    const registry = await readRegistry(file, input.primaryNodeId);
    const otherPrimary = registry.nodes.find(
      (node) => node.role === 'primary' && node.id !== input.primaryNodeId,
    );
    if (otherPrimary) throw new Error(`organization already has primary node ${otherPrimary.id}`);
    const entry: NodeRegistryEntry = {
      id: input.primaryNodeId,
      host: input.host.trim(),
      role: 'primary',
      authority: 'governance',
      status: 'online',
      bridgeProfile: input.bridgeProfile,
      workspace: resolve(input.workspace),
      messageGate: 'every_message',
      capabilities: validateCapabilities(input.capabilities ?? []),
      adapterId: 'local',
      updatedAt: now().toISOString(),
    };
    const index = registry.nodes.findIndex((node) => node.id === input.primaryNodeId);
    if (index >= 0) registry.nodes[index] = entry;
    else registry.nodes.unshift(entry);
    await writeRegistry(file, registry);
    return structuredClone(entry);
  });
}

export function planAuxiliaryNodeInvite(input: {
  organizationRoot: string;
  nodeId: string;
  hostAlias: string;
  capabilities?: string[];
}): AuxiliaryNodeInvitePlan {
  validateNodeId(input.nodeId);
  if (!HOST_ALIAS.test(input.hostAlias)) throw new Error('host alias is invalid');
  const identityFile = join(resolve(input.organizationRoot), 'nodes', 'identities', input.nodeId);
  return {
    schemaVersion: 1,
    nodeId: input.nodeId,
    hostAlias: input.hostAlias,
    role: 'auxiliary',
    authority: 'execution_only',
    messageGate: 'internal_only',
    capabilities: validateCapabilities(input.capabilities ?? []),
    adapterId: 'restricted_ssh_pull',
    identityFile,
    forcedCommand: `lark-channel-bridge-department organization handoff-serve ${input.nodeId}`,
  };
}

export async function registerAuxiliaryNode(input: {
  organizationRoot: string;
  actorNodeId: string;
  plan: AuxiliaryNodeInvitePlan;
  identityPublicKeyFingerprint: string;
  now?: () => Date;
}): Promise<NodeRegistryEntry> {
  validateNodeId(input.actorNodeId, 'actor node id');
  validateNodeId(input.plan?.nodeId);
  if (typeof input.plan?.hostAlias !== 'string' || !HOST_ALIAS.test(input.plan.hostAlias)) {
    throw new Error('host alias is invalid');
  }
  if (typeof input.identityPublicKeyFingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/=_-]+$/.test(input.identityPublicKeyFingerprint)) {
    throw new Error('identity public key fingerprint is invalid');
  }
  const now = input.now ?? (() => new Date());
  return withRegistryLock(input.organizationRoot, async () => {
    const file = registryPath(input.organizationRoot);
    let raw: NodeRegistry;
    try {
      raw = JSON.parse(await readFile(file, 'utf8')) as NodeRegistry;
    } catch {
      throw new Error('local primary must be registered before an auxiliary node');
    }
    const registry = await readRegistry(file, raw.primaryNodeId);
    if (input.actorNodeId !== registry.primaryNodeId) {
      throw new Error('only the primary node may register auxiliary nodes');
    }
    if (registry.nodes.some((node) => node.id === input.plan.nodeId)) {
      throw new Error(`node already exists: ${input.plan.nodeId}`);
    }
    const entry: NodeRegistryEntry = {
      id: input.plan.nodeId,
      host: input.plan.hostAlias,
      role: 'auxiliary',
      authority: 'execution_only',
      status: 'pending',
      bridgeProfile: null,
      workspace: null,
      messageGate: 'internal_only',
      capabilities: validateCapabilities(input.plan.capabilities),
      adapterId: 'restricted_ssh_pull',
      identityPublicKeyFingerprint: input.identityPublicKeyFingerprint,
      updatedAt: now().toISOString(),
    };
    registry.nodes.push(entry);
    await writeRegistry(file, registry);
    return structuredClone(entry);
  });
}

export async function activateAuxiliaryNode(input: {
  organizationRoot: string;
  actorNodeId: string;
  nodeId: string;
  bridgeProfile: string;
  workspace: string;
  now?: () => Date;
}): Promise<NodeRegistryEntry> {
  validateNodeId(input.actorNodeId, 'actor node id');
  validateNodeId(input.nodeId);
  if (typeof input.bridgeProfile !== 'string' || !input.bridgeProfile.trim()) {
    throw new Error('bridge profile is required');
  }
  if (typeof input.workspace !== 'string' || !isAbsolute(input.workspace)) {
    throw new Error('workspace must be absolute');
  }
  const now = input.now ?? (() => new Date());
  return withRegistryLock(input.organizationRoot, async () => {
    const file = registryPath(input.organizationRoot);
    const raw = JSON.parse(await readFile(file, 'utf8')) as NodeRegistry;
    const registry = await readRegistry(file, raw.primaryNodeId);
    if (input.actorNodeId !== registry.primaryNodeId) {
      throw new Error('only the primary node may activate auxiliary nodes');
    }
    const index = registry.nodes.findIndex((node) => node.id === input.nodeId);
    const current = registry.nodes[index];
    if (!current || current.role !== 'auxiliary' || current.authority !== 'execution_only') {
      throw new Error(`pending auxiliary node is missing: ${input.nodeId}`);
    }
    const updated: NodeRegistryEntry = {
      ...current,
      status: 'online',
      bridgeProfile: input.bridgeProfile.trim(),
      workspace: resolve(input.workspace),
      updatedAt: now().toISOString(),
    };
    registry.nodes[index] = updated;
    await writeRegistry(file, registry);
    return structuredClone(updated);
  });
}

export async function listOrganizationNodes(organizationRoot: string): Promise<NodeRegistryEntry[]> {
  const file = registryPath(organizationRoot);
  const raw = JSON.parse(await readFile(file, 'utf8')) as NodeRegistry;
  return (await readRegistry(file, raw.primaryNodeId)).nodes.map((node) => structuredClone(node));
}
