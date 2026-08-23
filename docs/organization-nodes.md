# Optional multi-host organization nodes

A clean install starts with one local primary node. This is enough for department creation and normal work. Multi-host topology is optional and is never configured automatically during installation.

The primary node owns user conversation, governance, planning and final synthesis. An auxiliary node has execution-only authority, receives only bounded internal JSON tasks, and never talks directly to the Feishu group. This supports capability-bound work such as using a browser session that exists only on another Mac.

## Pairing flow

1. List the current registry:

   ```bash
   lark-channel-bridge-department organization node list
   ```

2. Produce a non-mutating plan:

   ```bash
   lark-channel-bridge-department organization node plan mbp \
     --host mbp-department \
     --capability xiaohongshu_authenticated_browser > mbp-plan.json
   ```

3. Separately create a dedicated SSH identity and configure a restricted forced command. The installer does not edit SSH configuration, copy keys or enable remote access.

4. Register the reviewed plan from the primary node, then activate it after the auxiliary profile and absolute workspace are ready:

   ```bash
   lark-channel-bridge-department organization node register mbp-plan.json \
     --actor-node local_primary \
     --fingerprint SHA256:REVIEWED_FINGERPRINT

   lark-channel-bridge-department organization node activate mbp \
     --actor-node local_primary \
     --profile department-mbp \
     --workspace /absolute/department/workspace
   ```

Copy the plan's `forcedCommand` verbatim into the dedicated key's restricted SSH configuration. It dispatches only the original bridge handoff command for that paired node; it rejects another node, an unknown operation, extra arguments and shell syntax. Do not expose the general bridge CLI as an unrestricted remote shell.

## Handoff behavior

The department's confirmed topology and task execution policy decide whether work stays local or is routed to a capable online node. Identity-bound or publishing operations and high-risk work do not silently fail over. Only low-risk, idempotent work may use an approved fallback.

Handoffs use an append-only ledger with task IDs, progress and receipts. Inputs reject raw commands, secrets, session data and oversized payloads. Auxiliary execution is selected from a fixed operation registry; arbitrary shell commands are not accepted. The primary node reads the receipt and produces the final user-facing synthesis.

Low-level diagnostics are available through `organization handoff-submit`, `organization handoff-status` and the restricted `organization handoff-operation` endpoint. `organization handoff-serve` is only the fixed OpenSSH forced-command dispatcher and must not be invoked as a normal chat command.
