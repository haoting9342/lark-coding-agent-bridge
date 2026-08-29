import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function runtimeEntry(): string {
  const packaged = new URL('../department-runtime/workbuddy-department-installer.mjs', import.meta.url);
  if (existsSync(new URL(packaged))) return packaged.href;
  return new URL('../../../department-runtime/workbuddy-department-installer.mjs', import.meta.url).href;
}

export interface WorkBuddyCreateOptions {
  spec?: string;
  workspace?: string;
  name?: string;
  purpose?: string;
  responsibility?: string[];
  departmentId?: string;
  confirmCreate?: boolean;
  confirmationMessage?: string;
}

export async function runWorkBuddyCreate(options: WorkBuddyCreateOptions): Promise<unknown> {
  if (!options.spec) {
    throw new Error('旧版 workbuddy create 不再支持填写名称后直接创建；请先执行 workbuddy department init，与 WorkBuddy 自由讨论并保存草案，再使用 department import');
  }
  const { createWorkBuddyDepartment, readWorkBuddySpec } = await import(/* @vite-ignore */ runtimeEntry());
  const spec = options.spec
    ? readWorkBuddySpec(resolve(options.spec))
    : {};
  const {
    confirmCreate: _embeddedConfirmation,
    confirmationMessage: _embeddedConfirmationMessage,
    ...safeSpec
  } = spec;
  const input = {
    ...safeSpec,
    ...(options.workspace ? { workspace: options.workspace } : {}),
    ...(options.name ? { departmentName: options.name } : {}),
    ...(options.purpose ? { purpose: options.purpose } : {}),
    ...(options.responsibility?.length ? { responsibilities: options.responsibility } : {}),
    ...(options.departmentId ? { departmentId: options.departmentId } : {}),
    confirmCreate: options.confirmCreate === true,
    confirmationMessage: options.confirmationMessage,
    requireDesignDraft: true,
  };
  if (!input.workspace || !input.departmentName || !input.purpose) {
    throw new Error('WorkBuddy 创建需要 --workspace、--name、--purpose，或通过 --spec 提供完整规格');
  }
  const result = createWorkBuddyDepartment(input);
  console.log(JSON.stringify(result, null, 2));
  return result;
}
