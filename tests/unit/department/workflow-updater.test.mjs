import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDepartmentOverlay } from '../../../department-runtime/department-overlay.mjs';
import { DepartmentWorkflowUpdater } from '../../../department-runtime/department-workflow-updater.mjs';

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function protocol(overrides = {}) {
  return {
    id: 'slide_deck_production',
    name: '传统 PPT 制作',
    intents: ['制作 PPT'],
    purpose: '交付可编辑 PPTX',
    requiredInputs: ['课程大纲'],
    clarificationPolicy: '交付格式不清楚时先澄清',
    steps: ['设计结构', '生成 PPTX', '渲染检查'],
    qualityChecks: [{
      id: 'pptx_opens', description: 'PPTX 可以打开', method: 'deterministic', trigger: 'always',
    }],
    deliverables: ['可编辑 PPTX'],
    completionCriteria: ['PPTX 通过布局检查'],
    skills: ['presentations'],
    revisionPolicy: '只修改受影响页面并重新检查',
    ...overrides,
  };
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'department-workflow-update-'));
  const organizationRoot = path.join(root, 'organizations', 'default');
  const departmentId = 'public_course';
  const departmentRoot = path.join(organizationRoot, 'departments', departmentId);
  const workspace = path.join(root, 'workspace');
  for (const directory of [departmentRoot, workspace, path.join(organizationRoot, 'backups'), path.join(organizationRoot, 'transactions')]) {
    mkdirSync(directory, { recursive: true });
  }
  const department = {
    schemaVersion: 1,
    id: departmentId,
    name: '公开课',
    kind: 'project',
    status: 'active',
    purpose: '完成公开课材料',
    responsibilities: ['课程设计', '演示稿制作'],
    outOfScope: ['未经确认的公开发布'],
    approvalBoundaries: ['公开发布'],
    workspace,
  };
  const workflow = {
    schemaVersion: 1,
    revision: 1,
    semantics: 'task_execution',
    defaultFlow: ['理解任务', '执行', '验证', '交付'],
    orchestrationPolicy: {
      mode: 'adaptive', roleSemantics: 'responsibility_not_process',
      delegationTriggers: [], maxConcurrentSubagents: 2,
      maxExecutionAgentsPerWorkItem: 1, maxIndependentReviewsPerMilestone: 1,
      maxReviewRounds: 1, defaultForkTurns: 'none', recentTurnLimit: 3,
      allowFullHistoryFork: false, deterministicChecksFirst: true,
      largeArtifactTransfer: 'path_and_summary',
      modelRouting: {
        lookup: 'lightweight', execution: 'standard',
        complexDecision: 'critical', independentReview: 'critical',
      },
    },
    businessLifecycle: ['设计', '交付'],
    taskProtocols: [protocol()],
    recurringWorkflows: [], milestones: [], doneWhen: [], capabilityPlan: [],
  };
  const workflowPath = path.join(departmentRoot, 'workflow.json');
  writeFileSync(path.join(departmentRoot, 'department.json'), `${JSON.stringify(department, null, 2)}\n`);
  writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`);
  writeFileSync(path.join(departmentRoot, 'topology.json'), JSON.stringify({
    schemaVersion: 1,
    primaryNodeId: 'local_primary',
    nodes: [{ id: 'local_primary', role: 'primary' }],
  }, null, 2));
  writeFileSync(path.join(departmentRoot, 'AGENTS.md'), '# Package rules\n');
  const draft = {
    ...department,
    kind: department.kind,
    purpose: department.purpose,
    responsibilities: department.responsibilities,
    outOfScope: department.outOfScope,
    approvalBoundaries: department.approvalBoundaries,
    orchestrationPolicy: workflow.orchestrationPolicy,
    taskProtocols: workflow.taskProtocols,
  };
  const overlay = renderDepartmentOverlay({
    departmentId,
    departmentName: department.name,
    draft,
    workflowPath,
  });
  writeFileSync(
    path.join(workspace, 'AGENTS.md'),
    `# Existing workspace rules\n\n${overlay}\n`,
  );
  return { organizationRoot, departmentId, departmentRoot, workspace, workflowPath };
}

function webProtocol() {
  return protocol({
    name: '网页演示制作',
    purpose: '交付可现场播放的网页演示',
    steps: ['确认小批次页面规格', '实现语义 DOM 与逐步揭示', '浏览器验收'],
    qualityChecks: [{
      id: 'browser_bounds', description: '多尺寸无溢出', method: 'deterministic', trigger: 'always',
    }],
    deliverables: ['网页源文件', '公开预览', '验收截图'],
    completionCriteria: ['观众页与演讲者页通过浏览器验收'],
  });
}

