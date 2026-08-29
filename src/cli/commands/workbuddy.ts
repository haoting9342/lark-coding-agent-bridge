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
}

export async function runWorkBuddyCreate(options: WorkBuddyCreateOptions): Promise<unknown> {
  const { createWorkBuddyDepartment, readWorkBuddySpec } = await import(/* @vite-ignore */ runtimeEntry());
  const spec = options.spec
    ? readWorkBuddySpec(resolve(options.spec))
    : {};
  const input = {
    ...spec,
    ...(options.workspace ? { workspace: options.workspace } : {}),
    ...(options.name ? { departmentName: options.name } : {}),
    ...(options.purpose ? { purpose: options.purpose } : {}),
    ...(options.responsibility?.length ? { responsibilities: options.responsibility } : {}),
    ...(options.departmentId ? { departmentId: options.departmentId } : {}),
  };
  if (!input.workspace || !input.departmentName || !input.purpose) {
    throw new Error('WorkBuddy 创建需要 --workspace、--name、--purpose，或通过 --spec 提供完整规格');
  }
  const result = createWorkBuddyDepartment(input);
  console.log(JSON.stringify(result, null, 2));
  return result;
}
