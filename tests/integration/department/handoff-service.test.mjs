import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DepartmentHandoffService } from '../../../department-runtime/department-handoff-service.mjs';

function fixture(status = 'online') {
  const organizationRoot = mkdtempSync(path.join(tmpdir(), 'handoff-service-'));
  const departmentRoot = path.join(organizationRoot, 'departments', 'media_content');
  mkdirSync(departmentRoot, { recursive: true });
  mkdirSync(path.join(organizationRoot, 'nodes'), { recursive: true });
  writeFileSync(path.join(departmentRoot, 'workflow.json'), JSON.stringify({
    schemaVersion: 1,
    semantics: 'task_execution',
    taskProtocols: [{
      id: 'authenticated_research',
      deliverables: ['结构化摘要'],
      qualityChecks: ['含 URL 和时间'],
      executionPolicy: {
        preferredNodeId: 'mac_aux',
        requiredCapabilities: ['authenticated_browser'],
        fallbackNodeIds: [],
        failoverPolicy: 'manual',
        deliveryMode: 'primary_synthesized',
        maxSilenceSeconds: 300,
        risk: 'identity_bound',
        idempotent: false,
        periodic: false,
        directDeliveryApproved: false,
      },
    }],
  }, null, 2));
  writeFileSync(path.join(departmentRoot, 'topology.json'), JSON.stringify({
    schemaVersion: 1,
    primaryNodeId: 'goblin_primary',
    nodes: [
      { id: 'goblin_primary', role: 'primary', capabilities: [] },
      { id: 'mac_aux', role: 'auxiliary', capabilities: ['authenticated_browser'] },
    ],
  }, null, 2));
  writeFileSync(path.join(organizationRoot, 'nodes', 'node-registry.json'), JSON.stringify({
    schemaVersion: 1,
    primaryNodeId: 'goblin_primary',
    nodes: [
      { id: 'goblin_primary', status: 'online' },
      { id: 'mac_aux', status },
    ],
  }, null, 2));
  return { organizationRoot };
}

describe('automatic handoff service', () => {
  it('routes a bounded task by capability and deduplicates the same message', () => {
    const h = fixture();
    const service = new DepartmentHandoffService({
      organizationRoot: h.organizationRoot,
      departmentId: 'media_content',
    });
    const input = {
      protocolId: 'authenticated_research',
      goal: '读取登录后内容并返回证据',
      context: { request: '检查账号', acceptedFacts: ['只读'] },
      idempotencyKey: 'oc_media:om_1:authenticated_research',
      deadline: null,
    };

    const first = service.submit(input);
    const duplicate = service.submit(input);

    expect(first).toMatchObject({ status: 'queued', assignedNodeId: 'mac_aux', duplicate: false });
    expect(duplicate).toMatchObject({ status: 'queued', assignedNodeId: 'mac_aux', duplicate: true });
    expect(service.status(first.task.id)).toMatchObject({
      state: 'queued', deliveryMode: 'primary_synthesized',
    });
  });

  it('returns explicit wait/retry/manual options while an identity node is offline', () => {
    const h = fixture('offline');
    const service = new DepartmentHandoffService({
      organizationRoot: h.organizationRoot,
      departmentId: 'media_content',
    });

    expect(service.submit({
      protocolId: 'authenticated_research',
      goal: '读取登录后内容',
      context: { request: '检查账号' },
      idempotencyKey: 'oc_media:om_2:authenticated_research',
      deadline: null,
    })).toMatchObject({
      status: 'waiting',
      reason: 'identity_bound_node_unavailable',
      options: ['wait', 'retry', 'manual'],
    });
  });
});
