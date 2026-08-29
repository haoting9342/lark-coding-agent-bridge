import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function readOwner(lockPath) {
  try {
    return JSON.parse(readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

export function acquireDirectoryLock(lockPath, {
  staleAfterMs = 5 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  const token = randomUUID();
  mkdirSync(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      writeFileSync(path.join(lockPath, 'owner.json'), `${JSON.stringify({
        schemaVersion: 1,
        pid: process.pid,
        token,
        createdAt: now(),
      }, null, 2)}\n`, { mode: 0o600 });
      return () => {
        const owner = readOwner(lockPath);
        if (owner?.token === token) rmSync(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== 'EEXIST' || attempt > 0) throw new Error(`directory lock is active: ${lockPath}`);
      const owner = readOwner(lockPath);
      let age = 0;
      try {
        age = now() - statSync(lockPath).mtimeMs;
      } catch {
        age = 0;
      }
      if (age < staleAfterMs || processIsAlive(owner?.pid)) {
        throw new Error(`directory lock is active: ${lockPath}`);
      }
      rmSync(lockPath, { recursive: true, force: true });
    }
  }
  throw new Error(`directory lock is active: ${lockPath}`);
}
