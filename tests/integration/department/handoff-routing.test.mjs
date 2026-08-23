import { describe, expect, it, vi } from 'vitest';
import {
  RestrictedSshHandoffAdapter,
  selectHandoffNode,
} from '../../../department-runtime/department-handoff-adapter.mjs';

const topology = {
  primaryNodeId: 'goblin_primary',
  nodes: [
    { id: 'goblin_primary', role: 'primary', capabilities: ['research'] },
    { id: 'mac_aux', role: 'auxiliary', capabilities: ['authenticated_browser'] },
    { id: 'mac_backup', role: 'auxiliary', capabilities: ['authenticated_browser'] },
  ],
};

describe('multi-host handoff routing', () => {
  it('selects an online capable preferred node', () => {
    expect(selectHandoffNode({
      topology,
      executionPolicy: {
        preferredNodeId: 'mac_aux', requiredCapabilities: ['authenticated_browser'],
        fallbackNodeIds: ['mac_backup'], failoverPolicy: 'manual', risk: 'identity_bound', idempotent: false,
      },
      nodeStatuses: { mac_aux: 'online', mac_backup: 'online' },
    })).toEqual({ status: 'selected', nodeId: 'mac_aux', failover: false });
  });

  it('waits for an offline identity-bound node instead of moving identity or fabricating work', () => {
    const result = selectHandoffNode({
      topology,
      executionPolicy: {
        preferredNodeId: 'mac_aux', requiredCapabilities: ['authenticated_browser'],
        fallbackNodeIds: ['mac_backup'], failoverPolicy: 'automatic', risk: 'identity_bound', idempotent: true,
      },
      nodeStatuses: { mac_aux: 'offline', mac_backup: 'online' },
    });
    expect(result).toMatchObject({ status: 'waiting', reason: 'identity_bound_node_unavailable' });
    expect(result.options).toEqual(['wait', 'retry', 'manual']);
  });

  it('uses automatic failover only for low-risk idempotent work on a capable node', () => {
    expect(selectHandoffNode({
      topology,
      executionPolicy: {
        preferredNodeId: 'mac_aux', requiredCapabilities: ['authenticated_browser'],
        fallbackNodeIds: ['mac_backup'], failoverPolicy: 'automatic', risk: 'low', idempotent: true,
      },
      nodeStatuses: { mac_aux: 'offline', mac_backup: 'online' },
    })).toEqual({ status: 'selected', nodeId: 'mac_backup', failover: true });
  });

  it('pins a dedicated identity and a fixed product command without a shell', () => {
    const spawnSync = vi.fn(() => ({ status: 0, stdout: '{"tasks":[]}', stderr: '' }));
    const adapter = new RestrictedSshHandoffAdapter({
      sshExecutable: '/usr/bin/ssh',
      identityFile: '/private/department-key',
      hostAlias: 'goblin',
      departmentId: 'media_content',
      nodeId: 'mac_aux',
      timeoutSeconds: 17,
      spawnSync,
    });

    expect(adapter.claim()).toEqual({ tasks: [] });
    expect(spawnSync.mock.calls[0][1]).toEqual([
      '-i', '/private/department-key',
      '-o', 'IdentitiesOnly=yes',
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=17',
      'goblin',
      'lark-channel-bridge-department organization handoff-operation media_content mac_aux claim',
    ]);
    expect(spawnSync.mock.calls[0][2]).toMatchObject({ shell: false });
  });
});
