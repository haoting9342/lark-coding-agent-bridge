# 飞书部门架构 Bridge

这套程序把飞书群、Codex 和本地工作区连接成可创建、可维护的部门架构。全新安装后，用户可以在群里用自然语言确定部门名称、工作路径、主题、职责、任务规程和所需能力；最终明确确认后，系统以事务方式创建部门并立即启用群路由。

## 从零安装 Codex 版

准备条件：

- Node.js 20.12 或更高版本；
- 本机已经安装并登录 Codex；
- 拥有创建或配置飞书应用的权限。

安装最新正式版：

```bash
npm install -g https://github.com/haoting9342/lark-coding-agent-bridge/releases/latest/download/lark-channel-bridge-department.tgz
```

检查安装并启动首次配置：

```bash
lark-channel-bridge-department --version
lark-channel-bridge-department run
```

首次向导中选择 Codex，按提示创建或连接飞书应用，并选择初始工作区。向导结束后执行：

```bash
lark-channel-bridge-department organization doctor
```

看到组织状态可用后，即可把机器人加入需要创建部门的飞书群。需要后台运行时使用：

```bash
lark-channel-bridge-department start
lark-channel-bridge-department status
```

所有产品状态独立保存在 `~/.lark-channel-department`，不会读取、迁移或覆盖原有 `~/.lark-channel`。

## Bridge 基础运行约定

每个 profile 可以作为独立后台服务运行，也可以由一个总控进程同时托管多个 profile。`workspaces.default` 是当前 profile 的默认工作区。macOS、Linux 和 Windows 的服务身份相互隔离；Windows 后台服务使用自动生成的 `.cmd` 启动器。

访问名单可以直接在飞书维护：

```text
/invite user <open_id>
/remove user <open_id>
/invite group <chat_id>
/remove group <chat_id>
/invite all group
```

profile 的归档和导出必须使用显式命令：

```bash
lark-channel-bridge-department profile remove <name>
lark-channel-bridge-department profile remove <name> --purge --yes
lark-channel-bridge-department profile export <name>
lark-channel-bridge-department profile export <name> --include-secrets --yes
```

lark-cli 身份策略按 profile 隔离。每个 Agent 使用当前 profile 的 lark-cli 目录，一个 profile 的个人飞书授权不会共享给另一个。

云文档评论按文档权限生效：机器人能否读取和回复，由该文档的飞书权限及明确 @ 决定，不套用群聊访问名单。

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

## 在飞书创建部门

应用所有者或 Bridge 管理员在群里发送：

```text
/department create
```

也可以一次给出名称和绝对工作路径：

```text
/department create 自媒体部 --workspace /absolute/path/to/workspace
```

正确顺序如下：

1. 确认部门名称和工作路径；
2. 确认部门主题、目标和主要工作；
3. 系统根据已确认主题定向扫描工作区，不提前全量读取；
4. 讨论职责、边界、稳定规程和能力计划；
5. 展示最终方案；
6. 管理员明确回复 `同意`、`确认` 或 `同意创建` 后执行事务创建。

不需要先执行 `/cd`。创建期间可以使用：

```text
/department status
/department pause
/department resume
/department cancel
```

创建成功后无需重启 Bridge。必需 Skill 只有真正安装并验证成功后，部门才会完成创建；失败会回滚部门文件、注册表和路由，并保留草案供修订后重试。

## WorkBuddy 本地创建部门

WorkBuddy 已经负责飞书接入时，不需要再部署 Bridge。先在 WorkBuddy 项目安装部门设计助手：

```bash
lark-channel-bridge-department workbuddy department init \
  --workspace "/absolute/path/to/workspace"
```

之后可以直接与 WorkBuddy 自由讨论部门方案。助手通过 `workbuddy department draft` 保存未完成草案；只有用户明确回复“同意创建”等确认语句后，才会调用同时带 `--confirm-create` 和 `--confirmation-message` 的导入命令，生成 `CODEBUDDY.md`、部门章程 Skill 和按需规程 Skill。规格字段与 Codex 版共用，不修改飞书配置、群路由或 Bridge 状态。详见[WorkBuddy 部门创建说明](./docs/workbuddy-department.md)。

## 任务执行方式

每条消息先判断为以下一种模式：

- 直接执行：明确、低风险且无需固定规程；
- 单规程：只读取唯一命中的任务规程；
- 组合规程：只读取确实命中的多个规程；
- 自由探索：新任务或不确定任务先探索，不强制命中规程。

`AGENTS.md` 只保存精简规程索引，不展开全部步骤。命中规程后使用以下命令只提取一个规程：

```bash
lark-channel-bridge-department organization workflow protocol <部门编号> <规程编号>
```

每个规程最多指定一个主 Skill；辅助 Skill 只有在明确条件成立时才加载。完整工作流只在维护部门长期默认规则时读取：

```bash
lark-channel-bridge-department organization workflow show <部门编号>
lark-channel-bridge-department organization workflow apply <部门编号>
```

## 常用检查

```bash
lark-channel-bridge-department organization status
lark-channel-bridge-department organization doctor
lark-channel-bridge-department profile list
lark-channel-bridge-department ps
lark-channel-bridge-department --help
```

更完整的创建、确认、回滚和能力规则见[部门创建说明](./docs/department-creation.md)。多主机不是首次安装的默认步骤，需要时再阅读[组织节点说明](./docs/organization-nodes.md)。

## 本地开发验证

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm audit --prod
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:package
```

许可证：MIT。
