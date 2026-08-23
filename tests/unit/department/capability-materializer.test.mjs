import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DepartmentCapabilityMaterializer } from '../../../department-runtime/department-capability-materializer.mjs';

function githubSkill(overrides = {}) {
  return {
    id: 'presentation-skill',
    kind: 'skill',
    required: true,
    scope: 'host',
    installPolicy: 'auto',
    source: {
      type: 'github_skill',
      repo: 'example/presentation-skill',
      path: 'skills/presentation-skill',
      ref: 'v1.2.3',
    },
    verification: { type: 'skill_manifest' },
    ...overrides,
  };
}

function setup(overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'department-capabilities-'));
  const hostSkillsRoot = path.join(root, 'host-skills');
  const workspace = path.join(root, 'workspace');
  mkdirSync(hostSkillsRoot);
  mkdirSync(workspace);
  const installCalls = [];
  const materializer = new DepartmentCapabilityMaterializer({
    hostSkillsRoot,
    builtinCapabilities: ['imagegen'],
    installGitHubSkill: ({ capability, destinationRoot }) => {
      installCalls.push({ capability, destinationRoot });
      const target = path.join(destinationRoot, capability.id);
      mkdirSync(target, { recursive: true });
      writeFileSync(path.join(target, 'SKILL.md'), `---\nname: ${capability.id}\n---\n`);
    },
    ...overrides,
  });
  return { root, hostSkillsRoot, workspace, installCalls, materializer };
}

describe('department capability materialization', () => {
  it('verifies registered builtins without installation', () => {
    const fixture = setup();
    const result = fixture.materializer.materialize({
      departmentId: 'content_design',
      workspace: fixture.workspace,
      capabilities: [{
        id: 'imagegen', kind: 'builtin', required: true, scope: 'host', installPolicy: 'auto',
        source: { type: 'builtin', name: 'imagegen' },
        verification: { type: 'builtin_registry' },
      }],
    });

    expect(result.status).toBe('ready');
    expect(result.capabilities[0].status).toBe('available');
    expect(fixture.installCalls).toHaveLength(0);
  });

  it('installs a pinned GitHub skill once and verifies idempotent reuse', () => {
    const fixture = setup();
    const input = { departmentId: 'content_design', workspace: fixture.workspace, capabilities: [githubSkill()] };

    const first = fixture.materializer.materialize(input);
    const second = fixture.materializer.materialize(input);

    const target = path.join(fixture.hostSkillsRoot, 'presentation-skill');
    expect(first.capabilities[0]).toMatchObject({ status: 'installed', target });
    expect(second.capabilities[0]).toMatchObject({ status: 'available', target });
    expect(fixture.installCalls).toHaveLength(1);
    expect(readFileSync(path.join(target, '.department-capability-source.json'), 'utf8')).toContain('v1.2.3');
  });

  it('does not overwrite an unmanaged same-name target', () => {
    const fixture = setup();
    const target = path.join(fixture.hostSkillsRoot, 'presentation-skill');
    mkdirSync(target);
    writeFileSync(path.join(target, 'SKILL.md'), '---\nname: presentation-skill\n---\n');

    const result = fixture.materializer.materialize({
      departmentId: 'content_design', workspace: fixture.workspace, capabilities: [githubSkill()],
    });

    expect(result.status).toBe('created_with_pending_capabilities');
    expect(result.capabilities[0]).toMatchObject({ status: 'conflict' });
    expect(fixture.installCalls).toHaveLength(0);
  });

  it('copies or binds a fingerprinted local skill only from an allowed root', () => {
    const fixture = setup();
    const trustedRoot = path.join(fixture.root, 'trusted');
    const source = path.join(trustedRoot, 'local-style');
    mkdirSync(source, { recursive: true });
    const manifest = '---\nname: local-style\n---\n';
    writeFileSync(path.join(source, 'SKILL.md'), manifest);
    const capability = {
      id: 'local-style', kind: 'skill', required: true, scope: 'workspace', installPolicy: 'auto',
      source: {
        type: 'local_skill', path: source,
        sha256: createHash('sha256').update(manifest).digest('hex'),
      },
      verification: { type: 'skill_manifest' },
    };
    const materializer = setup({ allowedLocalSkillRoots: [trustedRoot] }).materializer;

    const copied = materializer.materialize({
      departmentId: 'content_design', workspace: fixture.workspace, capabilities: [capability],
    });
    const bound = materializer.materialize({
      departmentId: 'content_design', workspace: fixture.workspace,
      capabilities: [{ ...capability, id: 'local-style', bindingMode: 'bind_existing' }],
    });

    expect(copied.capabilities[0].status).toBe('installed');
    expect(existsSync(path.join(fixture.workspace, '.agents', 'skills', 'local-style', 'SKILL.md'))).toBe(true);
    expect(bound.capabilities[0]).toMatchObject({ status: 'available', target: source });
  });

  it('reports authorization and unsupported adapters truthfully', () => {
    const fixture = setup();
    const result = fixture.materializer.materialize({
      departmentId: 'content_design',
      workspace: fixture.workspace,
      capabilities: [
        githubSkill({ id: 'private-style', installPolicy: 'approval_required' }),
        {
          id: 'pptx-mcp', kind: 'mcp', required: false, scope: 'host', installPolicy: 'auto',
          source: { type: 'mcp_server', package: 'pptx-mcp', version: '1.0.0', transport: 'stdio' },
          verification: { type: 'mcp_registration' },
        },
      ],
    });

    expect(result.status).toBe('created_with_pending_capabilities');
    expect(result.capabilities.map((item) => item.status)).toEqual(['pending_authorization', 'pending_manual']);
  });

  it('redacts adapter failures and never reports a required failed capability as ready', () => {
    const fixture = setup({
      installGitHubSkill: () => { throw new Error('token=super-secret-value'); },
    });
    const result = fixture.materializer.materialize({
      departmentId: 'content_design', workspace: fixture.workspace, capabilities: [githubSkill()],
    });

    expect(result.status).toBe('created_with_pending_capabilities');
    expect(result.capabilities[0].status).toBe('failed');
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
  });
});
