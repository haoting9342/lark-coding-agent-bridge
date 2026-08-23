const FINAL_PHASE = "awaiting_final_confirmation";
const EXPLICIT_CONFIRMATIONS = new Set([
  "同意",
  "确认",
  "同意创建",
  "确认创建",
  "按这个方案创建",
]);
const REVISION_MARKERS = /(?:但是|不过|还要|需要改|先改|改成|修改|增加|补充|删除|去掉|不要|不负责|调整|职责没问题，但|，但)/;

function normalizeFinalText(text) {
  if (typeof text !== "string") return "";
  return text.trim().replace(/[。.!！]+$/u, "").trim();
}

export function classifyDepartmentConfirmation({ phase, text } = {}) {
  if (phase !== FINAL_PHASE) return { action: "discuss" };
  const normalized = normalizeFinalText(text);
  if (EXPLICIT_CONFIRMATIONS.has(normalized)) return { action: "confirm" };
  if (
    REVISION_MARKERS.test(normalized)
    || [...EXPLICIT_CONFIRMATIONS].some((confirmation) => (
      normalized.startsWith(confirmation) && normalized !== confirmation
    ))
  ) {
    return { action: "revise" };
  }
  return { action: "discuss" };
}
