# Department creation contract

`lark-channel-bridge-department` turns one Feishu group into a governed department through conversation. It does not ship or migrate anyone else's existing departments.

## Start and control a design

Only the Feishu app owner or a configured bridge administrator can start a design, and creation is available only in a group:

```text
/department create <department name>
/department status
/department pause
/department resume
/department cancel
```

Natural-language equivalents are also accepted for pause and resume. Pausing preserves the draft and returns the group to normal agent work. While a design is active, the group is intentionally reserved for department design; unrelated requests are not executed.

## Conversation model

The department name is the one field chosen directly by the user. The agent inventories safe historical context from the bound workspace, including `AGENTS.md`, READMEs, worklogs and plans, then proposes the rest for discussion. Secret-like files, bridge state, SSH state, dependency trees and oversized files are excluded.

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
