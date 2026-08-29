import { mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inventoryDepartmentContext } from '../../../department-runtime/department-context-inventory.mjs';

describe('department context inventory resilience', () => {
  it('skips a nested directory that disappears during inventory', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'department-context-disappearing-'));
    const disappearing = path.join(workspace, 'disappearing');
    mkdirSync(disappearing);
    const canonicalDisappearing = realpathSync(disappearing);
    writeFileSync(path.join(workspace, 'keep.md'), 'keep\n');
    writeFileSync(path.join(disappearing, 'gone.md'), 'gone\n');

    const result = inventoryDepartmentContext({
      workspace,
      fileSystem: {
        readdirSync: (current, options) => {
          if (current === canonicalDisappearing) {
            const error = new Error('directory disappeared');
            error.code = 'ENOENT';
            throw error;
          }
          return readdirSync(current, options);
        },
      },
    });

    expect(result.sources.map((source) => source.relativePath)).toEqual(['keep.md']);
  });

  it('does not hide unknown inventory filesystem errors', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'department-context-unknown-error-'));
    expect(() => inventoryDepartmentContext({
      workspace,
      fileSystem: {
        readdirSync: () => {
          const error = new Error('unexpected storage failure');
          error.code = 'EIO';
          throw error;
        },
      },
    })).toThrow(/unexpected storage failure/);
  });

  it('prioritizes files matching the confirmed department theme', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'department-context-targeted-'));
    writeFileSync(path.join(workspace, 'accounting.md'), 'unrelated\n');
    writeFileSync(path.join(workspace, 'script-plan.md'), 'relevant\n');

    const result = inventoryDepartmentContext({
      workspace,
      maxFiles: 1,
      contextQuery: {
        purpose: 'script creation',
        responsibilities: ['script writing'],
      },
    });

    expect(result.requestedWorkspace).toBe(path.resolve(workspace));
    expect(result.contextQuery).toEqual({
      purpose: 'script creation',
      responsibilities: ['script writing'],
    });
    expect(result.sources.map((source) => source.relativePath)).toEqual(['script-plan.md']);
  });

  it('does not read files larger than one MiB by default', () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'department-context-bounded-'));
    writeFileSync(path.join(workspace, 'large-plan.md'), Buffer.alloc(1024 * 1024 + 1, 1));

    const result = inventoryDepartmentContext({ workspace });

    expect(result.sources).toEqual([]);
  });
});
