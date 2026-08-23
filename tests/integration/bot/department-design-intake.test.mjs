import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DepartmentCommandRuntime } from '../../../department-runtime/department-command-runtime.mjs';
import { DepartmentDesignStore } from '../../../department-runtime/department-design-store.mjs';

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'department-intake-'));
  const storeFile = path.join(directory, 'design-sessions.json');
  const designStore = new DepartmentDesignStore(storeFile);
  const replies = [];
  const runtime = new DepartmentCommandRuntime({
    designStore,
    isDepartmentAdmin: (context) => context.senderId === 'ou_owner',
    provisioner: { provision: () => { throw new Error('not expected'); } },
    inventoryContext: () => ({ workspace: directory, sources: [] }),
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
    currentWorkspace: directory,
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

  it('loads only the bundled department runtime', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) =>
      readFile(path.join(process.cwd(), 'src', 'department', 'department-extension.ts'), 'utf8'));
    expect(source).not.toContain('OPC_DEPARTMENT_RUNTIME_ENTRY');
    expect(source).not.toContain('OPC_DEPARTMENT_CONTROLLER_CONFIG');
    expect(source).toContain('department-runtime/bootstrap.mjs');
  });
});
