import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  launchAgentLabel,
  systemdUnitName,
  windowsTaskName,
} from '../../src/daemon/paths';

describe('department bridge product identity', () => {
  it('publishes only the department CLI from the department package', async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), 'package.json'), 'utf8'));

    expect(pkg.name).toBe('lark-channel-bridge-department');
    expect(pkg.bin).toEqual({
      'lark-channel-bridge-department': './bin/lark-channel-bridge-department.mjs',
    });
  });

  it('uses service identities that cannot collide with the upstream bridge', () => {
    expect(launchAgentLabel('codex')).toBe(
      'ai.lark-channel-bridge-department.bot.codex',
    );
    expect(systemdUnitName('codex')).toBe(
      'lark-channel-bridge-department.bot.codex.service',
    );
    expect(windowsTaskName('codex')).toBe(
      'LarkChannelBridgeDepartment.Bot.codex',
    );
  });

  it('registers the department product name in the CLI source', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');
    expect(source).toContain(".name('lark-channel-bridge-department')");
  });
});
