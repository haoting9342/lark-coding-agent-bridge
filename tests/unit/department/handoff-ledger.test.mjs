import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DepartmentHandoffLedger,
  HandoffConflictError,
  HandoffValidationError,
} from '../../../department-runtime/department-handoff-ledger.mjs';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'department-handoff-'));
  let counter = 0;
  let now = new Date('2026-08-23T08:00:00.000Z');
  const ledger = new DepartmentHandoffLedger({
    ledgerFile: path.join(root, 'ledger.json'),
    departmentId: 'media_content',
    idFactory: () => `task_${String(++counter).padStart(4, '0')}`,
    now: () => now,
  });
  return { ledger, setNow: (value) => { now = new Date(value); } };
}

function envelope(overrides = {}) {
  return {
    protocolId: 'authenticated_research',
    assignedNodeId: 'mac_aux',
    goal: '读取登录后页面并返回可核验摘要',
    requiredCapabilities: ['authenticated_browser'],
    context: { request: '检查三个参考账号', acceptedFacts: ['只读'] },
    deliverables: ['结构化摘要'],
    evidenceRequirements: ['页面 URL', '采集时间'],
    deadline: null,
    progressPolicy: { maxSilenceSeconds: 300, visibility: 'concise_group_status' },
    idempotencyKey: 'media:msg_123:authenticated_research',
    deliveryMode: 'primary_synthesized',
    risk: 'identity_bound',
    periodic: false,
    directDeliveryApproved: false,
    ...overrides,
  };
}

describe('department handoff ledger', () => {
  it('deduplicates a task and enforces assigned-node versioned transitions', () => {
    const { ledger } = fixture();
    const first = ledger.createTask(envelope());
    expect(ledger.createTask(envelope({ goal: '重复提交' }))).toMatchObject({ duplicate: true });
    const accepted = ledger.transition(first.task.id, {
      expectedVersion: 1, to: 'accepted', actorNodeId: 'mac_aux', summary: '已接单',
    });
    const running = ledger.transition(first.task.id, {
      expectedVersion: accepted.version, to: 'running', actorNodeId: 'mac_aux', summary: '开始执行',
    });
    const completed = ledger.transition(first.task.id, {
      expectedVersion: running.version, to: 'completed', actorNodeId: 'mac_aux',
      summary: '完成', evidence: [{ type: 'url', value: 'https://example.com/evidence' }],
    });

    expect(completed.state).toBe('completed');
    expect(() => ledger.transition(first.task.id, {
      expectedVersion: 3, to: 'failed', actorNodeId: 'mac_aux', summary: 'stale',
    })).toThrow(HandoffConflictError);
  });

  it('rejects secrets, raw sessions, executable instructions, and oversized payloads', () => {
    const { ledger } = fixture();
    for (const unsafe of [
      envelope({ context: { cookie: 'session=value' } }),
      envelope({ context: { rawSession: ['private chat'] } }),
      envelope({ context: { executable: '/bin/sh', args: ['-c', 'whoami'] } }),
      envelope({ goal: 'x'.repeat(300_000) }),
    ]) {
      expect(() => ledger.createTask(unsafe)).toThrow(HandoffValidationError);
    }
  });

  it('reports silent active work without fabricating a retry', () => {
    const { ledger, setNow } = fixture();
    const created = ledger.createTask(envelope()).task;
    ledger.transition(created.id, {
      expectedVersion: 1, to: 'accepted', actorNodeId: 'mac_aux', summary: '已接单',
    });
    setNow('2026-08-23T08:06:00.000Z');

    expect(ledger.findSilentTasks()).toEqual([expect.objectContaining({
      taskId: created.id, silentForSeconds: 360,
    })]);
    expect(ledger.getTask(created.id).version).toBe(2);
  });
});
