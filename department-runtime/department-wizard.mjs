import path from "node:path";

export const WIZARD_STEPS = [
  "department_name",
  "workspace",
  "responsibilities",
  "approval_boundaries",
  "review",
];

export const DEFAULT_APPROVAL_BOUNDARIES = [
  "生产部署和生产数据变更",
  "对外发布或发送",
  "凭证、密钥和权限变更",
  "删除、覆盖或不可逆操作",
];

const STEP_PROMPTS = {
  department_name: "请发送部门中文名称。",
  workspace: "请发送现有工作区的绝对路径，不要迁移文件。",
  responsibilities: "请发送部门主要职责，可用分号分隔多项。",
  approval_boundaries:
    "请发送审批边界；回复“默认”使用四类默认边界，也可用分号自定义。",
  review: "请核对摘要；回复“确认创建”开始创建，或回复“取消”。",
};

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function splitItems(text) {
  return text
    .split(/[\n;,；，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanDepartmentName(text) {
  return text.trim().replace(/\s+/g, " ");
}

export function deriveDepartmentId(workspace, _name, chatId) {
  const basename = path.basename(workspace.replace(/\/+$/, ""));
  const safeBasename = basename
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (/^[a-z][a-z0-9_]*$/.test(safeBasename)) return safeBasename;
  const suffix = String(chatId).replace(/^oc_/, "").slice(-12).toLowerCase();
  return `dept_${suffix.replace(/[^a-z0-9]+/g, "") || "new"}`;
}

export function startWizard(metadata) {
  const timestamp = metadata.now ?? Date.now();
  return {
    schemaVersion: 1,
    key: `${metadata.profile}|${metadata.chatId}|${metadata.senderId}`,
    profile: metadata.profile,
    host: metadata.host,
    botName: metadata.botName ?? null,
    chatId: metadata.chatId,
    senderId: metadata.senderId,
    groupName: metadata.groupName ?? null,
    status: "collecting",
    step: "department_name",
    departmentName: null,
    workspace: null,
    responsibilities: [],
    approvalBoundaries: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: timestamp + 30 * 60 * 1000,
  };
}

function reviewSummary(state) {
  const departmentId = deriveDepartmentId(
    state.workspace,
    state.departmentName,
    state.chatId,
  );
  return [
    "部门创建摘要：",
    `- 部门：${state.departmentName}`,
    `- 部门 ID：${departmentId}`,
    `- 工作区：${state.workspace}`,
    `- 职责：${state.responsibilities.join("、")}`,
    `- 审批边界：${state.approvalBoundaries.join("、")}`,
    `- 主机：${state.host} / ${state.profile}`,
    "原有 AGENTS.md、历史会话和工作区文件不会迁移或覆盖。",
    "确认无误请回复“确认创建”，取消请回复“取消”。",
  ].join("\n");
}

function result(state, reply, extras = {}) {
  return {
    consumed: true,
    state: clone(state),
    reply,
    ...extras,
  };
}

export function commandTransition({
  text,
  chatType,
  metadata,
  state = null,
}) {
  const normalized = String(text ?? "").trim();
  const match = normalized.match(/^\/department(?:\s+(.+))?$/i);
  if (!match) return { consumed: false, state };
  const subcommand = (match[1] ?? "help").trim().toLowerCase();
  const isGroup = chatType === "group" || chatType === "group_chat";
  if (!isGroup && ["create", "status", "cancel"].includes(subcommand)) {
    return result(state, "部门向导只能在群聊中使用。", { action: "denied" });
  }
  if (subcommand === "create") {
    if (state && ["collecting", "review", "provisioning", "waiting_restart"].includes(state.status)) {
      return result(state, `已有创建向导进行中，当前步骤：${state.step}`, {
        action: "already_active",
      });
    }
    const next = startWizard(metadata);
    return result(next, `已启动新部门向导。\n${STEP_PROMPTS[next.step]}`, {
      action: "started",
    });
  }
  if (subcommand === "status") {
    return result(
      state,
      state
        ? `当前部门向导状态：${state.status}，步骤：${state.step}。`
        : "当前没有活动的部门创建向导。",
      { action: "status" },
    );
  }
  if (subcommand === "cancel") {
    return result(
      state ? { ...state, status: "cancelled", step: "cancelled" } : state,
      state ? "部门创建向导已取消。" : "当前没有活动的部门创建向导。",
      { action: "cancel" },
    );
  }
  return result(
    state,
    "用法：/department create、/department status、/department cancel",
    { action: "help" },
  );
}

export function advanceWizard(state, text, { senderId, authorized = true, now = Date.now() } = {}) {
  if (!state || !["collecting", "review"].includes(state.status)) {
    return { consumed: false, state };
  }
  if (senderId !== state.senderId) {
    return { consumed: false, state };
  }
  const input = String(text ?? "").trim();
  if (!input) return result(state, STEP_PROMPTS[state.step]);
  if (input === "取消" || input.toLowerCase() === "cancel") {
    return result(
      { ...state, status: "cancelled", step: "cancelled", updatedAt: now, expiresAt: null },
      "部门创建向导已取消。",
      { action: "cancel" },
    );
  }

  const next = { ...clone(state), updatedAt: now, expiresAt: now + 30 * 60 * 1000 };
  if (state.step === "department_name") {
    next.departmentName = cleanDepartmentName(input);
    if (!next.departmentName) return result(state, STEP_PROMPTS.department_name);
    next.step = "workspace";
    return result(next, STEP_PROMPTS.workspace);
  }
  if (state.step === "workspace") {
    if (!input.startsWith("/") || input === "/" || input === "/Users" || input === "/home") {
      return result(state, "工作区必须是已存在的绝对路径，不能使用系统根目录，请重新发送。");
    }
    next.workspace = input;
    next.step = "responsibilities";
    return result(next, STEP_PROMPTS.responsibilities);
  }
  if (state.step === "responsibilities") {
    next.responsibilities = splitItems(input);
    if (next.responsibilities.length === 0) {
      return result(state, "职责不能为空，请重新发送部门职责。");
    }
    next.step = "approval_boundaries";
    return result(next, STEP_PROMPTS.approval_boundaries);
  }
  if (state.step === "approval_boundaries") {
    next.approvalBoundaries =
      input === "默认" ? [...DEFAULT_APPROVAL_BOUNDARIES] : splitItems(input);
    if (next.approvalBoundaries.length === 0) {
      return result(state, "审批边界不能为空，请发送“默认”或自定义边界。");
    }
    next.step = "review";
    return result(next, reviewSummary(next));
  }
  if (state.step === "review") {
    if (input !== "确认创建") {
      return result(state, STEP_PROMPTS.review);
    }
    if (!authorized) {
      return { consumed: false, state };
    }
    next.status = "provisioning";
    next.step = "provisioning";
    next.expiresAt = null;
    return result(next, "已确认创建，正在写入当前主机的部门控制面。", {
      action: "provision",
      departmentId: deriveDepartmentId(next.workspace, next.departmentName, next.chatId),
    });
  }
  return result(state, STEP_PROMPTS[state.step] ?? STEP_PROMPTS.department_name);
}
