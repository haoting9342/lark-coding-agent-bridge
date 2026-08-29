# WorkBuddy 桌面版部门创建设计实施计划

> **给执行 Agent：** 按任务逐项执行本计划，并使用测试驱动和完成前验证流程。步骤使用复选框（`- [ ]`）记录状态。

**目标：** 在腾讯云代码助手 WorkBuddy 工作区实现与 Codex 一致的部门自由设计、明确确认、章程持久化和按需规程加载流程。

**架构：** 继续复用 `department-runtime` 的草案校验、规程模型和能力计划，不复制业务规则。新增 WorkBuddy 适配层，把已确认草案转换为 `CODEBUDDY.md`、`.codebuddy/skills/`、内部清单和 `.workbuddy-department/` 状态文件；新增本地会话状态机保存设计草案，并在明确创建确认后调用事务写入器。

**技术栈：** Node.js 20、TypeScript、ESM、Vitest、Commander、现有 `department-runtime` JavaScript 模块。

---

### Task 1: 建立 WorkBuddy 文件布局转换器

**Files:**
- Create: `department-runtime/workbuddy-package-writer.mjs`
- Test: `tests/unit/department/workbuddy-package-writer.test.mjs`

- [ ] **Step 1: 写失败测试**

覆盖以下断言：输入合法部门草案后，转换器生成 `CODEBUDDY.md` 索引、一个部门章程 Skill、每个规程一个独立 Skill、`manifest.json`、`department.json`、`workflow.json`、`memory.md`、`skills-plan.md`；规程索引只包含名称、编号和描述，不包含步骤正文；每个 `SKILL.md` 头部包含 `name` 和 `description`。

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm exec vitest run tests/unit/department/workbuddy-package-writer.test.mjs`

预期：因转换器尚未导出而失败。

- [ ] **Step 3: 实现最小转换器**

导出 `buildWorkBuddyPackage({ departmentId, draft, workspace, confirmedAt })`，返回 `Map<string,string>`。文件命名固定为：

```text
CODEBUDDY.md
.codebuddy/skills/<departmentId>-department/SKILL.md
.codebuddy/skills/<departmentId>-protocol-<protocolId>/SKILL.md
.workbuddy-department/<departmentId>/manifest.json
.workbuddy-department/<departmentId>/department.json
.workbuddy-department/<departmentId>/workflow.json
.workbuddy-department/<departmentId>/memory.md
.workbuddy-department/<departmentId>/skills-plan.md
```

Manifest 使用 `manifestVersion: "1.0"`、`system_prompt_file` 或 `system_prompt`、`rules`、`skills`、`workspaces` 字段；不得写入 `chatId`、飞书路由或密钥。

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm exec vitest run tests/unit/department/workbuddy-package-writer.test.mjs`

预期：全部通过。

- [ ] **Step 5: 提交**

```bash
git add department-runtime/workbuddy-package-writer.mjs tests/unit/department/workbuddy-package-writer.test.mjs
git commit -m "feat(workbuddy): add package layout writer"
```

### Task 2: 建立 WorkBuddy 规程提取和会话草案状态机

**Files:**
- Create: `department-runtime/workbuddy-design-session.mjs`
- Test: `tests/unit/department/workbuddy-design-session.test.mjs`

- [ ] **Step 1: 写失败测试**

测试 `start()` 返回 `designing` 状态；`applyProposal()` 只更新草案快照；`requestConfirmation()` 返回 `awaiting_confirmation`；普通“好的”“可以”“同意”不返回创建确认；“同意创建”“确认创建”“按这个方案创建”返回 `confirmed`；确认后重复确认返回幂等结果。

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm exec vitest run tests/unit/department/workbuddy-design-session.test.mjs`

预期：模块不存在导致失败。

- [ ] **Step 3: 实现状态机**

导出 `WorkBuddyDesignSession`，状态只允许 `designing`、`awaiting_confirmation`、`confirmed`、`failed`。使用现有 `assertDepartmentDraft` 校验草案；每次更新记录 `revision`、`changedPaths`、`source` 和最小错误信息。确认关键词必须是完整语义匹配，不能用包含“同意”或“可以”的模糊匹配。

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm exec vitest run tests/unit/department/workbuddy-design-session.test.mjs`

预期：全部通过。

- [ ] **Step 5: 提交**

```bash
git add department-runtime/workbuddy-design-session.mjs tests/unit/department/workbuddy-design-session.test.mjs
git commit -m "feat(workbuddy): add conversational design session"
```

### Task 3: 实现 WorkBuddy 事务写入器

**Files:**
- Create: `department-runtime/workbuddy-provisioner.mjs`
- Test: `tests/unit/department/workbuddy-provisioner.test.mjs`

- [ ] **Step 1: 写失败测试**

测试合法草案会创建全部文件；重复部门编号会拒绝；工作区 `CODEBUDDY.md` 已有相同标记会拒绝；任意文件写入失败会删除新建的 `.workbuddy-department/<id>` 和规则文件，并保留 `transactions/<id>.json` 错误回执；已有 `CODEBUDDY.md` 原内容保持不变。

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm exec vitest run tests/unit/department/workbuddy-provisioner.test.mjs`

预期：模块不存在导致失败。

- [ ] **Step 3: 实现事务写入器**

导出 `WorkBuddyProvisioner({ now, writer })` 和 `provision({ workspace, departmentId, draft })`。使用临时目录和原子替换；规则段使用唯一标记；写入前验证工作区为绝对普通目录，拒绝符号链接和工作区根目录；能力计划仅写入状态，不执行需要凭据或授权的安装。

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm exec vitest run tests/unit/department/workbuddy-provisioner.test.mjs`

