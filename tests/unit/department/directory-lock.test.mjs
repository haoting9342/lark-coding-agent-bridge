import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireDirectoryLock } from '../../../department-runtime/directory-lock.mjs';

describe('department directory lock', () => {
  it('recovers an expired lock owned by a process that no longer exists', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'department-stale-lock-'));
    const lock = path.join(root, 'operation.lock');
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: 99999999, createdAt: 1 }));
    const old = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(lock, old, old);

    const release = acquireDirectoryLock(lock, { staleAfterMs: 60_000 });

    expect(existsSync(path.join(lock, 'owner.json'))).toBe(true);
    release();
    expect(existsSync(lock)).toBe(false);
  });

  it('does not replace a lock owned by the current process', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'department-live-lock-'));
    const lock = path.join(root, 'operation.lock');
    const release = acquireDirectoryLock(lock);

    expect(() => acquireDirectoryLock(lock)).toThrow(/active|busy|占用/i);

    release();
  });

  it('does not remove a newly created lock before its owner file is written', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'department-owner-window-'));
    const lock = path.join(root, 'operation.lock');
    mkdirSync(lock);

    expect(() => acquireDirectoryLock(lock, { staleAfterMs: 0 })).toThrow(/active|busy|占用/i);
    expect(existsSync(lock)).toBe(true);
    rmSync(lock, { recursive: true });
  });

  it('immediately recovers a lock whose recorded process no longer exists', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'department-dead-lock-'));
    const lock = path.join(root, 'operation.lock');
    mkdirSync(lock);
    writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: 2147483647, createdAt: Date.now() }));

    const release = acquireDirectoryLock(lock);

    expect(existsSync(path.join(lock, 'owner.json'))).toBe(true);
    release();
  });
});
