import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { DepartmentCommandRuntime } from './department-command-runtime.mjs';
import { DepartmentCapabilityMaterializer } from './department-capability-materializer.mjs';
import { inventoryDepartmentContext } from './department-context-inventory.mjs';
import { DepartmentDesignStore } from './department-design-store.mjs';
import { DepartmentProvisioner } from './department-provisioner.mjs';

const runtimes = new Map();
const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));

function requiredAbsolute(context, key) {
  const value = context[key];
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`department bridge context ${key} must be an absolute path`);
  }
  return value;
}

function loadCapabilityCatalog(organizationRoot) {
  const file = path.join(organizationRoot, 'company', 'capability-catalog.json');
  if (!existsSync(file)) throw new Error(`capability catalog is missing: ${file}`);
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('capability catalog must be a regular file');
  const document = JSON.parse(readFileSync(file, 'utf8'));
  if (document.schemaVersion !== 1 || !Array.isArray(document.capabilities)) {
    throw new Error('capability catalog schema is invalid');
  }
  return document.capabilities;
}

export function resolveAgentSkillsRoot({ agentKind, profileRoot, codex = {} }) {
  if (agentKind === 'codex') {
    const codexRoot = codex.codexHome
      ? path.resolve(codex.codexHome)
      : codex.ignoreUserConfig === true
        ? path.join(path.resolve(profileRoot), 'codex-home')
        : path.resolve(process.env.CODEX_HOME ?? path.join(homedir(), '.codex'));
    return path.join(codexRoot, 'skills');
  }
  return path.join(homedir(), '.claude', 'skills');
}

export async function getDepartmentRuntime(bridgeContext) {
  const organizationRoot = requiredAbsolute(bridgeContext, 'organizationRoot');
  const profileRoot = requiredAbsolute(bridgeContext, 'profileRoot');
  const key = `${organizationRoot}|${bridgeContext.profile}`;
  const existing = runtimes.get(key);
  if (existing) return existing;

  const storeFile = path.join(profileRoot, 'departments', 'design-sessions.json');
  const designStore = new DepartmentDesignStore(storeFile);
  const capabilityCatalog = loadCapabilityCatalog(organizationRoot);
  const hostSkillsRoot = resolveAgentSkillsRoot({
    agentKind: bridgeContext.agentKind,
    profileRoot,
    codex: bridgeContext.codex,
  });
  const capabilityMaterializer = new DepartmentCapabilityMaterializer({
    hostSkillsRoot,
    skillRoots: [hostSkillsRoot],
    builtinCapabilities: capabilityCatalog
      .filter((item) => item?.kind === 'builtin' && item?.source?.type === 'builtin')
      .map((item) => item.source.name),
    allowedLocalSkillRoots: [hostSkillsRoot, path.join(organizationRoot, 'capabilities')],
  });
  const provisioner = new DepartmentProvisioner({
    organizationRoot,
    profileRoot,
    routeController: {
      current: bridgeContext.currentWorkspaceRoute ?? (() => undefined),
      apply: bridgeContext.applyWorkspaceRoute ?? (() => {}),
      restore: bridgeContext.restoreWorkspaceRoute ?? (() => {}),
    },
    capabilityMaterializer,
  });
  const runtime = new DepartmentCommandRuntime({
    designStore,
    isDepartmentAdmin: (context) => context.isDepartmentAdmin === true,
    provisioner,
    inventoryContext: (context) => inventoryDepartmentContext({
      workspace: context.currentWorkspace,
      capabilityCatalog,
      contextQuery: context.contextQuery,
    }),
    draftCli: path.join(MODULE_ROOT, 'department-draft-cli.mjs'),
    storeFile,
    applyWorkspaceRoute: bridgeContext.applyWorkspaceRoute,
    log: bridgeContext.log,
  });
  runtimes.set(key, runtime);
  return runtime;
}

export function resetDepartmentRuntimesForTests() {
  runtimes.clear();
}
