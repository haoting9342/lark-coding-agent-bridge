# Model-driven Department Workflow Maintenance Implementation Plan

> **For Codex:** Execute this plan with test-driven development and completion
> verification. Do not commit or push because the current conversation did not
> authorize either action.

**Goal:** Add model-driven, safely persisted task-protocol maintenance to both
department package formats and upgrade the live public-course presentation
workflow to its accepted Web production process.

**Architecture:** Generated AGENTS rules give Codex an authoritative workflow
path and stable maintenance command. Codex handles natural-language reasoning;
an offline organization CLI applies only explicit, hash-guarded structured
operations and regenerates the readable AGENTS rules transactionally. The
running Bridge does not intercept workflow dialogue.

**Tech Stack:** Node.js ESM/TypeScript/Vitest for
`lark-channel-bridge-department`; Python/PyYAML and Node tests for the legacy
`opc-company` YAML control plane; SSH readback for Goblin verification.

---

### Task 1: Render an authoritative workflow maintenance contract

**Files:**

- Modify: `department-runtime/department-overlay.mjs`
- Modify: `department-runtime/department-provisioner.mjs`
- Modify: `department-runtime/department-package-writer.mjs`
- Modify: `tests/unit/department/provisioner.test.mjs`
- Modify: `../opc-company/bin/render_department_overlay.mjs`
- Modify: `../opc-company/tests/department_overlay_test.mjs`

1. Add failing assertions for the absolute workflow path, show/apply commands,
   task-local versus durable-change wording and workflow-specific confirmation.
2. Run the focused tests and confirm they fail because the contract is absent.
3. Pass the organization/control-plane root into each renderer and add the
   bounded maintenance section.
4. Run the focused tests and confirm they pass.

### Task 2: Add the standalone JSON workflow updater

**Files:**

- Create: `department-runtime/department-workflow-updater.mjs`
- Create: `tests/unit/department/workflow-updater.test.mjs`
- Create: `src/cli/commands/organization-workflow.ts`
- Modify: `src/cli/index.ts`
- Modify: `department-runtime/department-package-writer.mjs`
- Modify: `department-runtime/department-draft-schema.mjs`

1. Write failing tests for show metadata and a valid
   `replace_task_protocol` transaction.
2. Add failing tests for a stale SHA, generic confirmation, missing protocol,
   invalid replacement, rollback and receipt contents.
3. Implement task-protocol validation reuse, a per-organization lock, regular
   file/symlink checks, atomic writes, backups and receipts.
4. Regenerate the package AGENTS document and workspace overlay from the new
   workflow after a successful update.
5. Expose `organization workflow show <department-id>` and
   `organization workflow apply <department-id>`; apply reads a bounded JSON
   request from standard input.
6. Run focused tests, type checking and CLI help/build verification.

### Task 3: Add the legacy YAML workflow updater

**Files:**

- Create: `../opc-company/bin/update_department_workflow.py`
- Create: `../opc-company/tests/department_workflow_update_test.py`
- Modify: `../opc-company/bin/department_package.py`
- Modify: `../opc-company/README.md`

1. Write the same red tests against a temporary YAML department package and
   workspace AGENTS file.
2. Implement YAML parsing, restricted protocol operations, expected SHA,
   workflow-specific confirmation, schema validation, backup, atomic write,
   AGENTS regeneration and a JSON receipt.
3. Run the focused Python tests plus existing package and overlay tests.

### Task 4: Upgrade the public-course protocol

**Files:**

- Generate a structured replacement request from the Goblin workflow and the
  accepted Web-deck specifications/reports.
- Update through the new YAML updater:
  `/home/hao/.local/share/opc-company/department-control-plane/departments/dept_e652ed76f3ec/workflow.yaml`
- Regenerate the bounded section in:
  `/home/hao/work/公开课/AGENTS.md`

1. Wait until the current public-course run is idle.
2. Read and hash the authoritative workflow.
3. Construct one complete replacement for `slide_deck_production` using the
   accepted page 1–6 process and current owner-approved iterative pattern.
4. Dry-run/validate the request locally.
5. Apply it on Goblin with a timestamped backup and receipt, without restarting
   the Bridge.
6. Read back the protocol, AGENTS absolute path, hashes and receipt.

### Task 5: Regression and packaging verification

1. Run standalone focused tests.
2. Run the full standalone unit/integration suite, typecheck and build/package
   checks appropriate to the changed files.
3. Run the legacy control-plane focused tests and validation suite.
4. Run `git diff --check` in both repositories and inspect the complete diffs.
5. Confirm the Goblin Bridge PID/argv is unchanged and the public-course route
   still points at `/home/hao/work/公开课`.
6. Report exact test counts, live hashes, backup/receipt locations and any
   deployment work that remains. Do not claim the running Bridge code was
   upgraded.
