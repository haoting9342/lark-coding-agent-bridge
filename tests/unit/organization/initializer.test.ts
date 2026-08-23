import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureDefaultOrganization,
  resolveOrganizationTemplateRoot,
} from '../../../src/organization/initializer';
import { organizationRoot } from '../../../src/organization/paths';

const roots: string[] = [];

async function tempRoot(prefix = 'department-organization-'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('default organization initializer', () => {
  it('atomically creates a generic empty organization', async () => {
    const root = await tempRoot();

    const result = await ensureDefaultOrganization({ rootDir: root });

    expect(result.created).toBe(true);
    expect(result.organizationRoot).toBe(organizationRoot(root));
    const organization = JSON.parse(
      await readFile(join(result.organizationRoot, 'organization.json'), 'utf8'),
    );
    expect(organization).toMatchObject({
      schemaVersion: 1,
      templateVersion: '1.0.0',
      organizationId: 'default',
      primaryNodeId: 'local_primary',
    });
    expect(Number.isFinite(Date.parse(organization.createdAt))).toBe(true);

    const registry = JSON.parse(
      await readFile(join(result.organizationRoot, 'company', 'department-registry.json'), 'utf8'),
    );
    const router = JSON.parse(
      await readFile(join(result.organizationRoot, 'router', 'group-router.json'), 'utf8'),
    );
    expect(registry.departments).toEqual([]);
    expect(router.routes).toEqual([]);

    const serialized = [organization, registry, router]
      .map((value) => JSON.stringify(value))
      .join('\n');
    expect(serialized).not.toMatch(/V智|自媒体|公开课|\/Users\/crystal|\/home\/hao|oc_[A-Za-z0-9_]+/);
  });

  it('is idempotent and never overwrites user-owned department data', async () => {
    const root = await tempRoot();
    const first = await ensureDefaultOrganization({ rootDir: root });
    const userFile = join(first.organizationRoot, 'departments', 'user-owned.json');
    await writeFile(userFile, '{"kept":true}\n', 'utf8');

    const second = await ensureDefaultOrganization({ rootDir: root });

    expect(second.created).toBe(false);
    await expect(readFile(userFile, 'utf8')).resolves.toBe('{"kept":true}\n');
  });

  it('rejects symlinks in a template without leaving a partial organization', async () => {
    const root = await tempRoot();
    const template = await tempRoot('department-template-');
    await mkdir(join(template, 'company'), { recursive: true });
    await writeFile(
      join(template, 'organization.json'),
      JSON.stringify({
        schemaVersion: 1,
        templateVersion: '1.0.0',
        organizationId: 'default',
        primaryNodeId: 'local_primary',
        createdAt: null,
      }),
    );
    await symlink('/tmp', join(template, 'company', 'escaped'));

    await expect(
      ensureDefaultOrganization({ rootDir: root, templateRoot: template }),
    ).rejects.toThrow(/symbolic link/i);
    await expect(readFile(join(organizationRoot(root), 'organization.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('resolves the bundled template from the repository during source tests', () => {
    expect(resolveOrganizationTemplateRoot()).toBe(
      join(process.cwd(), 'assets', 'organization-template'),
    );
  });
});
