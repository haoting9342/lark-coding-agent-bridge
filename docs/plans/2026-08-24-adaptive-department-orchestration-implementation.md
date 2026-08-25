# Adaptive Department Orchestration Implementation Plan

> **Execution constraint:** Execute in the current session with one primary
> agent and test-driven development. Do not dispatch implementation or review
> subagents, commit, deploy, restart services, or modify existing departments.

**Goal:** Add a backward-compatible adaptive orchestration contract to future
department drafts and generated workspace rules so roles, quality gates, and
written plans do not automatically create redundant subagents or full-history
forks.

**Architecture:** Normalize a default department-level orchestration policy and
typed quality checks in the draft schema, then render that contract into the
design prompt, workflow package, AGENTS file, and workspace overlay. Preserve
legacy drafts and multi-host handoff by converting structured checks to readable
evidence descriptions at the ledger boundary.

**Tech Stack:** Node.js ESM, TypeScript, Vitest, JSON department packages.

---

### Task 1: Specify draft normalization and validation

**Files:**

- Modify: `tests/unit/department/draft-schema.test.mjs`
- Modify: `department-runtime/department-draft-schema.mjs`

**Steps:**

1. Add failing tests for legacy string checks, structured checks, adaptive
   defaults, and invalid orchestration fields.
2. Run the focused schema test and confirm the new assertions fail.
3. Add normalization constants, default policy, and validation.
4. Run the focused schema test until green.

### Task 2: Render the contract into generated departments

**Files:**

- Modify: `tests/unit/department/provisioner.test.mjs`
- Modify or create focused package/overlay tests if needed.
- Modify: `department-runtime/department-package-writer.mjs`
- Modify: `department-runtime/department-overlay.mjs`

**Steps:**

1. Add failing assertions for `workflow.json`, generated `AGENTS.md`, and the
   workspace overlay.
2. Verify the tests fail because the policy is not rendered.
3. Render concise orchestration and typed verification rules.
4. Run the focused tests until green.

### Task 3: Update guarded department design

**Files:**

- Modify: the most focused prompt test under `tests/unit/department/`
- Modify: `department-runtime/department-design-prompt.mjs`
- Modify: `src/agent/bridge-system-prompt.ts`

**Steps:**

1. Add failing prompt assertions for role/process separation, non-code Skill
   precedence, typed checks, bounded forks, and large-artifact summaries.
2. Verify RED.
3. Update the guarded design prompt and global department runtime contract.
4. Run prompt and typecheck tests until green.

### Task 4: Preserve multi-host evidence compatibility

**Files:**

- Modify: `tests/integration/department/handoff-service.test.mjs`
- Modify: `department-runtime/department-handoff-service.mjs`

**Steps:**

1. Add a failing handoff test using structured quality checks.
2. Verify the ledger currently receives objects rather than descriptions.
3. Map checks to stable human-readable evidence requirements.
4. Run the integration test until green.

### Task 5: Regression verification

**Steps:**

1. Run focused department tests.
2. Run the full unit and integration suites.
3. Run `pnpm typecheck` and `pnpm build`.
4. Run `git diff --check` and review the exact changed paths.
5. Confirm no Goblin command, service command, installer, deployment script, or
   existing Bridge state was invoked.
