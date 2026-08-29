import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

describe('clean npm install contract', () => {
  it('packs, installs, initializes, and provisions a department with the installed runtime', async () => {
    const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const root = mkdtempSync(path.join(tmpdir(), 'department-package-'));
    const packDir = path.join(root, 'pack');
    const installDir = path.join(root, 'install');
    const temporaryHome = path.join(root, 'home');
    const stateRoot = path.join(temporaryHome, '.lark-channel-department');
    for (const directory of [packDir, installDir, temporaryHome]) {
      mkdirSync(directory, { recursive: true });
    }
    execFileSync(corepack, ['pnpm', 'pack', '--pack-destination', packDir], {
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 180_000,
    });
    const tarball = readdirSync(packDir)
      .map((name) => path.join(packDir, name))
      .find((file) => file.endsWith('.tgz'));
    expect(tarball).toBeTruthy();

    execFileSync(npm, ['install', '--prefix', installDir, '--ignore-scripts', tarball], {
      stdio: 'pipe',
      timeout: 180_000,
    });
    const packageRoot = path.join(installDir, 'node_modules', 'lark-channel-bridge-department');
    const cli = path.join(packageRoot, 'bin', 'lark-channel-bridge-department.mjs');
    for (const required of [
      'department-runtime/bootstrap.mjs',
      'department-runtime/department-provisioner.mjs',
      'department-runtime/department-capability-materializer.mjs',
      'department-runtime/workbuddy-workspace-initializer.mjs',
      'department-runtime/workbuddy-provisioner.mjs',
      'assets/organization-template/organization.json',
      'docs/department-creation.md',
      'docs/organization-nodes.md',
      'docs/workbuddy-department-example.json',
    ]) {
      expect(existsSync(path.join(packageRoot, required)), required).toBe(true);
    }

    const env = {
      ...process.env,
      HOME: temporaryHome,
      USERPROFILE: temporaryHome,
      LARK_CHANNEL_DEPARTMENT_HOME: stateRoot,
    };
    const version = execFileSync(process.execPath, [cli, '--version'], {
      cwd: temporaryHome,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    }).trim();
    expect(version).toBe('0.7.4');
    const status = execFileSync(process.execPath, [cli, 'organization', 'status'], {
      cwd: temporaryHome,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(status).toContain('status: ready');
    expect(existsSync(path.join(stateRoot, 'organizations', 'default', 'organization.json'))).toBe(true);
    expect(existsSync(path.join(temporaryHome, '.lark-channel'))).toBe(false);

    const workbuddyWorkspace = path.join(temporaryHome, 'workbuddy-project');
    mkdirSync(workbuddyWorkspace, { recursive: true });
    execFileSync(process.execPath, [
      cli, 'workbuddy', 'department', 'init', '--workspace', workbuddyWorkspace,
    ], { cwd: temporaryHome, env, encoding: 'utf8', timeout: 30_000 });
    execFileSync(process.execPath, [
      cli, 'workbuddy', 'department', 'import',
      '--workspace', workbuddyWorkspace,
      '--spec', path.join(packageRoot, 'docs', 'workbuddy-department-example.json'),
      '--confirm-create',
      '--confirmation-message', '同意创建',
    ], { cwd: temporaryHome, env, encoding: 'utf8', timeout: 30_000 });
    expect(existsSync(path.join(workbuddyWorkspace, 'CODEBUDDY.md'))).toBe(true);
    expect(existsSync(path.join(workbuddyWorkspace, '.codebuddy', 'skills', 'content-department', 'SKILL.md'))).toBe(true);
    expect(existsSync(path.join(workbuddyWorkspace, '.workbuddy-department', 'content', 'manifest.json'))).toBe(true);
    expect(readFileSync(path.join(workbuddyWorkspace, '.workbuddy-department', 'content', 'workflow.json'), 'utf8')).not.toContain('chatId');

    const organizationRoot = path.join(stateRoot, 'organizations', 'default');
    const profileRoot = path.join(stateRoot, 'profiles', 'default');
    const workspace = path.join(temporaryHome, 'content-workspace');
    mkdirSync(profileRoot, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    writeFileSync(path.join(workspace, 'AGENTS.md'), '# 原有工作区规则\n');
    const { DepartmentProvisioner } = await import(pathToFileURL(
      path.join(packageRoot, 'department-runtime', 'department-provisioner.mjs'),
    ).href);
    const draft = {
      departmentName: '内容部', kind: 'permanent', purpose: '持续制作内容', workspace,
      responsibilities: ['选题', '写作'], outOfScope: ['未经确认的发布'],
      workflow: ['理解任务', '执行', '验证', '交付'], businessLifecycle: [], taskProtocols: [],
      capabilityPlan: [], approvalBoundaries: ['对外发布'], confirmedFacts: [], historicalRules: [],
      contextSources: [], openQuestions: [], mission: '持续提供内容服务', serviceCatalog: ['内容制作'],
      recurringWorkflows: [], defaultProjects: [], taskTypes: ['内容任务'],
    };
    const provisioned = new DepartmentProvisioner({ organizationRoot, profileRoot }).provision({
      departmentId: 'content', departmentName: '内容部', groupName: '内容群',
      chatId: 'oc_clean_install', senderId: 'ou_owner', host: 'local', profile: 'default',
      workspace, responsibilities: draft.responsibilities,
      approvalBoundaries: draft.approvalBoundaries, draft,
      contextInventory: { workspace, sources: [] },
    });
    expect(provisioned.status).toBe('completed');
    expect(existsSync(path.join(organizationRoot, 'departments', 'content', 'workflow.json'))).toBe(true);
    expect(readFileSync(path.join(workspace, 'AGENTS.md'), 'utf8')).toContain('自由探索');

    const forbidden = /OPC_DEPARTMENT_RUNTIME_ENTRY|OPC_DEPARTMENT_CONTROLLER_CONFIG|opc-company|\/Users\/crystal|\/home\/hao/i;
    const legacyExecutable = /\blark-channel-bridge(?!-department)\s+(?:run|start|stop|restart|status|ui|ps|kill|secrets)\b/i;
    const legacyWizard = /请发送部门主要职责|当前旧版 0\.5 bridge|waiting_restart/;
    for (const file of walk(packageRoot)) {
      if (statSync(file).size > 5 * 1024 * 1024) continue;
      const content = readFileSync(file, 'utf8');
      expect(content, path.relative(packageRoot, file)).not.toMatch(forbidden);
      expect(content, path.relative(packageRoot, file)).not.toMatch(legacyExecutable);
      expect(content, path.relative(packageRoot, file)).not.toMatch(legacyWizard);
    }
  }, 240_000);
});
