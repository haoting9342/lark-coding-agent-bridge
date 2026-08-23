# One-click Department Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and release a standalone `lark-channel-bridge-department` npm package that initializes an empty organization and provides guarded AI-assisted department creation immediately after first-run Feishu setup.

**Architecture:** Keep the upstream bridge runtime and compile a stable internal department adapter into it. Bundle generic organization templates and the version-matched department runtime in the same npm tarball, store user data under `~/.lark-channel-department`, and use a Node-native transactional provisioner so no second repository, Ruby, Python or environment-variable runtime injection is required.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, tsup, pnpm, `@larksuite/channel`, CardKit, JSON/YAML artifacts, launchd/systemd/Windows service adapters, GitHub Actions/Releases.

---

### Task 1: Establish product identity and isolated runtime paths

**Files:**
- Modify: `package.json`
- Modify: `bin/lark-channel-bridge.mjs`
- Modify: `src/config/app-paths.ts`
- Modify: `src/daemon/launchd.ts`
- Modify: `src/daemon/systemd.ts`
- Modify: `src/daemon/windows.ts`
- Modify: service-related CLI files found by the failing contract tests
- Test: `tests/unit/config/app-paths.test.ts`
- Test: `tests/unit/daemon/profile-args.test.ts`
- Test: `tests/unit/daemon/launchd-autostart.test.ts`
- Test: `tests/unit/cli/index-registration.test.ts`
- Create: `tests/unit/product-identity.test.ts`

**Step 1:** Write failing tests that require package name and primary bin
`lark-channel-bridge-department`, default root `~/.lark-channel-department`,
`LARK_CHANNEL_DEPARTMENT_HOME`, and department-specific OS service identifiers.

**Step 2:** Run the focused tests and verify they fail against the upstream
identity and `.lark-channel` root.

**Step 3:** Change package metadata, CLI name, default paths and service labels.
Do not install the upstream binary alias and do not read `LARK_CHANNEL_HOME` as
the department-edition default.

**Step 4:** Run the focused tests and typecheck until green.

**Step 5:** Stage the exact files and commit with
`feat(product): isolate department bridge identity`.

### Task 2: Add atomic organization initialization and diagnostics

**Files:**
- Create: `src/organization/schema.ts`
- Create: `src/organization/paths.ts`
- Create: `src/organization/initializer.ts`
- Create: `src/organization/doctor.ts`
- Create: `src/cli/commands/organization.ts`
- Modify: `src/cli/index.ts`
- Modify: `src/runtime/profile-runtime.ts`
- Create: `assets/organization-template/organization.json`
- Create: `assets/organization-template/company/company-policy.json`
- Create: `assets/organization-template/company/approval-policy.json`
- Create: `assets/organization-template/company/capability-catalog.json`
- Create: `assets/organization-template/company/department-registry.json`
- Create: `assets/organization-template/router/group-router.json`
- Test: `tests/unit/organization/initializer.test.ts`
- Test: `tests/unit/organization/doctor.test.ts`
- Test: `tests/integration/cli/organization-command.test.ts`

**Step 1:** Write failing tests for clean initialization, exact generic files,
0700/0600 permissions where supported, idempotent second initialization,
rollback of a failed copy, rejection of symlink/template escape, and
`organization status/doctor` output.

**Step 2:** Run those tests and verify missing modules/commands cause RED.

**Step 3:** Implement schema validation, temporary-sibling initialization,
atomic rename, profile attachment to organization `default`, and read-only
diagnostics. Use package-relative template discovery that still works from a
packed tarball.

**Step 4:** Run focused tests, CLI registration tests and typecheck.

**Step 5:** Commit exact files with
`feat(organization): initialize empty control plane`.

### Task 3: Bundle the guarded department design runtime

