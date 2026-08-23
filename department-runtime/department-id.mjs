import path from "node:path";

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
