import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAppPaths } from '../../config/app-paths';
import { ensureDefaultOrganization } from '../../organization/initializer';

export interface WorkflowCommandOptions {
  rootDir?: string;
  input?: string;
  output?: (line: string) => void;
  createUpdater?: (organizationRoot: string) => any;
}

async function readBoundedStdin(maxBytes = 512 * 1024): Promise<string> {
  let value = '';
  for await (const chunk of process.stdin) {
    value += String(chunk);
    if (Buffer.byteLength(value, 'utf8') > maxBytes) {
      throw new Error('workflow update input is too large');
    }
  }
  return value.trim();
}

function workflowRuntimeEntry(): string {
  const source = join(process.cwd(), 'department-runtime', 'department-workflow-updater.mjs');
  if (existsSync(source)) return pathToFileURL(source).href;
  return new URL('../department-runtime/department-workflow-updater.mjs', import.meta.url).href;
}

async function updaterFor(rootDir: string, options: WorkflowCommandOptions): Promise<any> {
  const initialized = await ensureDefaultOrganization({ rootDir });
  if (options.createUpdater) return options.createUpdater(initialized.organizationRoot);
  const { DepartmentWorkflowUpdater } = await import(/* @vite-ignore */ workflowRuntimeEntry());
  return new DepartmentWorkflowUpdater({ organizationRoot: initialized.organizationRoot });
}

export async function runOrganizationWorkflowShow(
  departmentId: string,
  options: WorkflowCommandOptions = {},
): Promise<unknown> {
  const rootDir = options.rootDir ?? resolveAppPaths().rootDir;
  const updater = await updaterFor(rootDir, options);
  const result = updater.show(departmentId);
  (options.output ?? console.log)(JSON.stringify(result, null, 2));
  return result;
}

export async function runOrganizationWorkflowApply(
  departmentId: string,
  options: WorkflowCommandOptions = {},
): Promise<unknown> {
  const raw = (options.input ?? await readBoundedStdin()).trim();
  if (!raw) throw new Error('workflow apply requires one JSON object on stdin');
  let request: unknown;
  try {
    request = JSON.parse(raw);
  } catch (error) {
    throw new Error(`workflow apply input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const rootDir = options.rootDir ?? resolveAppPaths().rootDir;
  const updater = await updaterFor(rootDir, options);
  const result = updater.apply(departmentId, request);
  (options.output ?? console.log)(JSON.stringify(result, null, 2));
  return result;
}
