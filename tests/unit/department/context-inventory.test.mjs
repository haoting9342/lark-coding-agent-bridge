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
});
