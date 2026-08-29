import { classifyDepartmentConfirmation } from "./department-confirmation.mjs";
import { buildDepartmentDesignPrompt } from "./department-design-prompt.mjs";
import { DepartmentDesignStoreError } from "./department-design-store.mjs";
import { assertDepartmentDraft } from "./department-draft-schema.mjs";
import { deriveDepartmentId } from "./department-id.mjs";
import path from "node:path";

const DEPARTMENT_COMMAND = /^\/department(?:\s|$)/i;
const NATURAL_PAUSE = new Set(["暂停创建部门", "暂停部门创建"]);
const NATURAL_RESUME = new Set(["继续创建部门", "继续部门创建"]);
const NATURAL_CANCEL = new Set(["取消创建部门", "取消部门创建"]);
const ACTIVE_DESIGN_STATUSES = new Set(["active", "needs_revision"]);

function safeReply(context, text) {
  context.reply(String(text).replace(/ou_[A-Za-z0-9_-]+/g, "[已隐藏]"));
}

function metadata(context) {
  return {
    profile: context.profile,
    host: context.host,
    botName: context.botName,
    chatId: context.chatId,
    senderId: context.senderId,
    groupName: context.groupName,
    currentWorkspace: context.currentWorkspace ?? null,
  };
}

function isGroup(context) {
  return context.chatType === "group" || context.chatType === "group_chat";
}

function parseCreateArguments(parts) {
  const nameParts = [];
  let workspace = null;
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index] === "--workspace") {
      workspace = parts[index + 1] ?? null;
      index += 1;
    } else {
      nameParts.push(parts[index]);
    }
  }
  return { name: nameParts.join(" ").trim(), workspace };
}

function hasConfirmedTheme(draft) {
  return typeof draft?.purpose === "string"
    && draft.purpose.trim().length > 0
    && Array.isArray(draft.responsibilities)
    && draft.responsibilities.length > 0;
}

function contextQueryForDraft(draft) {
  return {
    purpose: draft.purpose,
    responsibilities: [...draft.responsibilities],
  };
}

function inventoryMatchesDraft(inventory, draft) {
  if (!inventory || typeof draft?.workspace !== "string" || !hasConfirmedTheme(draft)) return false;
  const inventoryWorkspace = inventory.requestedWorkspace ?? inventory.workspace;
  if (typeof inventoryWorkspace !== "string"
    || path.resolve(inventoryWorkspace) !== path.resolve(draft.workspace)) return false;
  return JSON.stringify(inventory.contextQuery ?? null) === JSON.stringify(contextQueryForDraft(draft));
}

function summary(state) {
  if (!state) return "当前没有活动的部门创建流程。";
  const kind = state.draft?.kind ?? "待判断";
  const name = state.draft?.departmentName ?? "待填写";
  const questions = Array.isArray(state.draft?.openQuestions)
    ? state.draft.openQuestions.length
    : state.openQuestions.length;
  return [
    `部门创建状态：${state.status} / ${state.phase}`,
    `部门：${name}（${kind}）`,
    `草案版本：${state.version}；待确认项：${questions}`,
  ].join("\n");
}

function capabilityReply(result) {
  const counts = result.capabilitySummary ?? {};
  const summary = [
    `已存在 ${counts.available ?? 0}`,
    `已安装 ${counts.installed ?? 0}`,
    `待授权 ${counts.pending_authorization ?? 0}`,
    `待人工 ${counts.pending_manual ?? 0}`,
    `冲突 ${counts.conflict ?? 0}`,
    `失败 ${counts.failed ?? 0}`,
  ].join("；");
  const unresolved = (result.capabilityMaterialization?.capabilities ?? [])
    .filter((capability) => capability.required === true && !["available", "installed"].includes(capability.status))
    .map((capability) => capability.id)
    .slice(0, 12);
  if (result.readiness === "created_with_pending_capabilities") {
    return [
      `部门已创建，但能力未完全就绪，事务 ${result.transactionId}。`,
      `能力结果：${summary}。`,
      ...(unresolved.length ? [`暂不可用的必需能力：${unresolved.join("、")}。`] : []),
      "新路由已生效且无需重启 bridge；能力问题可按事务回执继续处理。",
    ].join("\n");
  }
  return [
    `部门已创建并完成能力对账，事务 ${result.transactionId}。`,
    `能力结果：${summary}。`,
    "新路由已生效，无需重启 bridge。",
  ].join("\n");
}

