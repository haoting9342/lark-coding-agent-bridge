# WorkBuddy 部门创建

这套程序让 WorkBuddy 项目拥有与 Codex 版一致的部门设计效果：先与 Agent 自由讨论，草案可以反复修改；只有用户明确确认后，才生成正式章程和规程文件。WorkBuddy 自身负责飞书接入，本工具不创建飞书应用、不配置群路由，也不启动 Bridge。

## 一、安装程序

确认电脑已经安装 Node.js 20 或更高版本，然后执行：

```bash
npm install -g lark-channel-bridge-department
```

## 二、在项目中安装部门设计助手

把下面的路径换成 WorkBuddy 当前项目的绝对路径：

```bash
lark-channel-bridge-department workbuddy department init \
  --workspace "/绝对路径/WorkBuddy项目"
```

初始化只会创建部门设计入口、中文助手 Skill 和草案目录，不会创建正式部门。重复执行不会重复添加入口。

同一个 WorkBuddy 项目中新建会话时不需要额外的“加入部门”命令。只要会话仍打开这个工作区，WorkBuddy 就会从 `CODEBUDDY.md` 加载部门入口，再按任务读取部门章程、命中规程和 `.workbuddy-department/<部门编号>/memory.md`。新会话不会继承上一轮聊天全文，只继承已经确认并写入稳定记忆的内容。

## 三、与 WorkBuddy 自由讨论

打开这个项目后，可以直接对 WorkBuddy 说：“帮我设计一个负责内容生产的部门”。设计助手会逐步与你讨论部门目标、职责、范围外事项、审批边界、常见任务、能力和交付标准，不要求一次填完表格。

讨论中的草案通过下面的命令保存到 `.workbuddy-department/sessions/current.json`。规格可以不完整，此时不会出现正式部门章程：

```bash
lark-channel-bridge-department workbuddy department draft \
  --workspace "/绝对路径/WorkBuddy项目" \
  --spec "/绝对路径/当前草案.json"
```

正式导入还会检查会话记录：至少要有一轮已经保存的部门设计，并且草案中已经讨论过部门名称、主题目标、主要职责和基本工作流程。只在命令行填写名称、工作区和一份一次性规格，不能跳过这段对话。

任务不必全部命中规程，系统允许四种处理方式：

- 直接执行：明确、低风险且不需要固定流程的任务；
- 单规程：只加载一个确实命中的规程；
- 组合规程：任务确实跨越多个稳定流程时，按顺序组合；
- 自由探索：新任务、低频任务或现有规程不适用时先探索。

Skill 也按任务内容选择：通常只加载一个主 Skill，辅助 Skill 只有条件明确命中时才加载。

## 四、确认并正式创建

WorkBuddy 展示最终方案后，只有下面这些完整表达会触发正式创建：

- “同意创建”
- “确认创建”
- “按这个方案创建”
- “确认部门创建”

“可以”“好的”“继续”等表达只表示继续讨论，不会落盘。确认后，设计助手会保存完整规格并执行确认导入命令：

```bash
lark-channel-bridge-department workbuddy department import \
  --workspace "/绝对路径/WorkBuddy项目" \
  --spec "/绝对路径/部门规格.json" \
  --confirm-create \
  --confirmation-message "同意创建"
```

需要手动执行时，可以先修改仓库附带的 `docs/workbuddy-department-example.json`。`--confirm-create` 和 `--confirmation-message` 必须同时提供，而且确认文字只能使用上面列出的完整表达。

## 五、生成的文件

```text
CODEBUDDY.md
.codebuddy/
  skills/
    department-designer/
      SKILL.md
    <部门编号>-department/
      SKILL.md
    <部门编号>-protocol-<规程编号>/
      SKILL.md
.workbuddy-department/
  sessions/
  transactions/
  <部门编号>/
    manifest.json
    department.json
    workflow.json
    memory.md
    skills-plan.md
```

`CODEBUDDY.md` 只保存轻量入口和 Skill 索引，不保存每个规程的完整步骤。CodeBuddy 会自动加载项目 Rules，因此本工具不把规程正文放进 `.codebuddy/rules/`；部门章程和各规程分别保存为 `.codebuddy/skills/<名称>/SKILL.md`，由 WorkBuddy 根据任务意图按需加载。这样每轮对话不需要读取完整 `workflow.json`，也不会自动加载全部规程正文。

## 六、安全与失败回滚

- 工作区必须是已经存在的绝对普通目录，不能是符号链接或危险系统目录；
- 同编号部门、重复索引或冲突文件会被拒绝，不会静默覆盖；
- 已有 `CODEBUDDY.md` 内容会保留，只追加带唯一标记的部门段；
- 初始化、保存草案或正式导入时都会先恢复上次中断事务；任意写入失败会恢复已有文件并删除本次新增的正式部门文件；
- 成功和失败都会在 `.workbuddy-department/transactions/` 留下不含密钥的事务回执；
- 回滚记录不保存原文件正文，只保存原始长度与 SHA-256 摘要；完成、失败或恢复后还会删除这些临时校验信息；
- 进行中的回滚记录会绑定当前工作区，并由项目外的用户私有状态密钥签名；仓库内伪造的回滚 JSON 不能触发文件恢复或删除；
- 正式部门目录是事务提交点：提交前只撤销经过签名且内容哈希完全匹配的本次写入，提交后中断则补齐成功回执，不会删除已提交部门；
- 能力计划只记录期望状态，不会擅自安装需要账号、密钥或授权的能力。

## 七、旧命令兼容

原有 `workbuddy create` 命令仅保留兼容入口，不再接受“名称 + 工作区”直接创建；使用规格文件时也必须先在同一工作区保存设计草案。新用户应使用“初始化、自由讨论、保存草案、明确确认、正式导入”的流程。
