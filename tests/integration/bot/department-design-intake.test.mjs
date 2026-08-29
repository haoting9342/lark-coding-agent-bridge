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

  it('starts without /cd and does not scan before name, workspace, and theme are known', () => {
    let inventoryCalls = 0;
    const { runtime, designStore, context, replies } = setup({
      currentWorkspace: null,
      inventoryContext: () => {
        inventoryCalls += 1;
        throw new Error('must not scan before the theme is known');
      },
    });

    runtime.handleDepartmentCommand('create 测试部', context);

    expect(inventoryCalls).toBe(0);
    expect(designStore.getFor(context).draft.departmentName).toBe('测试部');
    expect(designStore.getFor(context).contextInventory).toBeNull();
    expect(replies.at(-1)).toMatch(/工作路径/);
    expect(replies.at(-1)).not.toContain('/cd');
  });

  it('scans the selected workspace only after purpose and responsibilities are known', () => {
    const inventoryCalls = [];
    const { runtime, designStore, context, replies } = setup({
      currentWorkspace: null,
      inventoryContext: (request) => {
        inventoryCalls.push(request);
        return { workspace: request.currentWorkspace, sources: [] };
      },
    });

    const selectedWorkspace = path.join(tmpdir(), 'department-target');
    runtime.handleDepartmentCommand(`create 内容部 --workspace ${selectedWorkspace}`, context);
    const started = designStore.getFor(context);
    designStore.update(started.key, {
      draft: {
        ...started.draft,
        purpose: '持续制作自媒体内容',
        responsibilities: ['选题研究', '脚本撰写'],
      },
    }, {
      actorId: context.senderId,
      source: 'user_explicit',
      reason: 'theme confirmed',
      changedPaths: ['/draft/purpose', '/draft/responsibilities'],
    });

    context.text = '接着完善部门规则';
    const result = runtime.intakeDepartmentMessage(context);

    expect(result.action).toBe('design');
    expect(inventoryCalls).toHaveLength(1);
    expect(inventoryCalls[0]).toMatchObject({
      currentWorkspace: selectedWorkspace,
      contextQuery: {
        purpose: '持续制作自媒体内容',
        responsibilities: ['选题研究', '脚本撰写'],
      },
    });
    expect(designStore.getFor(context).contextInventory).toMatchObject({ sources: [] });
    expect(replies).toEqual([expect.stringMatching(/工作路径/)]);
  });

  it('rescans when the confirmed department theme changes', () => {
    const inventoryCalls = [];
    const { runtime, designStore, context } = setup({
      inventoryContext: (request) => {
        inventoryCalls.push(request.contextQuery);
        return {
          workspace: request.currentWorkspace,
          requestedWorkspace: request.currentWorkspace,
          contextQuery: structuredClone(request.contextQuery),
          sources: [],
        };
      },
    });
    runtime.handleDepartmentCommand(`create 内容部 --workspace ${context.currentWorkspace}`, context);
    const started = designStore.getFor(context);
    designStore.update(started.key, {
      draft: { ...started.draft, purpose: '制作短视频', responsibilities: ['脚本'] },
    });

    context.text = '继续';
    runtime.intakeDepartmentMessage(context);
    const scanned = designStore.getFor(context);
    designStore.update(scanned.key, {
      draft: { ...scanned.draft, purpose: '制作播客', responsibilities: ['访谈'] },
    });
    runtime.intakeDepartmentMessage(context);

    expect(inventoryCalls).toEqual([
      { purpose: '制作短视频', responsibilities: ['脚本'] },
      { purpose: '制作播客', responsibilities: ['访谈'] },
    ]);
  });

  it('passes a targeted scan failure to the design agent for correction', () => {
    const { runtime, designStore, context } = setup({
      inventoryContext: () => { throw new Error('workspace is unavailable'); },
    });
    runtime.handleDepartmentCommand(`create 内容部 --workspace ${context.currentWorkspace}`, context);
    const started = designStore.getFor(context);
    designStore.update(started.key, {
      draft: { ...started.draft, purpose: '制作内容', responsibilities: ['写作'] },
    });

    context.text = '继续';
    const result = runtime.intakeDepartmentMessage(context);

    expect(result.action).toBe('design');
    expect(result.prompt).toContain('workspace is unavailable');
    expect(result.prompt).toContain('盘点失败');
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
    expect(source).not.toContain('process.cwd()');
    expect(source).toContain('resolveMappedDepartmentWorkspace');
    expect(source).not.toContain('profileConfig.workspaces.default');
  });
});