function request(environment, overrides = {}) {
  return {
    schemaVersion: 1,
    expectedSha256: digest(environment.workflowPath),
    actorId: 'ou_owner',
    reason: '将长期演示流程升级为网页演示',
    confirmationText: '确认修改部门流程',
    operations: [{
      op: 'replace_task_protocol',
      protocolId: 'slide_deck_production',
      value: webProtocol(),
    }],
    ...overrides,
  };
}

describe('department workflow updater', () => {
  it('shows the authoritative workflow path, revision, and hash', () => {
    const environment = fixture();
    const updater = new DepartmentWorkflowUpdater({ organizationRoot: environment.organizationRoot });

    expect(updater.show(environment.departmentId)).toMatchObject({
      departmentId: environment.departmentId,
      workflowPath: environment.workflowPath,
      revision: 1,
      sha256: digest(environment.workflowPath),
      applyRequestTemplate: {
        schemaVersion: 1,
        expectedSha256: digest(environment.workflowPath),
        operations: [{
          op: 'replace_task_protocol',
          protocolId: '<task-protocol-id>',
          value: '<complete-task-protocol-object>',
        }],
      },
    });
  });

  it('replaces one protocol transactionally and regenerates readable rules', () => {
    const environment = fixture();
    const updater = new DepartmentWorkflowUpdater({
      organizationRoot: environment.organizationRoot,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    });

    const result = updater.apply(environment.departmentId, request(environment));

    const workflow = JSON.parse(readFileSync(environment.workflowPath, 'utf8'));
    expect(workflow.revision).toBe(2);
    expect(workflow.taskProtocols[0]).toMatchObject({
      id: 'slide_deck_production', name: '网页演示制作',
    });
    expect(result).toMatchObject({
      status: 'completed', departmentId: environment.departmentId,
      oldRevision: 1, newRevision: 2,
      changedProtocolIds: ['slide_deck_production'],
    });
    expect(existsSync(result.backupRoot)).toBe(true);
    expect(existsSync(result.receiptPath)).toBe(true);
    const workspaceAgents = readFileSync(path.join(environment.workspace, 'AGENTS.md'), 'utf8');
    expect(workspaceAgents).toContain('# Existing workspace rules');
    expect(workspaceAgents).toContain('网页演示制作');
    expect(workspaceAgents).not.toContain('传统 PPT 制作');
    expect(workspaceAgents).toContain(`权威工作流文件：\`${environment.workflowPath}\``);
    expect(readFileSync(path.join(environment.departmentRoot, 'AGENTS.md'), 'utf8'))
      .toContain('网页演示制作');
  });

  it.each([
    ['generic confirmation', { confirmationText: '同意' }, /workflow-specific|确认修改部门流程/i],
    ['stale hash', { expectedSha256: '0'.repeat(64) }, /stale|sha-256/i],
  ])('rejects %s without changing files', (_name, override, expected) => {
    const environment = fixture();
    const before = digest(environment.workflowPath);
    const updater = new DepartmentWorkflowUpdater({ organizationRoot: environment.organizationRoot });

    expect(() => updater.apply(environment.departmentId, request(environment, override))).toThrow(expected);
    expect(digest(environment.workflowPath)).toBe(before);
  });

  it('rejects an invalid replacement protocol', () => {
    const environment = fixture();
    const updater = new DepartmentWorkflowUpdater({ organizationRoot: environment.organizationRoot });
    const invalid = request(environment);
    invalid.operations[0].value = { id: 'slide_deck_production', name: '不完整' };

    expect(() => updater.apply(environment.departmentId, invalid)).toThrow(/protocol|validation/i);
  });

  it('rolls workflow and AGENTS files back after a post-write failure', () => {
    const environment = fixture();
    const files = [
      environment.workflowPath,
      path.join(environment.departmentRoot, 'AGENTS.md'),
      path.join(environment.workspace, 'AGENTS.md'),
    ];
    const before = new Map(files.map((file) => [file, digest(file)]));
    const updater = new DepartmentWorkflowUpdater({
      organizationRoot: environment.organizationRoot,
      failAfter: 'workflow',
    });

    expect(() => updater.apply(environment.departmentId, request(environment)))
      .toThrow(/injected failure/);
    for (const [file, sha256] of before) expect(digest(file), file).toBe(sha256);
  });
});
