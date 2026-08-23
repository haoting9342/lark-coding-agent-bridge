import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

describe('clean npm install contract', () => {
  it('packs, installs, and initializes only the isolated department product', () => {
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
      'assets/organization-template/organization.json',
      'docs/department-creation.md',
      'docs/organization-nodes.md',
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
    expect(version).toBe('0.7.0');
    const status = execFileSync(process.execPath, [cli, 'organization', 'status'], {
      cwd: temporaryHome,
      env,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(status).toContain('status: ready');
    expect(existsSync(path.join(stateRoot, 'organizations', 'default', 'organization.json'))).toBe(true);
    expect(existsSync(path.join(temporaryHome, '.lark-channel'))).toBe(false);

    const forbidden = /OPC_DEPARTMENT_RUNTIME_ENTRY|OPC_DEPARTMENT_CONTROLLER_CONFIG|opc-company|\/Users\/crystal|\/home\/hao/i;
    const legacyExecutable = /\blark-channel-bridge(?!-department)\s+(?:run|start|stop|restart|status|ui|ps|kill|secrets)\b/i;
    for (const file of walk(packageRoot)) {
      if (statSync(file).size > 5 * 1024 * 1024) continue;
      const content = readFileSync(file, 'utf8');
      expect(content, path.relative(packageRoot, file)).not.toMatch(forbidden);
      expect(content, path.relative(packageRoot, file)).not.toMatch(legacyExecutable);
    }
  }, 240_000);
});
