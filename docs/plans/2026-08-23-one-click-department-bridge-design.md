# One-click Department Bridge Design

**Date:** 2026-08-23

## Goal

Ship a standalone `lark-channel-bridge-department` package that a new user can
install from a GitHub Release and immediately use to create their own
department organization through a guarded, AI-assisted Feishu conversation.

The package is a product template for other users. It must not import, migrate,
attach to, deploy over, or otherwise mutate the existing OPC Mac/Goblin bridge,
the existing `opc-company` control plane, or any current department.

## Product Identity and Isolation

- npm package: `lark-channel-bridge-department`
- primary CLI: `lark-channel-bridge-department`
- default state root: `~/.lark-channel-department`
- state override: `LARK_CHANNEL_DEPARTMENT_HOME`
- launchd label prefix: `ai.lark-channel-bridge-department`
- systemd unit prefix: `lark-channel-bridge-department`
- Windows task prefix: `LarkChannelBridgeDepartment`

The product does not install a `lark-channel-bridge` binary alias and does not
read `~/.lark-channel` by default. This lets the upstream bridge and the
department edition coexist without sharing credentials, profiles, services,
sessions, workspaces, or organization files.

## Bundled Architecture

One npm tarball contains:

1. the upstream Feishu/Codex bridge;
2. the reliable managed process-card behavior developed locally;
3. a versioned organization initializer and empty generic template;
4. the department design state machine, schema, prompt, context inventory,
   confirmation guard, transaction journal, and capability materializer;
5. a Node-native department package writer and validator;
6. optional node topology and bounded handoff primitives.

The package never downloads a second control-plane repository at runtime and
does not require Ruby, Python, or PyYAML. User-owned organization data is copied
from the bundled template on first run and then lives independently of the npm
installation.

## Organization Storage

The first `run`, `start`, or `profile create` atomically initializes:

```text
~/.lark-channel-department/
├── config.json
├── profiles/
└── organizations/default/
    ├── organization.json
    ├── company/
    ├── departments/
    ├── router/
    ├── onboarding/
    ├── transactions/
    ├── nodes/
    ├── capabilities/
    └── backups/
```

`organization.json` records the organization identifier, schema version,
template version, primary node and creation time. The template contains generic
policies and empty registries only. It must not contain OPC department names,
chat IDs, host paths, private capability sources, or instance-specific rules.

Initialization writes into a sibling temporary directory, validates the whole
template, and renames it into place. Existing organizations are never
reinitialized. Startup fails clearly if first-run initialization cannot produce
a valid writable organization; it does not register a partial daemon.

Each local bridge profile references `organizationId: default`. Sessions,
credentials and raw chat history remain profile-local and are not copied into
organization memory.

## AI-assisted Department Creation

An owner/admin starts in the target group with `/department create` or
`/department create <name>`. The only value the user must personally choose is
the department name.

During an active design, the whole chat is exclusive to department discussion.
The bridge intercepts every message after access control and before the group
mention gate, so the user does not need to reply to a specific message. Normal
Codex work resumes only after pause, cancel or successful completion.

The model receives a guarded design prompt plus a bounded inventory of the
current group/workspace: relevant `AGENTS.md` files, worklogs, existing workflow
documents, installed Skills and verified asset names. Raw sessions from other
groups, secrets and unverified summaries are excluded.

The conversation iterates through goal discovery, context inventory,
brainstorming, draft discussion, partial acceptance/rejection, representative
task simulation, validation and final review. It is not a fixed field
questionnaire. `好的` and `可以` accept local suggestions but do not authorize
filesystem writes. Only an owner/admin's unconditional explicit confirmation
such as `同意`, `确认`, `同意创建` or `确认创建`, while the latest validated version
is awaiting final confirmation, starts provisioning.

`/department pause`, `/department resume` and `/department cancel` remain
available, with matching unambiguous natural-language phrases. Participants may
submit suggestions but cannot change the formal draft or confirm it.

## Department Model

The validated draft distinguishes:

