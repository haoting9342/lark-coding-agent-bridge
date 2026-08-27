import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  runOrganizationWorkflowApply,
  runOrganizationWorkflowShow,
} from '../../../src/cli/commands/organization-workflow.js';
import { ensureDefaultOrganization } from '../../../src/organization/initializer.js';

describe('organization workflow CLI contract', () => {
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
