import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseForcedHandoffCommand,
  runOrganizationNodeList,
  runOrganizationNodePlan,
} from '../../../src/cli/commands/organization-node.js';
import { ensureDefaultOrganization } from '../../../src/organization/initializer.js';
import { ensureLocalPrimaryNode } from '../../../src/organization/nodes.js';

describe('organization node CLI contract', () => {
  it('prints local nodes and produces a non-mutating auxiliary pairing plan', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'organization-node-cli-'));
    const initialized = await ensureDefaultOrganization({ rootDir });
    await ensureLocalPrimaryNode({
      organizationRoot: initialized.organizationRoot,
      primaryNodeId: 'local_primary',
      host: 'goblin',
      bridgeProfile: 'codex',
      workspace: '/work/main',
    });
    const lines: string[] = [];

    await runOrganizationNodeList({ rootDir, output: (line) => lines.push(line) });
    const plan = await runOrganizationNodePlan('mac_aux', {
      rootDir,
      hostAlias: 'goblin',
      capabilities: ['authenticated_browser'],
      output: (line) => lines.push(line),
    });

    expect(lines.join('\n')).toContain('local_primary');
    expect(plan.forcedCommand).toBe(
      'lark-channel-bridge-department organization handoff-serve mac_aux',
    );
    const registry = JSON.parse(await readFile(
      join(initialized.organizationRoot, 'nodes', 'node-registry.json'), 'utf8',
    )) as { nodes: unknown[] };
    expect(registry.nodes).toHaveLength(1);
  });

  it('accepts only the exact bounded command for the paired node', () => {
    expect(parseForcedHandoffCommand(
      'lark-channel-bridge-department organization handoff-operation media_content mac_aux claim',
      'mac_aux',
    )).toEqual({
      departmentId: 'media_content',
      nodeId: 'mac_aux',
      operation: 'claim',
    });

    expect(() => parseForcedHandoffCommand(
      'lark-channel-bridge-department organization handoff-operation media_content other claim',
      'mac_aux',
    )).toThrow(/paired node/i);
    expect(() => parseForcedHandoffCommand(
      'lark-channel-bridge-department organization handoff-operation media_content mac_aux claim; id',
      'mac_aux',
    )).toThrow(/forced handoff command/i);
    expect(() => parseForcedHandoffCommand(
      'lark-channel-bridge-department organization handoff-operation media_content mac_aux cancel',
      'mac_aux',
    )).toThrow(/invalid/i);
  });
});