- `permanent` departments with mission, service catalog, recurring work and
  default projects;
- `project` departments with objective, deadline decision, milestones,
  deliverables, evidence-based completion and archive/extension choices;
- `businessLifecycle`, which describes the real end-to-end business/project;
- `taskProtocols`, one professional execution protocol per core service.

Each task protocol records intents, required inputs, clarification policy,
professional steps, quality checks, deliverables, completion criteria, revision
policy, skills and execution policy. A single task runs only its matching
protocol. The complete business lifecycle is used only for explicit end-to-end
or project-management requests.

Final provisioning writes a deterministic department package, registry entry,
chat route, AGENTS overlay, curated memory, workflow, topology, Skills plan,
capability receipts and transaction record. Writes are backed up and rolled
back together on failure.

## Capability Materialization

`capabilityPlan` is the only executable installation contract. It includes the
capability kind, required flag, scope, target node, binding mode, exact source,
pinned ref/version, install policy and verification method.

- built-in or installed capabilities are verified and bound;
- exact, already-confirmed, low-risk GitHub Skills may be installed through a
  fixed adapter after final confirmation;
- OAuth, personal login, credentials and system permissions become
  `pending_authorization`;
- unsupported MCP/CLI/external adapters become `pending_manual`;
- conflicts and failures are explicit and never reported as ready;
- model-authored arbitrary shell commands are never executed.

Department creation and capability readiness are separate outcomes. A
department with unresolved required capabilities is reported as created but not
fully ready.

## Multi-host Boundary

The first host registers as the local primary; single-host users do nothing
else. Optional node commands create a dedicated pairing identity and register
auxiliary capabilities. The organization primary owns formal rules, routing,
shared memory and the handoff ledger. Auxiliary nodes may return bounded task
receipts and artifacts but cannot mutate organization governance.

The first transport is an explicit SSH forced-command adapter. It uses a
dedicated key and a fixed JSON protocol, never a general remote shell. Secrets,
cookies, login state and raw chat history remain on the node that owns them.
If a required node is offline, the primary reports wait/retry/manual options and
does not fabricate a result.

Multi-host pairing is optional and separately initiated. It is not part of the
zero-configuration single-host first run.

## Managed Feishu Cards

For a default Codex profile, the effective reply mode uses a managed CardKit
process card. The card contains a signed stop action while running. Updates are
retried up to three attempts with the same sequence. Exhausted update failures
degrade presentation but never abort the Agent run.

Normal completion recalls the temporary process card and sends one separate
final answer. Interrupted, failed and idle-timeout runs keep an explicit
terminal status. Explicit user reply-mode choices and Claude behavior remain
unchanged. Department design model turns use the same reliable process-card
path.

## Versioning and Release

Program code and organization data have separate versions. Upgrading the npm
package does not overwrite confirmed department content. Additive organization
migrations use a lock, dry-run plan, backup and atomic transaction. Destructive
or semantic migrations require explicit confirmation.

GitHub Releases publish a prebuilt npm tarball and SHA-256 checksum. Installing
the tarball requires Node/npm only, not git or pnpm. Release verification uses
an isolated HOME and test Feishu identity; it never targets the existing OPC
Mac/Goblin services.

## Acceptance Criteria

1. A clean machine can install the tarball and run the new CLI without Ruby,
   Python, a second repository or manual runtime environment variables.
2. The new CLI and service state do not collide with upstream bridge defaults.
3. First run creates one valid empty organization idempotently.
4. A new group can complete a multi-turn permanent or project department
   design, including partial revisions and explicit final confirmation.
5. Generated task protocols remain separate from the business lifecycle.
6. Department writes and capability receipts are transactional and truthful.
7. The managed process card, signed stop action, retry and final-answer behavior
   pass unit and integration tests.
8. Single-host operation is immediate; optional node topology and handoff
   contracts are available without weakening primary ownership.
9. Packaging tests inspect the actual tarball and perform a clean isolated
   install.
10. No existing OPC configuration, repository data or running service is read
    as a migration source or modified during implementation and verification.