预期：全部通过。

- [ ] **Step 5: 提交**

```bash
git add department-runtime/workbuddy-provisioner.mjs tests/unit/department/workbuddy-provisioner.test.mjs
git commit -m "feat(workbuddy): add transactional department provisioning"
```

### Task 4: 接入 WorkBuddy CLI 和一次性初始化命令

**Files:**
- Create: `src/cli/commands/workbuddy-department.ts`
- Modify: `src/cli/index.ts`
- Modify: `package.json`
- Test: `tests/unit/cli/workbuddy-department.test.ts`

- [ ] **Step 1: 写失败测试**

测试 CLI 注册 `workbuddy department init` 和 `workbuddy department import`；`init` 在指定工作区生成部门设计助手规则但不生成正式部门；`import` 读取 JSON 草案并要求 `--confirm-create` 才正式写入；缺少确认时返回非零错误且不落盘。

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm exec vitest run tests/unit/cli/workbuddy-department.test.ts`

预期：命令不存在或行为不符合测试。

- [ ] **Step 3: 实现 CLI**

新增命令：

```text
lark-channel-bridge-department workbuddy department init --workspace <绝对路径>
lark-channel-bridge-department workbuddy department import --workspace <绝对路径> --spec <规格文件> --confirm-create --confirmation-message "同意创建"
```

`init` 只写 `.codebuddy/skills/department-designer/SKILL.md`、创建或更新 `CODEBUDDY.md` 的入口索引和 `.workbuddy-department/sessions/`；设计助手 Skill 中明确允许自由讨论，并要求最终确认后调用本地导入命令。`import` 使用共享草案校验和事务写入器。

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm exec vitest run tests/unit/cli/workbuddy-department.test.ts && pnpm typecheck`

预期：测试和类型检查通过。

- [ ] **Step 5: 提交**

```bash
git add src/cli/commands/workbuddy-department.ts src/cli/index.ts package.json tests/unit/cli/workbuddy-department.test.ts
git commit -m "feat(workbuddy): expose conversational department setup CLI"
```

### Task 5: 补齐文档和 WorkBuddy 交互规则

**Files:**
- Modify: `docs/workbuddy-department.md`
- Modify: `README.md`
- Create: `docs/workbuddy-department-example.json`
- Test: `tests/unit/docs/workbuddy-contract.test.ts`

- [ ] **Step 1: 写失败测试**

测试文档包含桌面版真实目录、`init`/`import` 命令、自由对话阶段、明确确认关键词、四种任务模式、按需规程加载和失败回滚说明；示例规格可通过共享校验器。

- [ ] **Step 2: 运行测试确认失败**

运行：`pnpm exec vitest run tests/unit/docs/workbuddy-contract.test.ts`

预期：缺少命令或示例规格导致失败。

- [ ] **Step 3: 更新中文文档**

所有面向用户的说明使用中文；代码字段保留官方英文名称。明确说明 WorkBuddy 负责渠道接入，本工具只初始化工作区规则和部门文件，不创建飞书应用。

- [ ] **Step 4: 运行测试确认通过**

运行：`pnpm exec vitest run tests/unit/docs/workbuddy-contract.test.ts tests/unit/docs/readme-contract.test.ts`

预期：全部通过。

- [ ] **Step 5: 提交**

```bash
git add docs/workbuddy-department.md docs/workbuddy-department-example.json README.md tests/unit/docs/workbuddy-contract.test.ts
git commit -m "docs(workbuddy): document conversational department setup"
```

### Task 6: 完整验证和发布前检查

**Files:**
- Modify: `tests/packaging/clean-install.test.mjs`
- Modify: `tests/static/contracts.test.ts`

- [ ] **Step 1: 扩展打包测试**

在干净安装测试中执行打包后的 `workbuddy department init` 和 `import --confirm-create`，断言 `.codebuddy` 和 `.workbuddy-department` 文件存在，且生成包不含飞书路由字段。

- [ ] **Step 2: 运行完整验证**

```bash
git diff --check
pnpm test
pnpm typecheck
pnpm build
pnpm install --frozen-lockfile
pnpm audit --prod --json
```

预期：所有测试通过，生产依赖漏洞数为 0，构建成功。

- [ ] **Step 3: 运行真实临时工作区验收**

```bash
WB_WORKSPACE="$(mktemp -d)"
node dist/cli.js workbuddy department init --workspace "$WB_WORKSPACE"
node dist/cli.js workbuddy department import --workspace "$WB_WORKSPACE" --spec docs/workbuddy-department-example.json --confirm-create --confirmation-message "同意创建"
find "$WB_WORKSPACE/.codebuddy" "$WB_WORKSPACE/.workbuddy-department" -type f -print
```

预期：助手规则和正式部门包均生成，`CODEBUDDY.md` 可读，规程文件按单个协议拆分。

- [ ] **Step 4: 提交验证调整**

```bash
git add tests/packaging/clean-install.test.mjs tests/static/contracts.test.ts
git commit -m "test(workbuddy): verify packaged department workflow"
```

- [ ] **Step 5: 推送并记录结果**

```bash
git push origin main
```

最终报告必须列出提交号、测试结果、生成的 WorkBuddy 文件布局，以及明确未实现的 WorkBuddy 云端发布/API 自动化范围。
