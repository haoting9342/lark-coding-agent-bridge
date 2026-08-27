import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DepartmentProvisioner } from '../../../department-runtime/department-provisioner.mjs';
import { DepartmentCapabilityMaterializer } from '../../../department-runtime/department-capability-materializer.mjs';

function json(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function checksum(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'department-provisioner-')));
  const organizationRoot = path.join(root, 'organizations', 'default');
  const workspace = path.join(root, 'workspace');
  const profileRoot = path.join(root, 'profiles', 'default');
  for (const directory of [
    'company', 'departments', 'router', 'onboarding', 'transactions',
    'nodes', 'capabilities', 'backups',
  ]) {
    mkdirSync(path.join(organizationRoot, directory), { recursive: true });
  }
  mkdirSync(workspace, { recursive: true });
  mkdirSync(profileRoot, { recursive: true });
  writeFileSync(path.join(organizationRoot, 'company', 'department-registry.json'), JSON.stringify({
    schemaVersion: 1,
    departments: [],
  }, null, 2));
  writeFileSync(path.join(organizationRoot, 'router', 'group-router.json'), JSON.stringify({
    schemaVersion: 1,
    routes: [],
  }, null, 2));
  writeFileSync(path.join(workspace, 'AGENTS.md'), '# Existing rules\n\nNever publish without approval.\n');
  return { root, organizationRoot, workspace, profileRoot };
}

function draft(workspace) {
  return {
    departmentName: '内容设计部',
    kind: 'permanent',
    purpose: '持续产出可直接使用的专业内容',
    workspace,
    responsibilities: ['内容研究', '内容交付'],
    outOfScope: ['未经确认的对外发布'],
    workflow: ['理解任务', '匹配任务规程', '执行', '检查', '交付'],
    businessLifecycle: ['需求洞察', '内容运营'],
    taskProtocols: [{
      id: 'create_outline',
      name: '课程大纲',
      intents: ['写课程大纲'],
      purpose: '输出可直接使用的大纲',
      requiredInputs: ['课程目标'],
      clarificationPolicy: '目标或受众不清楚时先澄清',
      steps: ['整合知识', '设计结构', '去除 AI 味', '复核'],
      qualityChecks: ['结构合理', '表达自然'],
      deliverables: ['课程大纲'],
      completionCriteria: ['可以直接使用'],
      skills: [],
      revisionPolicy: '按反馈修改后重新检查',
    }],
    capabilityPlan: [],
    approvalBoundaries: ['对外发布'],
    confirmedFacts: ['保留原有工作区规则'],
    historicalRules: ['对外发布前明确确认'],
    contextSources: [],
    openQuestions: [],
    mission: '持续提供高质量内容服务',
    serviceCatalog: ['课程大纲'],
    recurringWorkflows: [],
    defaultProjects: [],
    taskTypes: ['大纲制作'],
  };
}

function request(environment) {
  const value = draft(environment.workspace);
  return {
    departmentId: 'content_design',
    departmentName: value.departmentName,
    groupName: '内容设计',
    chatId: 'oc_content_design',
    senderId: 'ou_owner',
    host: 'test-host',
    profile: 'default',
    workspace: environment.workspace,
    description: value.purpose,
    responsibilities: value.responsibilities,
    approvalBoundaries: value.approvalBoundaries,
    draft: value,
    contextInventory: { workspace: environment.workspace, sources: [] },
  };
}

function provisioner(environment, options = {}) {
  const routes = options.routes ?? new Map();
  return {
    routes,
    instance: new DepartmentProvisioner({
      organizationRoot: environment.organizationRoot,
      profileRoot: environment.profileRoot,
      routeController: {
        current: (chatId) => routes.get(chatId),
        apply: ({ chatId, cwd }) => routes.set(chatId, cwd),
        restore: (chatId, cwd) => cwd == null ? routes.delete(chatId) : routes.set(chatId, cwd),
      },
      now: () => new Date('2026-08-23T12:00:00.000Z'),
      ...options,
    }),
  };
}

