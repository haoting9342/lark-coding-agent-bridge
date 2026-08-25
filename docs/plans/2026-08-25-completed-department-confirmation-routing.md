# Completed Department Confirmation Routing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Prevent completed departments from consuming ordinary task replies such as `同意` and `确认`.

**Architecture:** Keep department intake ahead of normal routing while making terminal completed state transparent to non-command messages. Preserve final-phase confirmation classification and provisioning idempotency for active designs.

**Tech Stack:** Node.js ESM, TypeScript bridge, JavaScript department runtime, Vitest.

---

### Task 1: Add the completed-state routing regression

**Files:**
- Test: `tests/integration/bot/department-design-intake.test.mjs`

**Step 1: Write the failing test**

Create a real design session, transition it through final confirmation, provisioning, and completion, then assert each explicit confirmation phrase returns `{ action: 'pass' }` and produces no department reply.

**Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run tests/integration/bot/department-design-intake.test.mjs`

Expected: FAIL because the current completed-state guard returns `handled` for `同意`.

### Task 2: Remove terminal-state natural-language interception

**Files:**
- Modify: `department-runtime/department-command-runtime.mjs`

**Step 1: Implement the minimal fix**

Return `pass` immediately when `state.status === "completed"` and remove the now-unused repeat-confirmation helper. Do not change confirmation handling for active designs.

**Step 2: Run the focused test to verify it passes**

Run: `pnpm vitest run tests/integration/bot/department-design-intake.test.mjs`

Expected: PASS.

### Task 3: Verify source and distributable package

**Files:**
- Verify only: `department-runtime/**`, package manifest, build output

**Step 1: Run department tests**

Run: `pnpm vitest run tests/unit/department tests/integration/department tests/integration/bot/department-design-intake.test.mjs`

Expected: all tests pass.

**Step 2: Run static and package verification**

Run: `pnpm typecheck && pnpm test:package && pnpm build`

Expected: all commands exit successfully. The package already includes the root `department-runtime` directory, so the fixed runtime is automatically part of the zero-install department Bridge package.

No commit or deployment is included in this plan.