export class DepartmentCommandRuntime {
  constructor({
    designStore,
    isDepartmentAdmin,
    provisioner,
    inventoryContext = () => null,
    draftCli,
    storeFile,
    applyWorkspaceRoute = () => {},
    log = () => {},
  }) {
    this.designStore = designStore;
    this.isDepartmentAdmin = isDepartmentAdmin;
    this.provisioner = provisioner;
    this.inventoryContext = inventoryContext;
    this.draftCli = draftCli;
    this.storeFile = storeFile;
    this.applyWorkspaceRoute = applyWorkspaceRoute;
    this.log = log;
  }

  handleDepartmentCommand(args, context) {
    if (!this.isDepartmentAdmin(context)) {
      safeReply(context, "没有权限创建部门。仅飞书应用 owner 或 bridge 管理员可使用此命令。");
      return true;
    }
    const commandParts = String(args ?? "").trim().split(/\s+/).filter(Boolean);
    const subcommand = commandParts[0]?.toLowerCase() || "help";
    const create = parseCreateArguments(commandParts.slice(1));
    const createName = create.name;
    const state = this.designStore.getFor(context);

    if (["create", "status", "pause", "resume", "cancel"].includes(subcommand) && !isGroup(context)) {
      safeReply(context, "部门创建只能在群聊中使用。");
      return true;
    }

    if (subcommand === "create") {
      if (state && !["cancelled"].includes(state.status)) {
        safeReply(context, `${summary(state)}\n当前群已有部门创建记录；请继续、暂停或查看状态。`);
        return true;
      }
      try {
        const started = this.designStore.start({
          ...metadata(context),
          currentWorkspace: create.workspace ?? context.currentWorkspace ?? null,
          contextInventory: null,
        });
        if (createName || create.workspace) {
          this.designStore.update(started.key, {
            phase: "designing",
            draft: {
              ...(createName ? { departmentName: createName } : {}),
              ...(create.workspace ? { workspace: create.workspace } : {}),
            },
          }, {
            actorId: context.senderId,
            source: "user_explicit",
            reason: "department identity supplied in create command",
            changedPaths: [
              ...(createName ? ["/draft/departmentName"] : []),
              ...(create.workspace ? ["/draft/workspace"] : []),
              "/phase",
            ],
          });
        }
      } catch (error) {
        if (error instanceof DepartmentDesignStoreError && error.code === "EXISTING_DESIGN") {
          safeReply(context, "当前群已有一个部门创建流程正在进行。");
          return true;
        }
        throw error;
      }
      safeReply(
        context,
        createName && create.workspace
          ? `已记录部门名称“${createName}”和工作路径。请先说明部门的大致主题、目标和主要工作；确认后才会针对性扫描工作区。`
          : "已进入部门创建模式。请先提供部门名称和工作路径，再说明部门的大致主题、目标和主要工作；确认前不会扫描工作区。",
      );
      return true;
    }

    if (subcommand === "status") {
      safeReply(context, summary(state));
      return true;
    }

    if (subcommand === "pause") {
      if (!state) safeReply(context, summary(null));
      else if (state.status === "paused") safeReply(context, `${summary(state)}\n已经暂停。`);
      else {
        this.designStore.pause(state.key, { actorId: context.senderId, reason: "command pause" });
        safeReply(context, "部门创建已暂停，草案已保留；当前群恢复普通 Codex 工作。可用 /department resume 继续。");
      }
      return true;
    }

    if (subcommand === "resume") {
      if (!state) safeReply(context, summary(null));
      else if (state.status !== "paused") safeReply(context, `${summary(state)}\n当前无需恢复。`);
      else {
        const resumed = this.designStore.resume(state.key, {
          actorId: context.senderId,
          reason: "command resume",
        });
        safeReply(context, `部门创建已继续并重新进入独占模式。\n${summary(resumed)}`);
      }
      return true;
    }

    if (subcommand === "cancel") {
      if (!state) safeReply(context, summary(null));
      else {
        try {
          this.designStore.cancel(state.key, {
            actorId: context.senderId,
            reason: "command cancel",
          });
          safeReply(context, "部门创建已取消，草案记录保留用于审计。当前群恢复普通 Codex 工作。");
        } catch (error) {
          if (error instanceof DepartmentDesignStoreError && error.code === "PROVISIONING_STARTED") {
            safeReply(context, "部门配置已开始写入，不能取消；请使用 /department status 查询结果。");
          } else throw error;
        }
      }
      return true;
    }

    safeReply(
      context,
      "用法：/department create、/department status、/department pause、/department resume、/department cancel",
    );
    return true;
  }

