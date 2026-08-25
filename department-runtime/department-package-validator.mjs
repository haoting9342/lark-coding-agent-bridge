import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const REQUIRED_FILES = [
  'department.json',
  'workflow.json',
  'topology.json',
  'existing-assets.json',
  'AGENTS.md',
  'memory.md',
  'skills-plan.md',
];

function assertSafeTree(directory) {
  for (const entry of readdirSync(directory)) {
    const candidate = path.join(directory, entry);
    const info = lstatSync(candidate);
    if (info.isSymbolicLink()) throw new Error(`department package contains a symbolic link: ${entry}`);
    if (info.isDirectory()) assertSafeTree(candidate);
    else if (!info.isFile()) throw new Error(`department package contains an unsupported entry: ${entry}`);
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function validateDepartmentPackage(directory, expected) {
  if (!existsSync(directory)) throw new Error(`department package is missing: ${directory}`);
  const rootInfo = lstatSync(directory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('department package must be a regular directory');
  }
  assertSafeTree(directory);
  for (const file of REQUIRED_FILES) {
    const target = path.join(directory, file);
    if (!existsSync(target) || !lstatSync(target).isFile()) {
      throw new Error(`department package file is missing: ${file}`);
    }
  }
  const department = readJson(path.join(directory, 'department.json'));
  const workflow = readJson(path.join(directory, 'workflow.json'));
  const topology = readJson(path.join(directory, 'topology.json'));
  readJson(path.join(directory, 'existing-assets.json'));
  if (department.schemaVersion !== 1 || department.id !== expected.departmentId) {
    throw new Error('department package identity is inconsistent');
  }
  if (department.group?.chatId !== expected.chatId || department.workspace !== expected.workspace) {
    throw new Error(
      `department package route is inconsistent: ${department.group?.chatId}/${department.workspace}`
      + ` != ${expected.chatId}/${expected.workspace}`,
    );
  }
  if (workflow.schemaVersion !== 1 || workflow.semantics !== 'task_execution') {
    throw new Error('department workflow semantics are invalid');
  }
  if (!Array.isArray(workflow.taskProtocols) || workflow.taskProtocols.length === 0) {
    throw new Error('department package requires at least one task protocol');
  }
  if (
    !new Set(['adaptive', 'coordinator_only', 'delegated']).has(workflow.orchestrationPolicy?.mode)
    || workflow.orchestrationPolicy?.roleSemantics !== 'responsibility_not_process'
  ) {
    throw new Error('department package orchestration policy is invalid');
  }
  if (topology.schemaVersion !== 1 || !topology.primaryNodeId || !Array.isArray(topology.nodes)) {
    throw new Error('department topology is invalid');
  }
  return { department, workflow, topology };
}
