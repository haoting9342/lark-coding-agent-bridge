# 新飞书群加入已有部门 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an immediate, administrator-authorized `/department join <departmentId>` command that binds a new Feishu group to an existing department and its workspace.

**Architecture:** Extend the existing department command runtime and provisioner-facing route controller. The command resolves an existing department from the organization registry, rejects route conflicts, applies the chat-to-workspace mapping, and persists the group route atomically without copying conversation history.

**Tech Stack:** TypeScript/JavaScript ESM, Vitest, existing organization registry/router and WorkspaceStore abstractions.

---

### Task 1: Lock command and route behavior with tests

**Files:**
- Modify: `tests/unit/department/department-command-runtime.test.mjs`
- Modify: `tests/unit/department/department-provisioner.test.mjs`

- [ ] **Step 1: Write failing tests** in a new `tests/unit/department/department-join.test.mjs` for `/department join writers`, unknown department, conflicting route, and idempotent same-department join. Assert the route controller receives `{ chatId, cwd }` and the router persists the department route.
- [ ] **Step 2: Run the focused test** with `pnpm exec vitest run tests/unit/department/department-join.test.mjs` and confirm the join cases fail before implementation.

### Task 2: Implement join in the department runtime

**Files:**
- Modify: `department-runtime/department-command-runtime.mjs`
- Modify: `department-runtime/bootstrap.mjs`

- [ ] **Step 1: Add `join` argument parsing and a runtime method** that checks group context, resolves the requested department from the registry, rejects conflicts, and calls the route persistence adapter.
- [ ] **Step 2: Return a concise success payload** containing department name, workspace, and chat id; do not include secrets or transcript data.
- [ ] **Step 3: Run `pnpm exec vitest run tests/unit/department/department-join.test.mjs` and verify all join cases pass.

### Task 3: Persist and expose the new route

**Files:**
- Modify: `department-runtime/department-provisioner.mjs`
- Test: `tests/unit/department/department-join.test.mjs`

- [ ] **Step 1: Reuse the existing atomic registry/router write path** and add only the new route entry; preserve all existing routes.
- [ ] **Step 2: Apply the same workspace mapping used by department creation so regular groups and topic scopes resolve the department workspace.
- [ ] **Step 3: Add rollback coverage for write failures and run the focused join test again.

### Task 4: Verify package and update user documentation

**Files:**
- Modify: `docs/department-creation.md`
- Modify: `docs/workbuddy-department.md`
- Modify: `README.zh.md`

- [ ] **Step 1: Document `/department join <部门编号>` and explain same-workspace new-session inheritance versus transcript inheritance.
- [ ] **Step 2: Run `pnpm exec vitest run --exclude '.worktrees/**'`, `pnpm typecheck`, `pnpm build`, and `git diff --check`.
- [ ] **Step 3: Bump the package version, publish a release, and verify the public tarball with a clean install.
