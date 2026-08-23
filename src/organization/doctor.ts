import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { organizationRoot } from './paths';
import { parseOrganizationManifest } from './schema';

export interface OrganizationCheck {
  id: string;
  ok: boolean;
  detail: string;
}

export interface OrganizationDoctorReport {
  ready: boolean;
  organizationId: string;
  organizationRoot: string;
  checks: OrganizationCheck[];
}

export async function doctorOrganization(options: {
  rootDir: string;
  organizationId?: string;
}): Promise<OrganizationDoctorReport> {
  const organizationId = options.organizationId ?? 'default';
  const root = organizationRoot(options.rootDir, organizationId);
  const checks = await Promise.all([
    checkDirectory('organization-root', root),
    checkManifest(join(root, 'organization.json'), organizationId),
    checkJson('department-registry', join(root, 'company', 'department-registry.json')),
    checkJson('group-router', join(root, 'router', 'group-router.json')),
    checkDirectory('departments', join(root, 'departments')),
    checkDirectory('transactions', join(root, 'transactions')),
    checkDirectory('nodes', join(root, 'nodes')),
    checkDirectory('capabilities', join(root, 'capabilities')),
  ]);
  return {
    ready: checks.every((check) => check.ok),
    organizationId,
    organizationRoot: root,
    checks,
  };
}

async function checkDirectory(id: string, path: string): Promise<OrganizationCheck> {
  try {
    const info = await lstat(path);
    const ok = info.isDirectory() && !info.isSymbolicLink();
    return { id, ok, detail: ok ? path : 'not a regular directory' };
  } catch (error) {
    return { id, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkManifest(path: string, organizationId: string): Promise<OrganizationCheck> {
  try {
    const manifest = parseOrganizationManifest(JSON.parse(await readFile(path, 'utf8')));
    const ok = manifest.organizationId === organizationId;
    return { id: 'organization-manifest', ok, detail: ok ? manifest.templateVersion : 'id mismatch' };
  } catch (error) {
    return { id: 'organization-manifest', ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkJson(id: string, path: string): Promise<OrganizationCheck> {
  try {
    JSON.parse(await readFile(path, 'utf8'));
    return { id, ok: true, detail: path };
  } catch (error) {
    return { id, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
