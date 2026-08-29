import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';

function lstatMaybe(target) {
  try {
    return lstatSync(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function assertSafeWorkBuddyPath(workspace, target) {
  const root = realpathSync(path.resolve(workspace));
  const resolved = path.resolve(target);
  if (!isWithin(resolved, root)) throw new Error(`WorkBuddy target escapes workspace: ${resolved}`);
  const relative = path.relative(root, resolved);
  let current = root;
  let deepestExisting = root;
  const segments = relative ? relative.split(path.sep) : [];
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const info = lstatMaybe(current);
    if (!info) continue;
    if (info.isSymbolicLink()) throw new Error(`WorkBuddy target contains a symbolic link（符号链接）：${current}`);
    if (index < segments.length - 1 && !info.isDirectory()) {
      throw new Error(`WorkBuddy target parent is not a directory: ${current}`);
    }
    deepestExisting = current;
  }
  if (!isWithin(realpathSync(deepestExisting), root)) {
    throw new Error(`WorkBuddy target resolves outside workspace: ${resolved}`);
  }
  return resolved;
}
