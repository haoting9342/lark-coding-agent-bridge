# lark-channel-bridge-department

A Feishu/Lark bridge that gives a fresh Codex or Claude Code installation a conversational department control plane. Users can discuss a department's purpose, boundaries, task protocols, capabilities and optional multi-host topology in a group, explicitly approve the final proposal, and receive an atomic, immediately routed department package.

[中文说明](./README.zh.md)

## Install from zero

Requirements: Node.js 20.12+, a locally installed and authenticated Codex or Claude Code CLI, and permission to create or configure a Feishu/Lark app.

Install the release artifact from GitHub:

```bash
npm install -g https://github.com/haoting9342/lark-coding-agent-bridge/releases/download/department-v0.7.0/lark-channel-bridge-department-0.7.0.tgz
```

Then run:

```bash
lark-channel-bridge-department run
```

The first-run wizard selects the agent and workspace, creates or connects the Feishu app, binds lark-cli and initializes an empty organization. For a background service use:

```bash
lark-channel-bridge-department start
lark-channel-bridge-department status
```

Service identities are isolated from the upstream bridge:

- macOS: `ai.lark-channel-bridge-department.bot.<profile>`
- Linux: `lark-channel-bridge-department.bot.<profile>.service`
- Windows: `LarkChannelBridgeDepartment.Bot.<profile>`

All product state is isolated under `~/.lark-channel-department`. Installation does not read, migrate, restart or modify an existing `~/.lark-channel` deployment, and the package contains no prebuilt departments or user-specific paths.

## Create a department in Feishu

In an allowed group, the app owner or bridge administrator sends:

```text
/department create <department name>
```

The group enters a department-design-only conversation. The agent safely inspects relevant workspace history, proposes either a permanent or project department, separates business lifecycle from request-specific agent protocols, and works through partial approvals, objections and amendments. At the final-confirmation phase, explicit `同意` or `确认` triggers atomic provisioning. The new group route works without a bridge restart.

Controls:

```text
/department status
/department pause
/department resume
/department cancel
```

See [the department creation contract](./docs/department-creation.md) for the exact discussion, confirmation, rollback and capability rules.

## Included capabilities

- Conversational permanent/project department design informed by safe historical context
- Explicit final authorization with partial agreement during discussion
- Transactional registry, workspace overlay and group route updates
- Built-in, local and fixed-GitHub capability materialization with truthful pending states
- Request-specific task protocols, quality checks and completion criteria
- Optional primary/auxiliary node topology with restricted task handoff
- Managed Codex process cards with retry, recall and separate final-message fallback
- Profile-isolated secrets, sessions, workspaces, logs and OS services

Multi-host setup is deliberately separate from clean install. Read [organization nodes](./docs/organization-nodes.md) before pairing an auxiliary machine.

## Useful commands

```bash
lark-channel-bridge-department organization status
lark-channel-bridge-department organization doctor
lark-channel-bridge-department profile list
lark-channel-bridge-department ps
lark-channel-bridge-department --help
```

## Base bridge operations

Each profile can run as a per-profile service, or several profiles can share the supervisor. `workspaces.default` is the profile's fallback working directory. Access lists can be maintained from Feishu without editing JSON directly:

```text
/invite user <open_id>
/remove user <open_id>
/invite group <chat_id>
/remove group <chat_id>
/invite all group
```

Profiles can be archived or exported explicitly:

```bash
lark-channel-bridge-department profile remove <name>
lark-channel-bridge-department profile remove <name> --purge --yes
lark-channel-bridge-department profile export <name>
lark-channel-bridge-department profile export <name> --include-secrets --yes
```

The lark-cli identity policy is profile-isolated. Every profile uses a profile-local lark-cli directory, so one profile's personal Feishu authorization is not shared with another. Windows service helpers use a generated `.cmd` launcher.

Cloud-doc comments are document-scoped: whether the bot may read and reply follows that document's Feishu permissions and an explicit mention, not the group access list.

Canonical agent access limits use `permissions` in the profile configuration:

```json
{
  "permissions": {
    "defaultAccess": "full",
    "maxAccess": "full"
  }
}
```

The legacy `sandbox` form remains readable for migration but should not be used in new configuration.

The original bridge remains available upstream; this distribution is the independently named department product built from that bridge foundation.

## Development

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:package
```

License: MIT.
