# lark-channel-bridge-department

这是一个自带“部门级组织控制面”的飞书/Lark Bridge。用户从零安装后，可以在群里和 Codex 或 Claude Code 反复讨论部门目标、边界、任务工作协议、能力工具链及可选的多主机拓扑；明确确认最终方案后，系统以事务方式生成部门文件并立即完成群路由。

[English](./README.md)

## 从零安装

需要 Node.js 20.12+、本机已安装并登录的 Codex 或 Claude Code CLI，以及创建或配置飞书/Lark 应用的权限。

从 GitHub Release 安装固定版本包：

```bash
npm install -g https://github.com/haoting9342/lark-coding-agent-bridge/releases/download/department-v0.7.0/lark-channel-bridge-department-0.7.0.tgz
```

然后运行：

```bash
lark-channel-bridge-department run
```

首次运行向导会选择 Agent 和工作区、创建或连接飞书应用、绑定 lark-cli，并初始化一个空组织。需要后台常驻时使用：

```bash
lark-channel-bridge-department start
lark-channel-bridge-department status
```

服务身份与原版 Bridge 完全隔离：

- macOS：`ai.lark-channel-bridge-department.bot.<profile>`
- Linux：`lark-channel-bridge-department.bot.<profile>.service`
- Windows：`LarkChannelBridgeDepartment.Bot.<profile>`

全部状态位于 `~/.lark-channel-department`。安装过程不会读取、迁移、重启或修改现有的 `~/.lark-channel` 部署；安装包也不携带任何已经创建的部门和用户专属路径。

## 在飞书创建部门

在已经允许使用机器人的群里，由飞书应用 owner 或 Bridge 管理员发送：

```text
/cd <工作区绝对路径>
/department create <部门名称>
```

先用 `/cd` 为当前群明确绑定 workspace；未绑定时 `/department create` 不会扫描 profile 默认目录、不会建立草案。绑定成功后群聊才进入部门创建独占讨论。Agent 会安全读取该工作区的相关历史，提出永久部门或项目部门草案，区分“部门业务生命周期”和“Agent 收到某类任务时应执行的工作协议”，并支持逐项同意、否决和修改。到最终确认阶段后，明确回复 `同意` 或 `确认` 才会触发事务写入；新群路由立即生效，不需要重启 Bridge。

流程控制：

```text
/department status
/department pause
/department resume
/department cancel
```

暂停会保留草案并恢复群里的普通 Agent 工作；继续后重新进入创建独占模式。完整规则见[部门创建契约](./docs/department-creation.md)。

## 安装包自带能力

- 基于安全历史上下文的永久/项目部门对话式设计
- 讨论中支持局部同意，最终写入必须明确授权
- 部门注册表、工作区规则覆盖与群路由的事务写入和回滚
- 内置、本地、固定 GitHub 来源的能力安装，以及真实的待授权/待人工状态
- 按用户请求类型定义任务协议、质量检查和完成标准
- 可选的主节点/辅助节点拓扑与受限任务转交
- Codex 托管过程卡片，包括重试、撤回和独立最终消息降级
- Profile 隔离的密钥、会话、工作区、日志和系统服务

多主机不是首次安装的隐式步骤，需要时单独阅读[组织节点说明](./docs/organization-nodes.md)并完成配对。

## 常用命令

```bash
lark-channel-bridge-department organization status
lark-channel-bridge-department organization doctor
lark-channel-bridge-department organization workflow show <department-id>
lark-channel-bridge-department organization workflow apply <department-id>
lark-channel-bridge-department profile list
lark-channel-bridge-department ps
lark-channel-bridge-department --help
```

## Bridge 基础运行约定

每个 Profile 可以作为独立的 per-profile service 运行，也可以由一个 supervisor 托管多个 Profile。`workspaces.default` 是当前 Profile 的默认工作区。访问名单可直接在飞书维护：

```text
/invite user <open_id>
/remove user <open_id>
/invite group <chat_id>
/remove group <chat_id>
/invite all group
```

Profile 的归档和导出都需要显式命令：

```bash
lark-channel-bridge-department profile remove <name>
lark-channel-bridge-department profile remove <name> --purge --yes
lark-channel-bridge-department profile export <name>
lark-channel-bridge-department profile export <name> --include-secrets --yes
```

lark-cli 身份策略按 Profile 隔离。每个 Agent 使用当前 profile 的 lark-cli 目录，一个 Profile 的个人飞书授权不会共享给另一个。Windows 后台服务使用自动生成的 `.cmd` 启动器。

云文档评论按文档权限生效：机器人能否读取和回复由该文档的飞书权限及明确 @ 决定，不套用群聊访问名单。

新配置统一使用 `permissions` 约束 Agent 的默认和最高访问级别：

```json
{
  "permissions": {
    "defaultAccess": "full",
    "maxAccess": "full"
  }
}
```

旧版 `sandbox` 仅为迁移兼容继续可读，新配置不应再使用。

这个发行版是在原 Bridge 基础上构建、拥有独立产品名和状态目录的部门版；原版 Bridge 仍可独立保留。

## 开发验证

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:package
```

许可证：MIT。
