import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoverInterruptedWorkBuddyTransactions } from './workbuddy-provisioner.mjs';
import { assertSafeWorkBuddyPath } from './workbuddy-safe-path.mjs';

const START = '<!-- workbuddy-department-designer:start -->';
const END = '<!-- workbuddy-department-designer:end -->';

export function validateWorkBuddyWorkspace(workspace) {
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw new Error('工作区必须是绝对路径');
  const resolved = path.resolve(workspace);
  const userHome = path.resolve(os.homedir());
  const forbiddenExact = new Set([path.parse(resolved).root, path.dirname(userHome), userHome]);
  const forbiddenPrefixes = [
    process.env.LARK_CHANNEL_DEPARTMENT_HOME,
    process.env.LARK_CHANNEL_HOME,
    path.join(userHome, '.lark-channel'),
    path.join(userHome, '.codex'),
    path.join(userHome, '.ssh'),
  ].filter(Boolean).map((item) => path.resolve(item));
  if (forbiddenExact.has(resolved) || forbiddenPrefixes.some((prefix) => resolved === prefix || resolved.startsWith(`${prefix}${path.sep}`))) {
    throw new Error(`工作区不能使用危险目录：${resolved}`);
  }
  if (!existsSync(resolved)) throw new Error(`工作区不存在：${resolved}`);
  const info = lstatSync(resolved);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('工作区必须是普通目录，不能是符号链接');
  return resolved;
}

function atomicWrite(file, content) {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, file);
}

function snapshot(file) {
  if (!existsSync(file)) return { exists: false };
  const info = lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`目标必须是普通文件：${file}`);
  return { exists: true, content: readFileSync(file), mode: info.mode };
}

function restore(file, before) {
  if (!before.exists) return rmSync(file, { force: true });
  atomicWrite(file, before.content);
  chmodSync(file, before.mode);
}

function indexSection() {
  return [
    START,
    '## WorkBuddy 部门设计入口',
    '',
    '- 当用户要创建或调整部门时，使用 `.codebuddy/skills/department-designer/SKILL.md`。',
    '- 先与用户自由讨论并保存草案；只有用户明确确认创建后，才能生成正式部门文件。',
    '- 普通任务不需要命中固定规程，新任务可以直接执行或自由探索。',
    END,
    '',
  ].join('\n');
}

function designerSkill() {
  return [
    '---',
    'name: department-designer',
    'description: "创建或调整部门时使用。与用户自由讨论、保存草案，并在明确确认后生成正式章程。"',
    '---',
    '',
    '# 部门创建助手',
    '',
    '## 讨论阶段',
    '',
    '- 允许用户用自然语言自由讨论目标、职责、边界、工作方式、能力和交付标准。',
    '- 信息不足时逐步澄清，不要求用户一次填写完整表单。',
    '- 草案可以不完整；每轮内容有变化时，先保存为 JSON，再执行：',
    '  `lark-channel-bridge-department workbuddy department draft --workspace <工作区绝对路径> --spec <草案文件>`',
    '- 讨论阶段不得生成正式章程、正式规程或部门清单。',
    '',
    '## 任务与规程',
    '',
    '- 每类任务先判断：直接执行、单规程、组合规程或自由探索。',
    '- 新任务、低频任务或不确定任务不必强行命中 `taskProtocols`。',
    '- 只有稳定、高频、值得复用的流程才写成规程；规程正文必须分文件按需加载。',
    '- Skill 根据任务内容选择一个主 Skill；辅助 Skill 只有条件明确命中时才加载。',
    '',
    '## 确认与创建',
    '',
    '- 草案完整后，先向用户展示最终部门方案和将创建的文件。',
    '- 只有用户完整回复“同意创建”“确认创建”“按这个方案创建”或“确认部门创建”之一，才视为正式确认。',
    '- “可以”“好的”“继续”等模糊表达不能触发创建。',
    '- 确认后把完整规格保存为 JSON，并执行：',
    '  `lark-channel-bridge-department workbuddy department import --workspace <工作区绝对路径> --spec <规格文件> --confirm-create --confirmation-message "同意创建"`',
    '- 命令成功后，向用户说明生成的章程、规程索引和状态文件；不要配置飞书应用或群路由。',
    '',
  ].join('\n');
}

export function initializeWorkBuddyWorkspace({ workspace }) {
  const resolved = validateWorkBuddyWorkspace(workspace);
  recoverInterruptedWorkBuddyTransactions(resolved);
  const indexPath = path.join(resolved, 'CODEBUDDY.md');
  const skillPath = path.join(resolved, '.codebuddy', 'skills', 'department-designer', 'SKILL.md');
  const skillsPath = path.join(resolved, '.codebuddy', 'skills');
  const sessionsPath = path.join(resolved, '.workbuddy-department', 'sessions');
  for (const target of [indexPath, skillPath, skillsPath, sessionsPath]) {
    assertSafeWorkBuddyPath(resolved, target);
  }
  const indexBefore = snapshot(indexPath);
  const skillBefore = snapshot(skillPath);
  const originalIndex = indexBefore.exists ? indexBefore.content.toString('utf8') : '';
  const originalSkill = skillBefore.exists ? skillBefore.content.toString('utf8') : '';
  if ((originalIndex.includes(START) && !originalIndex.includes(END)) || (!originalIndex.includes(START) && originalIndex.includes(END))) {
    throw new Error('CODEBUDDY.md 中的部门设计入口标记不完整');
  }
  if (skillBefore.exists && !originalSkill.includes('# 部门创建助手')) {
    throw new Error('已存在非本工具管理的部门创建助手 Skill');
  }
  const prefix = originalIndex.trimEnd();
  const nextIndex = originalIndex.includes(START)
    ? originalIndex
    : `${prefix}${prefix ? '\n\n' : ''}${indexSection()}`;
  try {
    atomicWrite(indexPath, nextIndex);
    atomicWrite(skillPath, designerSkill());
    mkdirSync(skillsPath, { recursive: true, mode: 0o700 });
    mkdirSync(sessionsPath, { recursive: true, mode: 0o700 });
  } catch (error) {
    restore(skillPath, skillBefore);
    restore(indexPath, indexBefore);
    throw error;
  }
  return { platform: 'workbuddy', status: 'initialized', workspace: resolved, indexPath, skillPath };
}

export function readWorkBuddySpec(file) {
  const resolved = path.resolve(file);
  const info = lstatSync(resolved);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('规格文件必须是普通文件');
  const parsed = JSON.parse(readFileSync(resolved, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('规格文件必须包含 JSON 对象');
  return parsed;
}
