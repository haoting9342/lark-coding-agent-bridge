import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { doctorOrganization } from '../../../src/organization/doctor';
import { ensureDefaultOrganization } from '../../../src/organization/initializer';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('organization doctor', () => {
  it('reports a freshly initialized organization as ready', async () => {
    const root = await mkdtemp(join(tmpdir(), 'department-doctor-'));
    roots.push(root);
    await ensureDefaultOrganization({ rootDir: root });

    const report = await doctorOrganization({ rootDir: root });

    expect(report.ready).toBe(true);
    expect(report.organizationId).toBe('default');
    expect(report.checks.every((check) => check.ok)).toBe(true);
  });

  it('reports invalid control-plane JSON without rewriting it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'department-doctor-'));
    roots.push(root);
    const initialized = await ensureDefaultOrganization({ rootDir: root });
    const registry = join(initialized.organizationRoot, 'company', 'department-registry.json');
    await writeFile(registry, '{broken', 'utf8');

    const report = await doctorOrganization({ rootDir: root });

    expect(report.ready).toBe(false);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: 'department-registry', ok: false }),
    );
    await expect(import('node:fs/promises').then(({ readFile }) => readFile(registry, 'utf8'))).resolves.toBe('{broken');
  });
});