**Files:**
- Create: `department-runtime/department-confirmation.mjs`
- Create: `department-runtime/department-design-store.mjs`
- Create: `department-runtime/department-draft-schema.mjs`
- Create: `department-runtime/department-design-prompt.mjs`
- Create: `department-runtime/department-context-inventory.mjs`
- Create: `department-runtime/department-wizard.mjs`
- Create: `department-runtime/department-command-runtime.mjs`
- Create: `department-runtime/bootstrap.mjs`
- Modify: `src/opc/department-extension.ts`
- Modify: `src/commands/index.ts`
- Modify: `src/bot/channel.ts`
- Test: `tests/unit/department/confirmation.test.ts`
- Test: `tests/unit/department/draft-schema.test.ts`
- Test: `tests/unit/department/design-store.test.ts`
- Test: `tests/integration/bot/department-design-intake.test.ts`

**Step 1:** Port the current generic behavior tests into the bridge and change
their fixtures to use the isolated organization root and current profile paths.
Add a failing integration test that starts `/department create 公开课`, bypasses
the mention gate for subsequent unthreaded messages, records participant
suggestions, supports pause/resume and transforms admin discussion into a
guarded Agent prompt.

**Step 2:** Run the tests and confirm RED because the fork still requires
`OPC_DEPARTMENT_RUNTIME_ENTRY` and uses the stale wizard boolean interface.

**Step 3:** Bring the version-matched generic runtime modules into the package,
remove personal paths/host enums/external controller loading, and load the
bundled runtime through a package-relative internal entry. Pass organization
root, profile paths, current workspace and bridge controls directly.

**Step 4:** Run all focused department tests, bot access/mention regressions and
typecheck.

**Step 5:** Commit exact files with
`feat(department): bundle conversational design runtime`.

### Task 4: Implement Node-native transactional department provisioning

**Files:**
- Create: `department-runtime/transaction-journal.mjs`
- Create: `department-runtime/department-package-writer.mjs`
- Create: `department-runtime/department-package-validator.mjs`
- Create: `department-runtime/department-overlay.mjs`
- Create: `department-runtime/department-provisioner.mjs`
- Modify: `department-runtime/bootstrap.mjs`
- Test: `tests/unit/department/package-writer.test.ts`
- Test: `tests/unit/department/package-validator.test.ts`
- Test: `tests/integration/department/provisioning-transaction.test.ts`

**Step 1:** Write failing tests for deterministic permanent/project packages,
separate `taskProtocols` and `businessLifecycle`, registry/route updates,
workspace AGENTS overlay preservation, duplicate chat rejection, protected
workspace rejection, and full rollback after injected failures at every write
stage.

**Step 2:** Verify RED with missing Node-native writer/provisioner.

**Step 3:** Implement JSON control-plane files plus Markdown/YAML-compatible
human artifacts using Node only. Snapshot every target before mutation, write
temporaries with restrictive modes, rename atomically, and restore all targets
on failure. Never create or touch paths outside the organization root and the
validated target workspace.

**Step 4:** Run focused transaction tests, department design tests and
typecheck.

**Step 5:** Commit exact files with
`feat(department): provision departments with node transactions`.

### Task 5: Materialize capabilities truthfully

**Files:**
- Create: `department-runtime/department-capability-materializer.mjs`
- Modify: `department-runtime/department-provisioner.mjs`
- Modify: `department-runtime/department-design-prompt.mjs`
- Modify: `assets/organization-template/company/capability-catalog.json`
- Test: `tests/unit/department/capability-materializer.test.ts`
- Test: `tests/integration/department/capability-receipt.test.ts`

**Step 1:** Write failing tests for builtin availability, existing Skill
binding, pinned GitHub Skill install through an injected fixed adapter,
idempotent reuse, target conflict, pending authorization, unsupported adapter,
failed verification and required-capability readiness.

**Step 2:** Verify RED.

**Step 3:** Implement allowlisted adapters and filesystem-safe verification.
The generic catalog starts empty except for verifiable builtins; no OPC-private
or example-specific Skill is auto-installed. Never execute model-authored
commands.

**Step 4:** Run capability, provisioning and prompt tests.

**Step 5:** Commit exact files with
`feat(department): materialize confirmed capabilities`.

### Task 6: Integrate reliable managed process cards

**Files:**
- Modify: `src/card/managed.ts`
- Modify: `src/bot/channel.ts`
- Modify: `tests/integration/bot/markdown-stream-startup-failure.test.ts`
- Modify: `tests/unit/card/managed.test.ts`
- Create: `tests/integration/bot/managed-process-card.test.ts`

