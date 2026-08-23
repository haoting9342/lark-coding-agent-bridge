import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DepartmentCommandRuntime } from './department-command-runtime.mjs';
import { inventoryDepartmentContext } from './department-context-inventory.mjs';
import { DepartmentDesignStore } from './department-design-store.mjs';

const runtimes = new Map();
const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));

function requiredAbsolute(context, key) {
  const value = context[key];
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error(`department bridge context ${key} must be an absolute path`);
  }
  return value;
}

export async function getDepartmentRuntime(bridgeContext) {
  const organizationRoot = requiredAbsolute(bridgeContext, 'organizationRoot');
  const profileRoot = requiredAbsolute(bridgeContext, 'profileRoot');
  const key = `${organizationRoot}|${bridgeContext.profile}`;
  const existing = runtimes.get(key);
  if (existing) return existing;

  const storeFile = path.join(profileRoot, 'departments', 'design-sessions.json');
  const designStore = new DepartmentDesignStore(storeFile);
  const runtime = new DepartmentCommandRuntime({
    designStore,
    isDepartmentAdmin: (context) => context.isDepartmentAdmin === true,
    provisioner: {
      provision() {
        const error = new Error('Node-native department provisioner is not ready');
        error.stage = 'provisioner_unavailable';
        throw error;
      },
    },
    inventoryContext: (context) => inventoryDepartmentContext({
      workspace: context.currentWorkspace,
      capabilityCatalog: [],
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
