# Model-driven Department Workflow Maintenance Design

**Date:** 2026-08-25

## Goal

Let a user evolve an existing department task protocol through ordinary Codex
conversation without turning normal messages into a Bridge-owned keyword state
machine. Codex owns semantic discovery and drafting; a bounded organization
tool owns validation, backup, concurrency control, atomic writes and receipts.

The same design also repairs the existing OPC YAML control plane and upgrades
the public-course presentation protocol from a PPTX-only contract to the Web
presentation process that has already produced accepted pages.

## Boundary

The running Bridge process remains a transport and routing layer for normal
department work. It does not classify phrases such as `同意`, `以后` or `修改`
and does not intercept workflow-maintenance conversations.

The department package generated at creation time provides Codex with:

- the authoritative workflow file's absolute path;
- a stable command for reading its version/hash;
- rules that distinguish a task-local override from a durable department rule;
- a stable command for applying a confirmed structured change.

Codex may inspect work history, propose a new protocol and discuss partial
changes normally. It must not write the authoritative file directly when a
maintenance command is available.

## Change semantics

Language such as `这次`, `当前这份` or `先用网页` is a task-local override and
does not update the department. Language such as `以后`, `默认`, `今后都按`
or an explicit request to modify the department workflow is a durable-change
candidate. Ambiguous scope is clarified by the model before proposing a write.

A durable update follows this flow:

1. Codex reads the authoritative workflow plus recent accepted artifacts.
2. Codex presents the affected task protocol and a concise before/after diff.
3. The user may accept, reject or revise individual parts in normal dialogue.
4. Codex asks for a workflow-specific final authorization such as
   `确认修改部门流程`.
5. Codex sends a restricted update request to the organization workflow tool.
6. The tool verifies the expected hash, department identity, operation schema
   and protocol schema; creates a backup; atomically replaces the workflow and
   generated AGENTS rules; and writes a receipt.

Generic acknowledgements do not satisfy the updater's confirmation contract.
This is intentionally separate from department creation confirmation.

## Update contract

The first supported operations are deliberately small:

- `replace_task_protocol`;
- `add_task_protocol`;
- `remove_task_protocol`.

Every request includes the department ID, expected workflow SHA-256, reason,
confirmation text and operations. Replacing a protocol requires the complete
new protocol object, which lets the validator inspect its inputs, professional
steps, quality checks, deliverables and completion criteria together.

Concurrent or stale updates fail without writing. A failure after a target has
been changed restores the backed-up workflow and AGENTS files. Receipts record
old/new hashes, changed protocol IDs, actor/reason and backup location; they do
not store raw chat history.

## Generated AGENTS contract

New departments render a bounded section that states:

- the authoritative workflow path;
- that one-off task choices remain local unless the user makes them durable;
- that Codex must discuss and confirm a durable protocol change;
- the exact `organization workflow show/apply` commands;
- that direct edits are forbidden when the controlled updater is available.

The updater regenerates the same bounded section after a protocol changes so
the readable routing summary never drifts from the workflow document.

## Public-course Web presentation protocol

The current `slide_deck_production` protocol will become a browser-presentation
contract based on the accepted page 1–6 evidence and the approved page 7–10
design pattern:

1. Read the accepted outline, prior pages, speaker script and evidence state.
2. Work in one page or a small coherent batch; do not rebuild the whole deck by
   default.
3. Confirm narrative, page message, visual composition, reveal steps, speaker
   notes and evidence boundaries before implementation.
4. Implement semantic 16:9 audience and presenter views, replaceable asset
   slots, reduced-motion behavior, keyboard controls, blackout/reset and
   same-origin window synchronization.
5. Validate content/reveal contracts and JavaScript syntax deterministically.
6. Test 1920x1080 and 1280x720 audience views plus a 1440x900 presenter view,
   including bounds, text overflow, console output, navigation and sync.
7. Review actual screenshots with the owner and revise only the affected pages.
8. Deliver source, reachable preview, screenshots, acceptance report, manifest,
   evidence/placeholder list and an offline or existing PPTX fallback.

The workflow keeps narrative and evidence discipline from the previous PPT
contract but replaces PPTX XML/object checks with DOM, browser and service
checks. Traditional PPTX remains a separate future protocol or explicit task
variant rather than an implicit completion requirement.

## Compatibility and deployment

The standalone `lark-channel-bridge-department` JSON organization receives the
new updater and generated instructions. The existing `opc-company` YAML control
plane receives an equivalent updater and absolute workflow reference. The live
public-course workflow can be updated without restarting the Bridge because no
message routing or running process code changes are required.

No existing Bridge installation is restarted or replaced as part of this
change. Deploying new runtime code remains a separate operation.

## Verification

- Unit tests prove authoritative paths and maintenance instructions are
  rendered into AGENTS rules.
- Red/green updater tests cover valid replacement, stale hashes, ambiguous
  confirmation, invalid protocols, backup/receipt creation and rollback.
- Existing department creation/provisioning tests continue to pass.
- The public-course YAML is parsed and the replacement protocol is inspected
  after application.
- Goblin readback proves the workflow hash, AGENTS reference and transaction
  receipt without restarting the service.
