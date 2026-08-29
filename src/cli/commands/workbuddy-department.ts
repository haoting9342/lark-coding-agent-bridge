import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function runtimeEntry(file: string): string {
  const packaged = new URL(`../department-runtime/${file}`, import.meta.url);
  if (existsSync(packaged)) return packaged.href;
  return new URL(`../../../department-runtime/${file}`, import.meta.url).href;
}

export interface WorkBuddyDepartmentInitOptions {
  workspace: string;
  output?: (line: string) => void;
}

export interface WorkBuddyDepartmentImportOptions {
  workspace: string;
  spec: string;
  departmentId?: string;
  confirmCreate?: boolean;
  confirmationMessage?: string;
  output?: (line: string) => void;
}

export interface WorkBuddyDepartmentDraftOptions {
  workspace: string;
  spec: string;
  output?: (line: string) => void;
}

export interface WorkBuddyDepartmentResult {
  platform: string;
  status: string;
  [key: string]: unknown;
}

export async function runWorkBuddyDepartmentInit(
  options: WorkBuddyDepartmentInitOptions,
): Promise<WorkBuddyDepartmentResult> {
  const runtime = await import(/* @vite-ignore */ runtimeEntry('workbuddy-workspace-initializer.mjs'));
  const result = runtime.initializeWorkBuddyWorkspace({ workspace: resolve(options.workspace) }) as WorkBuddyDepartmentResult;
  (options.output ?? console.log)(JSON.stringify(result, null, 2));
  return result;
}

export async function runWorkBuddyDepartmentDraft(
  options: WorkBuddyDepartmentDraftOptions,
): Promise<WorkBuddyDepartmentResult> {
  const initializer = await import(/* @vite-ignore */ runtimeEntry('workbuddy-workspace-initializer.mjs'));
  const sessionService = await import(/* @vite-ignore */ runtimeEntry('workbuddy-session-service.mjs'));
  const input = initializer.readWorkBuddySpec(resolve(options.spec)) as Record<string, unknown>;
  const { departmentId: _ignored, ...proposal } = input;
  const result = sessionService.saveWorkBuddyDesignDraft({
    workspace: resolve(options.workspace),
    proposal,
  }) as WorkBuddyDepartmentResult;
  (options.output ?? console.log)(JSON.stringify(result, null, 2));
  return result;
}

export async function runWorkBuddyDepartmentImport(
  options: WorkBuddyDepartmentImportOptions,
): Promise<WorkBuddyDepartmentResult> {
  if (!options.confirmCreate) {
    throw new Error('正式创建必须在用户明确确认后传入 --confirm-create');
  }
  const initializer = await import(/* @vite-ignore */ runtimeEntry('workbuddy-workspace-initializer.mjs'));
  const sessionService = await import(/* @vite-ignore */ runtimeEntry('workbuddy-session-service.mjs'));
  const workspace = resolve(options.workspace);
  const input = initializer.readWorkBuddySpec(resolve(options.spec)) as Record<string, unknown>;
  const departmentId = options.departmentId ?? String(input.departmentId ?? '');
  if (!departmentId) throw new Error('规格文件需要 departmentId，或使用 --department-id 指定');
  const { departmentId: _ignored, ...draft } = input;
  const result = sessionService.confirmAndProvisionWorkBuddyDepartment({
    workspace,
    departmentId,
    draft: { ...draft, workspace },
    confirmationMessage: options.confirmationMessage,
    requireDesignDraft: true,
  }) as WorkBuddyDepartmentResult;
  (options.output ?? console.log)(JSON.stringify(result, null, 2));
  return result;
}
