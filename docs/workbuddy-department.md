# WorkBuddy 部门创建

WorkBuddy 版本只负责把部门规则写入本地工作区，不创建飞书应用、不写群路由，也不启动 Bridge。WorkBuddy 本身负责飞书接入时，使用下面命令即可完成一次本地部门初始化。

## 安装

```bash
npm install -g lark-channel-bridge-department
```

## 最小创建

```bash
lark-channel-bridge-department workbuddy create \
  --workspace "/绝对路径/工作区" \
  --name "自媒体部门" \
  --purpose "负责内容策划、制作、发布和复盘" \
  --responsibility "制定选题与内容计划" \
  --responsibility "完成发布前质量检查"
```

也可以把完整部门规格放在 JSON 文件中：

```bash
lark-channel-bridge-department workbuddy create --spec ./部门规格.json
```

规格文件沿用部门草案字段，支持 `taskProtocols`、`contextPolicy`、`skillPolicy`、`capabilityPlan`、审批边界和自由探索模式。这样 WorkBuddy 与 Codex 版本共享同一套任务规则，不需要复制两份流程定义。

## 生成内容

命令会在工作区生成：

- `.workbuddy-department/<部门编号>/department.json`：部门基本信息；
- `.workbuddy-department/<部门编号>/workflow.json`：任务模式、规程和能力计划；
- `.workbuddy-department/<部门编号>/AGENTS.md`：部门包内的完整规则；
- `.workbuddy-department/<部门编号>/memory.md` 和 `skills-plan.md`；
- 工作区根目录 `AGENTS.md`：带标记的部门规则覆盖段。

每次任务先判断直接执行、命中规程、组合规程或自由探索。只有命中的规程才需要提取，新的任务不必强行创建规程。WorkBuddy 侧应把 `.workbuddy-department/<部门编号>/workflow.json` 作为权威流程文件，并按需读取其中单个 `taskProtocols` 条目。

## 安全行为

- 工作区必须是已存在的绝对路径，且不能是符号链接；
- 已存在同编号部门或重复的工作区规则会拒绝写入；
- 写入失败会删除本次新建的部门包；
- 不会修改飞书配置、群路由、用户授权或 Bridge 状态。
