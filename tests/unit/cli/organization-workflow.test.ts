import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  runOrganizationWorkflowApply,
  runOrganizationWorkflowProtocol,
  runOrganizationWorkflowShow,
} from '../../../src/cli/commands/organization-workflow.js';
import { ensureDefaultOrganization } from '../../../src/organization/initializer.js';

describe('organization workflow CLI contract', () => {
  it('does not load workflow code from the current working directory', async () => {
    const source = await readFile(
      join(process.cwd(), 'src', 'cli', 'commands', 'organization-workflow.ts'),
      'utf8',
    );

    expect(source).not.toContain('process.cwd()');
  });

  it('prints only one requested protocol', async () => {
    const output: string[] = [];
    const result = await runOrganizationWorkflowProtocol('public_course', 'make_slides', {
      rootDir: '/tmp/root',
      createUpdater: () => ({
        protocol: () => ({ departmentId: 'public_course', protocol: { id: 'make_slides' } }),
      }),
      output: (line) => output.push(line),
    });

    expect(result).toEqual({ departmentId: 'public_course', protocol: { id: 'make_slides' } });
    expect(output.join('\n')).not.toContain('taskProtocols');
  });

  it('shows the authoritative workflow metadata as JSON', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'organization-workflow-cli-'));
    const initialized = await ensureDefaultOrganization({ rootDir });
    const departmentRoot = join(initialized.organizationRoot, 'departments', 'public_course');
    await mkdir(departmentRoot);
    await writeFile(join(departmentRoot, 'workflow.json'), JSON.stringify({
      schemaVersion: 1,
      revision: 3,
      semantics: 'task_execution',
      taskProtocols: [],
    }));
    const output: string[] = [];

    const result = await runOrganizationWorkflowShow('public_course', {
      rootDir,
      createUpdater: () => ({
        show: () => ({ departmentId: 'public_course', revision: 3 }),
      }),
      output: (line) => output.push(line),
    });

    expect(result).toMatchObject({ departmentId: 'public_course', revision: 3 });
    expect(JSON.parse(output.join('\n'))).toMatchObject({
      departmentId: 'public_course', revision: 3,
    });
  });

  it('rejects an empty apply request before invoking the updater', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'organization-workflow-cli-'));
    await ensureDefaultOrganization({ rootDir });

    await expect(runOrganizationWorkflowApply('public_course', { rootDir, input: '' }))
      .rejects.toThrow(/JSON object/i);
  });
});