  intakeDepartmentMessage(context) {
    const text = String(context.text ?? "").trim();
    if (DEPARTMENT_COMMAND.test(text)) return { action: "pass" };
    const state = this.designStore.getFor(context);
    if (!state) return { action: "pass" };
    const isAdmin = this.isDepartmentAdmin(context);

    if (state.status === "completed") return { action: "pass" };
    if (state.status === "provisioning") {
      safeReply(context, "部门配置正在事务写入中，请稍后使用 /department status 查询结果。");
      return { action: "handled" };
    }
    if (state.status === "cancelled") return { action: "pass" };

    if (state.status === "paused") {
      if (isAdmin && NATURAL_RESUME.has(text)) {
        const resumed = this.designStore.resume(state.key, {
          actorId: context.senderId,
          reason: "natural language resume",
        });
        safeReply(context, `部门创建已继续并重新进入独占模式。\n${summary(resumed)}`);
        return { action: "handled" };
      }
      return { action: "pass" };
    }

    if (!ACTIVE_DESIGN_STATUSES.has(state.status)) return { action: "pass" };
    if (!isAdmin) {
      const messages = [...(state.pendingParticipantMessages ?? []), {
        senderId: context.senderId,
        messageId: context.messageId ?? null,
        text: String(context.text ?? "").slice(0, 4_000),
        at: Date.now(),
      }].slice(-50);
      this.designStore.update(state.key, { pendingParticipantMessages: messages }, {
        actorId: context.senderId,
        source: "participant_proposal",
        reason: "participant suggestion recorded for admin review",
        changedPaths: ["/pendingParticipantMessages"],
      });
      safeReply(context, "你的建议已记录，等待部门创建管理员讨论；普通成员不能修改或最终确认部门配置。");
      return { action: "handled" };
    }

    if (NATURAL_PAUSE.has(text)) {
      this.designStore.pause(state.key, {
        actorId: context.senderId,
        reason: "natural language pause",
      });
      safeReply(context, "部门创建已暂停，草案已保留；当前群恢复普通 Codex 工作。说“继续创建部门”可恢复。");
      return { action: "handled" };
    }
    if (NATURAL_CANCEL.has(text)) {
      this.designStore.cancel(state.key, {
        actorId: context.senderId,
        reason: "natural language cancel",
      });
      safeReply(context, "部门创建已取消，草案记录保留用于审计。当前群恢复普通 Codex 工作。");
      return { action: "handled" };
    }

    const confirmation = classifyDepartmentConfirmation({ phase: state.phase, text });
    if (confirmation.action === "confirm") {
      this.#provision(state, context, text);
      return { action: "handled" };
    }

    let promptState = state;
    if (confirmation.action === "revise" && state.phase === "awaiting_final_confirmation") {
      promptState = this.designStore.update(state.key, {
        status: "needs_revision",
        phase: "designing",
      }, {
        actorId: context.senderId,
        source: "user_explicit",
        reason: "final proposal revision requested",
        changedPaths: ["/status", "/phase"],
      });
    }
    let contextInventoryError = null;
    if (promptState.draft?.workspace
      && hasConfirmedTheme(promptState.draft)
      && !inventoryMatchesDraft(promptState.contextInventory, promptState.draft)) {
      try {
        const contextInventory = this.inventoryContext({
          ...context,
          currentWorkspace: promptState.draft.workspace,
          contextQuery: contextQueryForDraft(promptState.draft),
        });
        promptState = this.designStore.update(promptState.key, { contextInventory }, {
          actorId: "system",
          source: "controller",
          reason: "targeted workspace inventory after theme confirmation",
          changedPaths: ["/contextInventory"],
        });
      } catch (error) {
        contextInventoryError = String(error?.message ?? error)
          .replace(/[\r\n\u2028\u2029]+/g, " ")
          .slice(0, 500);
        this.log({
          event: "department_context_inventory_failed",
          chatId: context.chatId,
          error: error?.message ?? String(error),
        });
      }
    }
    return {
      action: "design",
      prompt: buildDepartmentDesignPrompt({
        state: promptState,
        userText: String(context.text ?? ""),
        actor: { id: context.senderId, role: "admin" },
        contextInventory: promptState.contextInventory,
        contextInventoryError,
        draftCli: this.draftCli,
        storeFile: this.storeFile,
      }),
      bypassMention: true,
    };
  }

