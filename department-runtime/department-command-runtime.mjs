import { classifyDepartmentConfirmation } from "./department-confirmation.mjs";
import { buildDepartmentDesignPrompt } from "./department-design-prompt.mjs";
import { DepartmentDesignStoreError } from "./department-design-store.mjs";
import { assertDepartmentDraft } from "./department-draft-schema.mjs";
import { deriveDepartmentId } from "./department-wizard.mjs";

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

function isExplicitRepeatConfirmation(text) {
  return classifyDepartmentConfirmation({
    phase: "awaiting_final_confirmation",
    text,
  }).action === "confirm";
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
      "新路由已生效；能力问题可按事务回执继续处理，bridge 将在空闲后重启。",
    ].join("\n");
  }
  return [
    `部门已创建并完成能力对账，事务 ${result.transactionId}。`,
    `能力结果：${summary}。`,
    "新路由已生效；若当前 bridge 有任务在运行，将在空闲后重启。",
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
    restartCoordinator = { request: () => {} },
    resolveRestartStatus = () => null,
    log = () => {},
  }) {
    this.designStore = designStore;
    this.isDepartmentAdmin = isDepartmentAdmin;
    this.provisioner = provisioner;
    this.inventoryContext = inventoryContext;
    this.draftCli = draftCli;
    this.storeFile = storeFile;
    this.applyWorkspaceRoute = applyWorkspaceRoute;
    this.restartCoordinator = restartCoordinator;
    this.resolveRestartStatus = resolveRestartStatus;
    this.log = log;
  }

  handleDepartmentCommand(args, context) {
    if (!this.isDepartmentAdmin(context)) {
      safeReply(context, "没有权限创建部门。仅飞书应用 owner 或 bridge 管理员可使用此命令。");
      return true;
    }
    const commandParts = String(args ?? "").trim().split(/\s+/).filter(Boolean);
    const subcommand = commandParts[0]?.toLowerCase() || "help";
    const createName = commandParts.slice(1).join(" ").trim();
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
      const contextInventory = context.currentWorkspace
        ? this.inventoryContext(context)
        : null;
      try {
        const started = this.designStore.start({
          ...metadata(context),
          contextInventory,
        });
        if (createName) {
          this.designStore.update(started.key, {
            phase: "designing",
            draft: { departmentName: createName },
          }, {
            actorId: context.senderId,
            source: "user_explicit",
            reason: "department name supplied in create command",
            changedPaths: ["/draft/departmentName", "/phase"],
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
        createName
          ? `已进入部门创建独占模式，并记录部门名称“${createName}”。其余职责、边界和流程将结合历史上下文给出候选方案供你讨论确认。`
          : "已进入部门创建独占模式。请先告诉我你确定的部门名称；其余职责、边界和流程将结合历史上下文给出候选方案供你讨论确认。",
      );
      return true;
    }

    if (subcommand === "status") {
      const restartStatus = state?.transactionId
        ? this.resolveRestartStatus(state.transactionId)
        : null;
      safeReply(
        context,
        restartStatus ? `${summary(state)}\n重启状态：${restartStatus.status}。` : summary(state),
      );
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

    if (state.status === "completed") {
      if (isAdmin && isExplicitRepeatConfirmation(text)) {
        safeReply(context, "这个部门已经创建完成，不会重复写入。可用 /department status 查看事务状态。");
        return { action: "handled" };
      }
      return { action: "pass" };
    }
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
    return {
      action: "design",
      prompt: buildDepartmentDesignPrompt({
        state: promptState,
        userText: String(context.text ?? ""),
        actor: { id: context.senderId, role: "admin" },
        contextInventory: promptState.contextInventory,
        draftCli: this.draftCli,
        storeFile: this.storeFile,
      }),
      bypassMention: true,
    };
  }

  tryHandleDepartmentWizardReply(context) {
    const result = this.intakeDepartmentMessage(context);
    if (result.action === "pass") return false;
    if (result.action === "handled") return true;
    const state = this.designStore.getFor(context);
    if (state && ACTIVE_DESIGN_STATUSES.has(state.status)) {
      this.designStore.pause(state.key, {
        actorId: "system",
        source: "controller",
        reason: "legacy 0.5 bridge cannot carry guarded AI design prompts",
      });
    }
    safeReply(
      context,
      "当前旧版 0.5 bridge 无法安全承载 AI 部门设计提示，创建流程已暂停且草案已保留。恢复 0.7 部门扩展后可继续。",
    );
    return true;
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
      this.applyWorkspaceRoute(result.workspaceRoute);
      this.designStore.completeProvisioning(state.key, {
        transactionId: result.transactionId,
        receiptPath: result.receiptPath,
      });
      this.restartCoordinator.request({
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
