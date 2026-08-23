import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DepartmentHandoffLedger } from '../../../department-runtime/department-handoff-ledger.mjs';
import { InProcessHandoffAdapter } from '../../../department-runtime/department-handoff-adapter.mjs';
import {
  DepartmentRunnerRegistry,
  RunnerConfigurationError,
} from '../../../department-runtime/department-runner-registry.mjs';
import { DepartmentHandoffWorker } from '../../../department-runtime/department-handoff-worker.mjs';

function envelope() {
  return {
    protocolId: 'authenticated_research',
    assignedNodeId: 'mac_aux',
    goal: '读取登录后页面并返回证据',
    requiredCapabilities: ['authenticated_browser'],
    context: { request: '检查账号', acceptedFacts: ['只读'] },
    deliverables: ['摘要'],
    evidenceRequirements: ['URL', '时间'],
    deadline: null,
    progressPolicy: { maxSilenceSeconds: 300, visibility: 'concise_group_status' },
    idempotencyKey: 'media:msg_1:research',
    deliveryMode: 'primary_synthesized',
    risk: 'identity_bound',
    periodic: false,
    directDeliveryApproved: false,
  };
}

describe('bounded auxiliary handoff worker', () => {
  it('runs only a fixed allowlisted runner and returns evidence to the primary ledger', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'department-worker-'));
    const runner = path.join(root, 'runner.mjs');
    writeFileSync(runner, [
      'let input = "";',
      'for await (const chunk of process.stdin) input += chunk;',
      'JSON.parse(input);',
      'process.stdout.write(JSON.stringify({summary:"完成", evidence:[{type:"url", value:"https://example.com"}]}));',
    ].join('\n'), { mode: 0o700 });
    const ledger = new DepartmentHandoffLedger({
      ledgerFile: path.join(root, 'ledger.json'), departmentId: 'media_content',
    });
    const created = ledger.createTask(envelope()).task;
    const worker = new DepartmentHandoffWorker({
      departmentId: 'media_content',
      nodeId: 'mac_aux',
      adapter: new InProcessHandoffAdapter({ ledger }),
      registry: new DepartmentRunnerRegistry({
        runners: {
          authenticated_research: {
            executable: process.execPath,
            args: [runner],
            cwd: root,
            timeoutSeconds: 30,
            capabilities: ['authenticated_browser'],
          },
        },
      }),
    });

    expect(worker.runOnce()).toMatchObject({ status: 'completed', taskId: created.id });
    expect(ledger.getTask(created.id)).toMatchObject({
      state: 'completed', evidence: [{ type: 'url', value: 'https://example.com' }],
    });
  });

  it('rejects relative executables, shells, and model-selected commands', () => {
    expect(() => new DepartmentRunnerRegistry({
      runners: { bad: { executable: 'sh', args: ['-c', 'whoami'], timeoutSeconds: 30, capabilities: [] } },
    })).toThrow(RunnerConfigurationError);
    expect(() => new DepartmentRunnerRegistry({
      runners: { bad: { executable: '/bin/sh', args: ['-c', 'whoami'], timeoutSeconds: 30, capabilities: [] } },
    })).toThrow(RunnerConfigurationError);
    expect(() => new DepartmentRunnerRegistry({
      runners: { bad: { executable: process.execPath, args: 'user supplied', timeoutSeconds: 30, capabilities: [] } },
    })).toThrow(RunnerConfigurationError);
  });
});
