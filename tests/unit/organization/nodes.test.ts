import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureLocalPrimaryNode,
  planAuxiliaryNodeInvite,
  registerAuxiliaryNode,
  activateAuxiliaryNode,
} from '../../../src/organization/nodes.js';

function fixture() {
  const organizationRoot = mkdtempSync(join(tmpdir(), 'organization-nodes-'));
  return { organizationRoot, registryFile: join(organizationRoot, 'nodes', 'node-registry.json') };
}

describe('organization node registry', () => {
  it('registers exactly one local primary and enriches it idempotently', async () => {
    const h = fixture();
    await ensureLocalPrimaryNode({
      organizationRoot: h.organizationRoot,
      primaryNodeId: 'local_primary',
      host: 'macbook',
      bridgeProfile: 'codex',
      workspace: '/work/content',
      now: () => new Date('2026-08-23T10:00:00.000Z'),
    });
    await ensureLocalPrimaryNode({
      organizationRoot: h.organizationRoot,
      primaryNodeId: 'local_primary',
      host: 'macbook',
      bridgeProfile: 'codex',
      workspace: '/work/content',
      now: () => new Date('2026-08-23T10:00:00.000Z'),
    });

    const registry = JSON.parse(readFileSync(h.registryFile, 'utf8'));
    expect(registry.primaryNodeId).toBe('local_primary');
    expect(registry.nodes).toHaveLength(1);
    expect(registry.nodes[0]).toMatchObject({
      id: 'local_primary', role: 'primary', authority: 'governance', status: 'online',
    });
  });

  it('plans a dedicated forced-command identity without changing SSH or creating a key', () => {
    const h = fixture();
    const plan = planAuxiliaryNodeInvite({
      organizationRoot: h.organizationRoot,
      nodeId: 'mac_aux',
      hostAlias: 'primary-host',
      capabilities: ['authenticated_browser'],
    });

    expect(plan.role).toBe('auxiliary');
    expect(plan.authority).toBe('execution_only');
    expect(plan.identityFile).toContain('nodes/identities/mac_aux');
    expect(plan.forcedCommand).toBe(
      'lark-channel-bridge-department organization handoff-serve mac_aux',
    );
    expect(existsSync(plan.identityFile)).toBe(false);
    expect(existsSync(join(h.organizationRoot, 'nodes'))).toBe(false);
  });

  it('rejects host aliases that SSH could parse as options', () => {
    const h = fixture();
    expect(() => planAuxiliaryNodeInvite({
      organizationRoot: h.organizationRoot,
      nodeId: 'mac_aux',
      hostAlias: '-oProxyCommand',
      capabilities: [],
    })).toThrow(/host alias is invalid/);
  });

  it('allows only the primary to register an execution-only auxiliary node', async () => {
    const h = fixture();
    await ensureLocalPrimaryNode({
      organizationRoot: h.organizationRoot,
      primaryNodeId: 'local_primary',
      host: 'goblin',
      bridgeProfile: 'codex',
      workspace: '/work/main',
    });
    const plan = planAuxiliaryNodeInvite({
      organizationRoot: h.organizationRoot,
      nodeId: 'mac_aux',
      hostAlias: 'goblin',
      capabilities: ['authenticated_browser'],
    });

    await expect(registerAuxiliaryNode({
      organizationRoot: h.organizationRoot,
      actorNodeId: 'mac_aux',
      plan,
      identityPublicKeyFingerprint: 'SHA256:aux',
    })).rejects.toThrow(/primary.*register/i);

    await expect(registerAuxiliaryNode({
      organizationRoot: h.organizationRoot,
      actorNodeId: 'local_primary',
      plan: { ...plan, hostAlias: '-oProxyCommand' },
      identityPublicKeyFingerprint: 'SHA256:aux',
    })).rejects.toThrow(/host alias is invalid/);

    await registerAuxiliaryNode({
      organizationRoot: h.organizationRoot,
      actorNodeId: 'local_primary',
      plan,
      identityPublicKeyFingerprint: 'SHA256:aux',
    });
    const registry = JSON.parse(readFileSync(h.registryFile, 'utf8'));
    expect(registry.nodes).toHaveLength(2);
    expect(registry.nodes[1]).toMatchObject({
      id: 'mac_aux', role: 'auxiliary', authority: 'execution_only', messageGate: 'internal_only',
    });

    await activateAuxiliaryNode({
      organizationRoot: h.organizationRoot,
      actorNodeId: 'local_primary',
      nodeId: 'mac_aux',
      bridgeProfile: 'mac-codex',
      workspace: '/work/mac-aux',
    });
    const activated = JSON.parse(readFileSync(h.registryFile, 'utf8'));
    expect(activated.nodes[1]).toMatchObject({
      id: 'mac_aux', status: 'online', bridgeProfile: 'mac-codex', workspace: '/work/mac-aux',
    });
  });
});