**Step 1:** Recreate the already-written local tests first in the product
worktree: same-sequence retries, three-attempt exhaustion, default Codex managed
card, signed stop action, degraded update continuity, process-card recall and
separate final delivery.

**Step 2:** Run them and verify RED against the clean product branch.

**Step 3:** Apply the minimal card changes from the read-only local worktree,
reconciling them with the department intake changes rather than overwriting
`src/bot/channel.ts`.

**Step 4:** Run focused card tests, callback security tests, Claude regression,
the entire bot integration directory and typecheck.

**Step 5:** Commit exact files with
`feat(card): restore managed Codex process cards`.

### Task 7: Add optional node topology and bounded handoff primitives

**Files:**
- Create: `src/organization/nodes.ts`
- Create: `department-runtime/department-handoff-ledger.mjs`
- Create: `department-runtime/department-handoff-adapter.mjs`
- Create: `department-runtime/department-runner-registry.mjs`
- Create: `src/cli/commands/organization-node.ts`
- Modify: `src/cli/index.ts`
- Modify: `department-runtime/department-draft-schema.mjs`
- Test: `tests/unit/organization/nodes.test.ts`
- Test: `tests/unit/department/handoff-ledger.test.ts`
- Test: `tests/integration/department/handoff-routing.test.ts`

**Step 1:** Write failing tests for automatic local-primary registration,
dedicated pairing identity metadata, single-primary authority, bounded context,
capability-based node selection, offline/timeout receipts, idempotency and
auxiliary write rejection.

**Step 2:** Verify RED.

**Step 3:** Implement the local topology and transport-independent handoff
contracts. Expose invite/join planning and forced-command configuration as
explicit optional operations; do not alter SSH during normal installation.

**Step 4:** Run focused topology/handoff tests and typecheck.

**Step 5:** Commit exact files with
`feat(organization): add optional multi-host topology`.

### Task 8: Document and verify the clean install contract

**Files:**
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `package.json`
- Create: `docs/department-creation.md`
- Create: `docs/organization-nodes.md`
- Create: `tests/packaging/clean-install.test.mjs`
- Modify: `.github/workflows/ci.yml` or create a package workflow if no suitable workflow exists

**Step 1:** Write a failing packaging test that runs `pnpm pack`, inspects the
tarball for runtime/templates/docs, installs it under a temporary npm prefix and
temporary HOME, invokes `lark-channel-bridge-department --version`, initializes
an organization and verifies no file appears under `.lark-channel`.

**Step 2:** Verify RED before package metadata/files are complete.

**Step 3:** Complete package files, bilingual documentation, release build and
checksum workflow. Document that multi-host pairing is optional and that no OPC
instance data is bundled or migrated.

**Step 4:** Run the packaging test from the actual tarball.

**Step 5:** Commit exact files with
`docs: publish department bridge install contract`.

### Task 9: Full verification and release

**Files:**
- Verify all changed files
- Create locally: packed npm tarball and checksum

**Step 1:** Run `git diff --check`, `pnpm test`, `pnpm typecheck`, `pnpm build`,
the clean-install tarball test, and isolated organization/department end-to-end
tests.

**Step 2:** Inspect the packed file list and scan it for OPC names, private chat
IDs, `/Users/crystal`, `/home/hao`, secrets and external runtime environment
variables. Any match is a release blocker unless it is an explicit historical
security test fixture that cannot reach the tarball.

**Step 3:** Run a clean temporary-HOME foreground smoke with fake or dedicated
test credentials. Do not target existing Mac/Goblin profiles or services.

**Step 4:** Use `superpowers:requesting-code-review` and resolve actionable
findings with `superpowers:receiving-code-review` plus focused regression tests.

**Step 5:** Use `superpowers:verification-before-completion`, then merge the
feature branch into the fork's `main` without force-push, push the authorized
commits, create the authorized version tag and GitHub Release, upload the npm
tarball and SHA-256 file, and read back the remote ref and release assets.

**Step 6:** Report the install command, commit, tag, checksums and verification
evidence. Explicitly confirm that no existing OPC service or department was
modified.
