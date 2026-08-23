import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  runOrganizationDoctor,
  runOrganizationStatus,
} from '../../../src/cli/commands/organization';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('organization CLI commands', () => {
  it('initializes and prints the default organization status', async () => {
    const root = await mkdtemp(join(tmpdir(), 'department-cli-organization-'));
    roots.push(root);
    const output: string[] = [];

    await runOrganizationStatus({ rootDir: root, output: (line) => output.push(line) });

    expect(output.join('\n')).toContain('organization: default');
    expect(output.join('\n')).toContain('status: ready');
  });

  it('sets a failing exit code result for an unhealthy organization doctor report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'department-cli-organization-'));
    roots.push(root);
    const output: string[] = [];

    const result = await runOrganizationDoctor({
      rootDir: root,
      initialize: false,
      output: (line) => output.push(line),
    });

    expect(result.ready).toBe(false);
    expect(output.join('\n')).toContain('status: not-ready');
  });
});
