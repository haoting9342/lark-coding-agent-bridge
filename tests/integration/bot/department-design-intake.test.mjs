import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DepartmentCommandRuntime } from '../../../department-runtime/department-command-runtime.mjs';
import { DepartmentDesignStore } from '../../../department-runtime/department-design-store.mjs';

function setup(overrides = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'department-intake-'));
  const storeFile = path.join(directory, 'design-sessions.json');
  const designStore = new DepartmentDesignStore(storeFile);
  const replies = [];
  const runtime = new DepartmentCommandRuntime({
    designStore,
    isDepartmentAdmin: (context) => context.senderId === 'ou_owner',
    provisioner: { provision: () => { throw new Error('not expected'); } },
    inventoryContext: overrides.inventoryContext ?? (() => ({ workspace: directory, sources: [] })),
    draftCli: path.join(directory, 'department-draft-cli.mjs'),
    storeFile,
  });
  const context = {
    profile: 'codex',
    host: 'local',
    botName: 'Department Bridge',
    chatType: 'group',
    chatId: 'oc_new_group',
    scope: 'oc_new_group',
    senderId: 'ou_owner',
    groupName: '新部门',
    currentWorkspace: overrides.currentWorkspace === undefined
      ? directory
      : overrides.currentWorkspace,
    text: '',
    messageId: 'om_1',
    reply: (text) => replies.push(text),
  };
  return { runtime, designStore, context, replies };
}

describe('exclusive conversational department design', () => {
  it('accepts a name in the create command and routes direct discussion to one design', () => {
    const { runtime, designStore, context } = setup();

    runtime.handleDepartmentCommand('create 公开课', context);
    const started = designStore.getFor(context);
    expect(started.draft.departmentName).toBe('公开课');

    context.text = '如果我要做 PPT，应该怎么工作？';
    context.scope = 'oc_new_group:unthreaded-direct-message';
    const result = runtime.intakeDepartmentMessage(context);

    expect(result.action).toBe('design');
    expect(result.prompt).toContain('如果我要做 PPT，应该怎么工作？');
    expect(result.prompt).toMatch(/业务生命周期/);
    expect(result.prompt).toMatch(/任务规程/);
    expect(designStore.getFor(context).key).toBe(started.key);
  });

  it('records participant proposals but only lets an admin control pause and resume', () => {
    const { runtime, designStore, context } = setup();
    runtime.handleDepartmentCommand('create 内容部', context);

    context.senderId = 'ou_member';
    context.text = '建议增加灵感记录和发布状态管理';
    expect(runtime.intakeDepartmentMessage(context).action).toBe('handled');
    expect(designStore.getFor(context).pendingParticipantMessages[0].text).toContain('灵感记录');

    context.senderId = 'ou_owner';
    context.text = '暂停创建部门';
    expect(runtime.intakeDepartmentMessage(context).action).toBe('handled');
    expect(designStore.getFor(context).status).toBe('paused');

    context.text = '继续创建部门';
    expect(runtime.intakeDepartmentMessage(context).action).toBe('handled');
    expect(designStore.getFor(context).status).toBe('active');
  });

  it('requires an explicit group workspace before starting design', () => {
    let inventoryCalls = 0;
    const { runtime, designStore, context, replies } = setup({
      currentWorkspace: null,
      inventoryContext: () => {
        inventoryCalls += 1;
        throw new Error('must not scan a profile default');
      },
    });

    runtime.handleDepartmentCommand('create 测试部', context);

    expect(inventoryCalls).toBe(0);
    expect(designStore.getFor(context)).toBeNull();
    expect(replies.at(-1)).toMatch(/workspace|工作区/i);
    expect(replies.at(-1)).toContain('/cd');
  });

  it('replies when inventory fails and does not leave a design session', () => {
    const { runtime, designStore, context, replies } = setup({
      inventoryContext: () => {
        throw new Error('inventory exploded');
      },
    });

    runtime.handleDepartmentCommand('create 测试部', context);

    expect(designStore.getFor(context)).toBeNull();
    expect(replies.at(-1)).toMatch(/未启动|读取失败/);
    expect(replies.at(-1)).toMatch(/重试|\/department create/);
  });

  it('passes agreement replies through after department creation is completed', () => {
    const { runtime, designStore, context, replies } = setup();
    const started = designStore.start(context);
    designStore.update(started.key, {
      phase: 'awaiting_final_confirmation',
    }, {
      actorId: context.senderId,
      source: 'controller',
      changedPaths: ['/phase'],
    });
    designStore.beginProvisioning(started.key, {
      actorId: context.senderId,
      confirmationText: '同意',
    });
    designStore.completeProvisioning(started.key, {
      transactionId: 'txn_completed_department',
    });

    for (const text of ['同意', '确认', '同意创建', '确认创建', '按这个方案创建']) {
      context.text = text;
      expect(runtime.intakeDepartmentMessage(context)).toEqual({ action: 'pass' });
    }
    expect(replies).toEqual([]);
  });

  it('loads only the bundled department runtime', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) =>
      readFile(path.join(process.cwd(), 'src', 'department', 'department-extension.ts'), 'utf8'));
    expect(source).not.toContain('OPC_DEPARTMENT_RUNTIME_ENTRY');
    expect(source).not.toContain('OPC_DEPARTMENT_CONTROLLER_CONFIG');
    expect(source).toContain('department-runtime/bootstrap.mjs');
    expect(source).toContain('resolveMappedDepartmentWorkspace');
    expect(source).not.toContain('profileConfig.workspaces.default');
  });
});