  #provision(state, context, confirmationText) {
    let draft;
    try {
      draft = assertDepartmentDraft(state.draft, { requireReady: true });
    } catch (error) {
      this.designStore.update(state.key, {
        status: "needs_revision",
        phase: "designing",
      }, {
        actorId: "system",
        source: "controller",
        reason: "final draft validation failed",
        changedPaths: ["/status", "/phase"],
      });
      safeReply(context, `最终草案仍有校验问题，尚未创建：${error.message}`);
      return;
    }

    this.designStore.beginProvisioning(state.key, {
      actorId: context.senderId,
      confirmationText,
    });
    try {
      const result = this.provisioner.provision({
        departmentId: deriveDepartmentId(draft.workspace, draft.departmentName, state.chatId),
        departmentName: draft.departmentName,
        groupName: state.groupName,
        chatId: state.chatId,
        senderId: context.senderId,
        host: state.host,
        profile: state.profile,
        workspace: draft.workspace,
        description: draft.purpose,
        responsibilities: draft.responsibilities,
        approvalBoundaries: draft.approvalBoundaries,
        draft,
        contextInventory: state.contextInventory,
      });
      if (result.workspaceRouteApplied !== true) this.applyWorkspaceRoute(result.workspaceRoute);
      this.designStore.completeProvisioning(state.key, {
        transactionId: result.transactionId,
        receiptPath: result.receiptPath,
      });
      safeReply(
        context,
        capabilityReply(result),
      );
    } catch (error) {
      this.designStore.failProvisioning(state.key, {
        transactionId: error.transactionId,
        failedStage: error.stage,
        errorMessage: error.message,
      });
      this.log({ event: "department_provision_failed", stage: error.stage, error: error.message });
      safeReply(
        context,
        `部门创建失败，阶段：${error.stage ?? "provisioning"}，事务：${error.transactionId ?? "未生成"}。草案已保留，可修订后重新明确确认。`,
      );
    }
  }
}

export function handleDepartmentCommand(args, bridgeContext) {
  return bridgeContext.departmentRuntime.handleDepartmentCommand(args, bridgeContext);
}

export function intakeDepartmentMessage(bridgeContext) {
  return bridgeContext.departmentRuntime.intakeDepartmentMessage(bridgeContext);
}
