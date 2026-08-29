import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CLI command registration', () => {
  it('does not expose legacy-state migration in the isolated department product', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');

    expect(source).not.toMatch(/\.command\(['"]migrate['"]\)/);
    expect(source).not.toContain('runMigrate');
  });

  it('registers app-secret options for non-interactive app bootstrap commands', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');

    const appSecretOptions = source.match(/--app-secret <secret>/g) ?? [];
    expect(appSecretOptions.length).toBeGreaterThanOrEqual(3);
  });

  it('registers WorkBuddy conversational department initialization and confirmed import', async () => {
    const source = await readFile(join(process.cwd(), 'src', 'cli', 'index.ts'), 'utf8');

    expect(source).toContain(".command('department')");
    expect(source).toContain(".command('init')");
    expect(source).toContain(".command('draft')");
    expect(source).toContain(".command('import')");
    expect(source).toContain('--confirm-create');
    expect(source).toContain('--confirmation-message <text>');
  });
});