describe('node-native department provisioner', () => {
  it('atomically writes a complete department package and preserves existing AGENTS.md content', () => {
    const environment = fixture();
    const { instance, routes } = provisioner(environment);

    const result = instance.provision(request(environment));

    expect(result.status).toBe('completed');
    expect(result.readiness).toBe('ready');
    expect(routes.get('oc_content_design')).toBe(environment.workspace);
    const departmentRoot = path.join(environment.organizationRoot, 'departments', 'content_design');
    for (const file of [
      'department.json', 'workflow.json', 'topology.json', 'existing-assets.json',
      'AGENTS.md', 'memory.md', 'skills-plan.md',
    ]) {
      expect(existsSync(path.join(departmentRoot, file)), file).toBe(true);
    }
    expect(json(path.join(departmentRoot, 'workflow.json'))).toMatchObject({
      semantics: 'task_execution',
      orchestrationPolicy: {
        mode: 'adaptive',
        roleSemantics: 'responsibility_not_process',
        defaultForkTurns: 'none',
        allowFullHistoryFork: false,
      },
      taskProtocols: [{
        id: 'create_outline',
        qualityChecks: [
          { id: 'check_1', method: 'coordinator' },
          { id: 'check_2', method: 'coordinator' },
        ],
      }],
      businessLifecycle: ['需求洞察', '内容运营'],
    });
    const packageAgents = readFileSync(path.join(departmentRoot, 'AGENTS.md'), 'utf8');
    const workspaceAgents = readFileSync(path.join(environment.workspace, 'AGENTS.md'), 'utf8');
    expect(workspaceAgents).toMatch(
      /# Existing rules[\s\S]*lark-channel-bridge-department:start content_design/,
    );
    for (const agents of [packageAgents, workspaceAgents]) {
      expect(agents).toContain('角色是职责定义，不等于常驻或必启 Agent 进程');
      expect(agents).toContain('fork_turns="none"');
      expect(agents).toContain('最多同时运行 2 个子代理');
      expect(agents).toContain('路径与摘要');
      expect(agents).toContain('不得因为存在书面计划');
    }
    const authoritativeWorkflow = path.join(departmentRoot, 'workflow.json');
    expect(workspaceAgents).toContain(`权威工作流文件：\`${authoritativeWorkflow}\``);
    expect(workspaceAgents).toContain(
      'lark-channel-bridge-department organization workflow show content_design',
    );
    expect(workspaceAgents).toContain(
      'lark-channel-bridge-department organization workflow apply content_design',
    );
    expect(workspaceAgents).toContain('只影响当前任务，不修改部门长期流程');
    expect(workspaceAgents).toContain('确认修改部门流程');
    expect(json(path.join(environment.organizationRoot, 'company', 'department-registry.json')).departments)
      .toContainEqual(expect.objectContaining({ id: 'content_design', kind: 'permanent' }));
    expect(json(path.join(environment.organizationRoot, 'router', 'group-router.json')).routes)
      .toContainEqual(expect.objectContaining({ chatId: 'oc_content_design', departmentId: 'content_design' }));
    expect(json(result.receiptPath)).toMatchObject({
      status: 'completed',
      departmentId: 'content_design',
      readiness: 'ready',
    });
  });

  it.each(['promotion', 'overlay', 'registry', 'router', 'workspace_route', 'receipt'])(
    'rolls every mutable target back after a %s failure',
    (failAfter) => {
      const environment = fixture();
      const agents = path.join(environment.workspace, 'AGENTS.md');
      const registry = path.join(environment.organizationRoot, 'company', 'department-registry.json');
      const router = path.join(environment.organizationRoot, 'router', 'group-router.json');
      const before = new Map([agents, registry, router].map((file) => [file, checksum(file)]));
      const routes = new Map([['oc_content_design', '/previous']]);
      const { instance } = provisioner(environment, { failAfter, routes });

      expect(() => instance.provision(request(environment))).toThrow(/injected failure/);

      for (const [file, digest] of before) expect(checksum(file), file).toBe(digest);
      expect(routes.get('oc_content_design')).toBe('/previous');
      expect(existsSync(path.join(environment.organizationRoot, 'departments', 'content_design'))).toBe(false);
    },
  );

  it('rejects duplicate chat routing without changing existing files', () => {
    const environment = fixture();
    const router = path.join(environment.organizationRoot, 'router', 'group-router.json');
    writeFileSync(router, JSON.stringify({
      schemaVersion: 1,
      routes: [{ chatId: 'oc_content_design', departmentId: 'existing', workspace: '/existing', profile: 'default' }],
    }, null, 2));
    const before = checksum(router);

    expect(() => provisioner(environment).instance.provision(request(environment)))
      .toThrow(/chat.*already routed/i);
    expect(checksum(router)).toBe(before);
  });

  it('installs a confirmed local skill and records capability readiness in the receipt', () => {
    const environment = fixture();
    const trustedRoot = path.join(environment.root, 'trusted-skills');
    const source = path.join(trustedRoot, 'outline-style');
    const hostSkillsRoot = path.join(environment.root, 'host-skills');
    mkdirSync(source, { recursive: true });
    mkdirSync(hostSkillsRoot);
    const manifest = '---\nname: outline-style\n---\n';
    writeFileSync(path.join(source, 'SKILL.md'), manifest);
    const input = request(environment);
    input.draft.capabilityPlan = [{
      id: 'outline-style', kind: 'skill', required: true, scope: 'workspace',
      installPolicy: 'auto', nodeId: 'local_primary', bindingMode: 'install', identityBound: false,
      source: {
        type: 'local_skill', path: source,
        sha256: createHash('sha256').update(manifest).digest('hex'),
      },
      verification: { type: 'skill_manifest' },
    }];
    input.draft.taskProtocols[0].skills = ['outline-style'];
    const capabilityMaterializer = new DepartmentCapabilityMaterializer({
      hostSkillsRoot,
      allowedLocalSkillRoots: [trustedRoot],
    });

    const result = provisioner(environment, { capabilityMaterializer }).instance.provision(input);

    expect(result.readiness).toBe('ready');
    expect(result.capabilitySummary.installed).toBe(1);
    expect(existsSync(path.join(environment.workspace, '.agents', 'skills', 'outline-style', 'SKILL.md'))).toBe(true);
    expect(json(result.receiptPath).capabilityMaterialization.capabilities[0].status).toBe('installed');
  });
});
