# Adaptive Department Orchestration Design

**Date:** 2026-08-24

## Goal

Keep the existing department model, task protocols, Skills, multi-host topology,
and optional subagents while preventing a professional workflow from being
mechanically expanded into one worker plus two reviewers per step or from
repeatedly inheriting a complete long-running conversation.

This change affects only the standalone `lark-channel-bridge-department`
source tree and the packages it will generate in the future. It does not
modify, restart, install over, or migrate an existing Bridge or department.

## Root Cause Addressed

The department model currently distinguishes business lifecycles from task
protocols, but it does not define how task roles and quality checks map to
actual Agent processes. A single-host draft always synthesizes coordinator,
executor, and verifier roles, and every task protocol references a verifier.
Because quality checks are untyped strings, an Agent can incorrectly interpret
each role as a process and every quality check as an independent reviewer.

The generated workspace rules also have no bounded contract for delegation,
review loops, context transfer, or large artifacts. Generic implementation
Skills can therefore override a department task protocol and create a costly
worker/spec-review/quality-review chain even for PPT, writing, research, or
other non-code work.

## Compatibility Strategy

The draft gains one top-level `orchestrationPolicy`. Drafts that omit it receive
a conservative `adaptive` default during normalization, so existing saved
drafts remain valid without migration.

`taskProtocols[*].qualityChecks` accepts both legacy strings and structured
checks. Legacy strings normalize to coordinator checks. Newly generated drafts
use the structured form:

```json
{
  "id": "layout_scan",
  "description": "检查文本越界、重叠和字体缺失",
  "method": "deterministic",
  "trigger": "always"
}
```

Supported methods are `deterministic`, `coordinator`, `independent`, and
`human`. Supported triggers are `always`, `on_failure`, `risk_based`, and
`before_external_action`.

## Orchestration Contract

The default policy is adaptive rather than single-agent-only:

```json
{
  "mode": "adaptive",
  "roleSemantics": "responsibility_not_process",
  "delegationTriggers": [
    "independent_parallel_work",
    "specialized_capability",
    "independent_high_risk_review",
    "scale_justifies_handoff"
  ],
  "maxConcurrentSubagents": 2,
  "maxExecutionAgentsPerWorkItem": 1,
  "maxIndependentReviewsPerMilestone": 1,
  "maxReviewRounds": 1,
  "defaultForkTurns": "none",
  "recentTurnLimit": 3,
  "allowFullHistoryFork": false,
  "deterministicChecksFirst": true,
  "largeArtifactTransfer": "path_and_summary",
  "modelRouting": {
    "lookup": "lightweight",
    "execution": "standard",
    "complexDecision": "critical",
    "independentReview": "critical"
  }
}
```

The policy preserves professional subagents but makes delegation conditional.
Short, sequential, tightly coupled, or deterministically verifiable work stays
with the coordinator. An independent reviewer is created only when a structured
quality check explicitly requires it and the milestone review budget allows it.
Review retries require a new, concrete, localized defect.

`fork_turns="all"` is disallowed by default. A subagent receives a task packet
containing only the goal, ownership, input paths, completion criteria, evidence
requirements, and constraints. Recent turns are an exceptional fallback;
large artifacts are transferred by workspace path plus a concise summary.

## Skill Precedence

The department task protocol owns the business execution strategy. A generic
Skill may provide authoring or verification techniques but must not replace the
task protocol's orchestration policy.

Software-development execution Skills that mandate an implementer plus code
reviewers apply only to actual code implementation. They must not be selected
for PPT, course outline, report, research synthesis, content production, or
other non-code deliverables merely because the work has a written plan.

## Generated Artifacts

The validated policy is written to `workflow.json`. Generated `AGENTS.md` and
the workspace overlay receive a concise adaptive-orchestration section that:

- states that roles and workflow steps do not imply Agent processes;
- lists the permitted delegation triggers and numeric limits;
- gives the fork and artifact-transfer contract;
- explains typed quality-check routing;
- prevents generic Skills from replacing task-protocol orchestration.

The guarded department-design prompt asks the model to propose structured
quality checks and the orchestration policy in natural language for user
confirmation. The final draft schema validates enums, limits, unknown fields,
and unsafe combinations.

## Handoff Behavior

Multi-host handoff remains unchanged. The handoff ledger receives human-readable
quality-check descriptions as evidence requirements, while the full structured
checks stay in `workflow.json`. Existing consumers that expect string evidence
requirements therefore remain compatible.

## Testing

Tests cover:

1. legacy draft normalization;
2. default adaptive limits and role semantics;
3. rejection of unknown or unsafe orchestration values;
4. structured quality-check normalization and validation;
5. generated package and overlay instructions;
6. handoff evidence compatibility;
7. design-prompt and global Bridge prompt precedence rules;
8. the existing department, provisioning, handoff, typecheck, and build suites.

No test or implementation step may read or mutate the active Goblin Bridge or
the existing `~/.lark-channel` state.
