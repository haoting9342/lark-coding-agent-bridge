import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ORGANIZATION_ID,
  organizationRoot,
  organizationsRoot,
} from './paths';
import { parseOrganizationManifest } from './schema';

const REQUIRED_DIRECTORIES = [
  'company',
  'departments',
  'router',
  'onboarding',
  'transactions',
  'nodes',
  'capabilities',
  'backups',
];

export interface EnsureOrganizationOptions {
  rootDir: string;
  organizationId?: string;
  templateRoot?: string;
}

export interface EnsureOrganizationResult {
  created: boolean;
  organizationRoot: string;
}

export function resolveOrganizationTemplateRoot(): string {
  const override = process.env.LARK_CHANNEL_DEPARTMENT_TEMPLATE_ROOT;
  if (override) return resolve(override);

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const entry = process.argv[1] ? dirname(resolve(process.argv[1])) : null;
  const candidates = [
    resolve(moduleDir, '../../assets/organization-template'),
    resolve(moduleDir, '../assets/organization-template'),
    ...(entry ? [resolve(entry, '../assets/organization-template')] : []),
    resolve(process.cwd(), 'assets/organization-template'),
  ];
  const match = candidates.find((candidate) => existsSync(join(candidate, 'organization.json')));
  if (!match) throw new Error('bundled organization template is missing');
  return match;
}

export async function ensureDefaultOrganization(
  options: EnsureOrganizationOptions,
): Promise<EnsureOrganizationResult> {
  const organizationId = options.organizationId ?? DEFAULT_ORGANIZATION_ID;
  const target = organizationRoot(options.rootDir, organizationId);
  if (existsSync(target)) {
    await validateInitializedOrganization(target, organizationId);
    return { created: false, organizationRoot: target };
  }

  const templateRoot = resolve(options.templateRoot ?? resolveOrganizationTemplateRoot());
  const parent = organizationsRoot(options.rootDir);
  const temporary = join(parent, `.${organizationId}.init-${randomUUID()}`);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  try {
    await copyTemplateTree(templateRoot, temporary);
    for (const directory of REQUIRED_DIRECTORIES) {
      await mkdir(join(temporary, directory), { recursive: true, mode: 0o700 });
      await chmod(join(temporary, directory), 0o700);
    }
    const manifestFile = join(temporary, 'organization.json');
    const templateManifest = JSON.parse(await readFile(manifestFile, 'utf8')) as Record<string, unknown>;
    const manifest = {
      ...templateManifest,
      organizationId,
      createdAt: new Date().toISOString(),
    };
    parseOrganizationManifest(manifest);
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    await chmod(manifestFile, 0o600);
    await validateInitializedOrganization(temporary, organizationId);
    try {
      await rename(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !existsSync(target)) throw error;
      await validateInitializedOrganization(target, organizationId);
      await rm(temporary, { recursive: true, force: true });
      return { created: false, organizationRoot: target };
    }
    return { created: true, organizationRoot: target };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

async function copyTemplateTree(source: string, destination: string): Promise<void> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error(`symbolic link is not allowed in organization template: ${source}`);
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(source)) {
      await copyTemplateTree(join(source, entry), join(destination, entry));
    }
    await chmod(destination, 0o700);
    return;
  }
  if (!info.isFile()) throw new Error(`unsupported organization template entry: ${source}`);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source, destination);
  await chmod(destination, 0o600);
}

async function validateInitializedOrganization(
  target: string,
  expectedOrganizationId: string,
): Promise<void> {
  const info = await lstat(target);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`organization root must be a regular directory: ${target}`);
  }
  const manifest = parseOrganizationManifest(
    JSON.parse(await readFile(join(target, 'organization.json'), 'utf8')),
  );
  if (manifest.organizationId !== expectedOrganizationId) {
    throw new Error(`organization id mismatch: ${manifest.organizationId}`);
  }
  for (const directory of REQUIRED_DIRECTORIES) {
    const directoryInfo = await lstat(join(target, directory));
    if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
      throw new Error(`organization directory is invalid: ${directory}`);
    }
  }
  for (const file of [
    'company/company-policy.json',
    'company/approval-policy.json',
    'company/capability-catalog.json',
    'company/department-registry.json',
    'router/group-router.json',
  ]) {
    JSON.parse(await readFile(join(target, file), 'utf8'));
  }
}
