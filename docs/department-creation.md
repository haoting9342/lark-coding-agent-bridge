# Department creation contract

`lark-channel-bridge-department` turns one Feishu group into a governed department through conversation. It does not ship or migrate anyone else's existing departments.

## Start and control a design

Only the Feishu app owner or a configured bridge administrator can start a design, and creation is available only in a group:

```text
/cd <absolute workspace path>
/department create <department name>
/department status
/department pause
/department resume
/department cancel
```

Workspace selection is an operational prerequisite rather than a department business field. The current scope, or its Feishu group when the scope is a topic, must already have an explicit workspace mapping. A profile-level `workspaces.default` is never treated as authorization to inventory that directory. When the group is unmapped, creation returns `/cd` guidance without scanning, creating a draft or reserving the group.

Natural-language equivalents are also accepted for pause and resume. Pausing preserves the draft and returns the group to normal agent work. While a design is active, the group is intentionally reserved for department design; unrelated requests are not executed.

## Conversation model

The department name is the one business field chosen directly by the user. After workspace binding, the agent inventories safe historical context from that workspace, including `AGENTS.md`, READMEs, worklogs and plans, then proposes the rest for discussion. Inventory recursively stays inside the selected workspace; only a bounded set of inherited parent `AGENTS.md` files is checked, without scanning parent or sibling directories. Secret-like files, bridge state, SSH state, dependency trees and oversized files are excluded.

The proposal must distinguish:

- a permanent department's mission, service catalog and recurring responsibilities;
- a project department's objective, milestone, deadline, deliverables and closeout;
- the business lifecycle being managed from the task protocols the agent follows for each request;
- responsibility and out-of-scope boundaries;
- capability requirements, installation policy and verification;
- optional node ownership and safe handoff rules.

During discussion, ordinary phrases such as “可以” or “好的” may accept the current suggestion or one specified part. Rejections and partial amendments remain valid. Final provisioning happens only in the final-confirmation phase and only after the department administrator replies with an explicit final `同意` or `确认`.

## Provisioning result

Final confirmation performs one transactional write. The bridge validates the complete draft, snapshots affected files, creates the department package, materializes permitted capabilities, adds the workspace `AGENTS.md` overlay, writes the department registry and updates the group route. A failed required write rolls back the transaction. Repeating final confirmation is idempotent.

The organization is stored under:

```text
~/.lark-channel-department/organizations/default/
```

Each department contains structured `department.json`, `workflow.json`, `topology.json`, capability status, `AGENTS.md`, memory and skills-plan artifacts. A newly written group route takes effect without restarting the bridge.

Capability results are truthful rather than optimistic: built-in, local and fixed GitHub sources can be materialized when their policy permits it; authorization-required, manual, conflicting or failed capabilities are recorded as pending instead of being reported as installed.

## What a task protocol means

A task protocol describes how the agent handles a specific user request. For example, “make a presentation” can require narrative structure, visual consistency, source checks, rendering and final quality review. It is not the same as the department's business lifecycle, such as all stages needed to prepare a public course. The confirmed package keeps these layers separate.

## Adaptive Agent orchestration

Department roles are responsibility definitions, not a request to keep one Agent process running for every role. Workflow steps and quality gates also do not automatically create subagents. A generated department uses an `adaptive` orchestration policy by default: the coordinator handles continuous and tightly coupled work, while subagents are reserved for independent parallel work, specialized capabilities, valuable high-risk review, or work large enough to justify handoff overhead.

The default package permits at most two concurrent subagents, one execution Agent per bounded work item, one independent review per milestone, and one review round unless a new localized defect is found. Subagents receive a compact task packet and default to `fork_turns="none"`; large images, presentations, PDFs and logs are passed by workspace path plus summary.

Quality checks are typed. `deterministic` checks use scripts or tools, `coordinator` checks stay with the primary Agent, `independent` checks may use a separate reviewer within the review budget, and `human` checks stop for explicit user approval. Generic software-development Skills must not replace a PPT, outline, report, research or content protocol merely because the task has a written plan.

## Maintaining a task protocol after creation

Normal task conversation remains model-driven. The bridge does not classify phrases such as “同意” or intercept workflow-edit requests after department creation. Generated `AGENTS.md` rules give the agent the authoritative workflow path and these stable commands:

```bash
lark-channel-bridge-department organization workflow show <department-id>
lark-channel-bridge-department organization workflow apply <department-id>
```

The agent first distinguishes a one-task adjustment from a durable department default, reads the current workflow and accepted artifacts, discusses the proposed protocol diff, and asks for workflow-specific authorization such as `确认修改部门流程`. Generic agreement in ordinary task discussion is not write authorization. `apply` accepts a bounded JSON request on standard input, verifies the expected SHA-256 and protocol schema, creates backups, atomically updates the workflow and generated AGENTS references, and records a transaction receipt. Direct edits to the authoritative workflow are intentionally excluded from the generated operating contract.
