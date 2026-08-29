import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DepartmentCommandRuntime } from '../../../department-runtime/department-command-runtime.mjs';
import { DepartmentProvisioner } from '../../../department-runtime/department-provisioner.mjs';

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'department-join-'));
  const organizationRoot = path.join(root, 'organizations', 'default');
  const profileRoot = path.join(root, 'profiles', 'codex');
  const workspace = path.join(root, 'writer-workspace');
  const departmentRoot = path.join(organizationRoot, 'departments', 'writers');
  for (const directory of ['company', 'departments', 'router', 'transactions']) {
    mkdirSync(path.join(organizationRoot, directory), { recursive: true });
  }
  mkdirSync(workspace, { recursive: true });
  mkdirSync(departmentRoot, { recursive: true });
  mkdirSync(profileRoot, { recursive: true });
  writeFileSync(path.join(organizationRoot, 'company', 'department-registry.json'), JSON.stringify({
    schemaVersion: 1,
    departments: [{
      id: 'writers',
      name: '作家部',
      status: 'active',
      workspace,
      profile: 'codex',
      chatId: 'oc_original',
    }],
  }));
  writeFileSync(path.join(organizationRoot, 'router', 'group-router.json'), JSON.stringify({
    schemaVersion: 1,
    routes: [{
      chatId: 'oc_original',
      departmentId: 'writers',
      workspace,
      profile: 'codex',
    }],
  }));
  writeFileSync(path.join(departmentRoot, 'memory.md'), [
    '# 已确认的部门记忆',
    '',
    '- 固定语气：克制、温暖。',
    '- 每一段回复后追加“本段落产自作家部”。',
    '',
  ].join('\n'));
  writeFileSync(path.join(workspace, 'AGENTS.md'), [
    '# 作家部工作规则',
    `- 权威部门记忆文件：\`${path.join(departmentRoot, 'memory.md')}\`。`,
    '- 新会话开始前读取部门记忆和按需命中的规程。',
    '',
  ].join('\n'));
  const routes = new Map([['oc_original', workspace]]);
  const provisioner = new DepartmentProvisioner({
    organizationRoot,
    profileRoot,
    routeController: {
      current: (chatId) => routes.get(chatId),
      apply: ({ chatId, cwd }) => routes.set(chatId, cwd),
      restore: (chatId, cwd) => cwd == null ? routes.delete(chatId) : routes.set(chatId, cwd),
    },
  });
  return {
    root,
    organizationRoot,
    routerFile: path.join(organizationRoot, 'router', 'group-router.json'),
    workspace,
    departmentRoot,
    routes,
    provisioner,
  };
}

function context(overrides = {}) {
  const replies = [];
  return {
    context: {
      chatType: 'group',
      chatId: 'oc_new_group',
      profile: 'codex',
      senderId: 'ou_owner',
      isDepartmentAdmin: true,
      reply: (text) => replies.push(String(text)),
      ...overrides,
    },
    replies,
  };
}

function runtime(fixtureValue) {
  return new DepartmentCommandRuntime({
    designStore: { getFor: () => null },
    isDepartmentAdmin: (value) => value.isDepartmentAdmin === true,
    provisioner: fixtureValue.provisioner,
  });
}

describe('加入已有部门', () => {
  it('binds a new group to the existing department and workspace without confirmation', () => {
    const value = fixture();
    const { context: input, replies } = context();

    runtime(value).handleDepartmentCommand('join writers', input);

    expect(value.routes.get('oc_new_group')).toBe(value.workspace);
    expect(readJson(value.routerFile).routes).toContainEqual({
      chatId: 'oc_new_group',
      departmentId: 'writers',
      workspace: value.workspace,
      profile: 'codex',
    });
    expect(replies.join('\n')).toContain('作家部');
    expect(replies.join('\n')).toContain(value.workspace);
  });

  it('is idempotent when the group already points to the same department', () => {
    const value = fixture();
    const { context: input, replies } = context({ chatId: 'oc_original' });

    runtime(value).handleDepartmentCommand('join writers', input);

    expect(readJson(value.routerFile).routes).toHaveLength(1);
    expect(replies.join('\n')).toMatch(/已经加入|已绑定/);
  });

  it('lets a new group session inherit the shared workflow entry and confirmed memory', () => {
    const value = fixture();
    const { context: input } = context();

    runtime(value).handleDepartmentCommand('join writers', input);

    const workspaceRules = readFileSync(path.join(value.workspace, 'AGENTS.md'), 'utf8');
    const memory = readFileSync(path.join(value.departmentRoot, 'memory.md'), 'utf8');
    const freshSessionContext = `${workspaceRules}\n${memory}`;
    expect(freshSessionContext).toContain('权威部门记忆文件');
    expect(freshSessionContext).toContain('克制、温暖');
    expect(freshSessionContext).toContain('本段落产自作家部');
  });

  it('rejects an unknown department and leaves routes unchanged', () => {
    const value = fixture();
    const { context: input, replies } = context();

    runtime(value).handleDepartmentCommand('join missing', input);

    expect(readJson(value.routerFile).routes).toHaveLength(1);
    expect(value.routes.has('oc_new_group')).toBe(false);
    expect(replies.join('\n')).toContain('不存在');
  });

  it('rejects a group already routed to another department', () => {
    const value = fixture();
    const otherWorkspace = path.join(value.root, 'other-workspace');
    mkdirSync(otherWorkspace);
    writeFileSync(value.routerFile, JSON.stringify({
      schemaVersion: 1,
      routes: [{ chatId: 'oc_new_group', departmentId: 'other', workspace: otherWorkspace, profile: 'codex' }],
    }));
    const { context: input, replies } = context();

    runtime(value).handleDepartmentCommand('join writers', input);

    expect(readJson(value.routerFile).routes).toHaveLength(1);
    expect(value.routes.has('oc_new_group')).toBe(false);
    expect(replies.join('\n')).toContain('已经绑定其他部门');
  });

  it('only permits joining from a group chat', () => {
    const value = fixture();
    const { context: input, replies } = context({ chatType: 'p2p' });

    runtime(value).handleDepartmentCommand('join writers', input);

    expect(existsSync(value.routerFile)).toBe(true);
    expect(readJson(value.routerFile).routes).toHaveLength(1);
    expect(replies.join('\n')).toContain('群聊');
  });
});
