import { createHash } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;
const SKIPPED_DIRECTORIES = new Set([
  ".codex",
  ".lark-channel",
  ".ssh",
  ".worktrees",
  "coverage",
  "dist",
  "node_modules",
  "vendor",
  "__pycache__",
]);
const SECRET_BASENAMES = new Set([
  ".env",
  ".npmrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519",
]);
const SECRET_NAME_PATTERN = /(?:credential|secret|token|password|passwd|private[-_.]?key|session(?:s)?\.json)/i;
const INTERESTING_FILE_PATTERN = /(?:^|[-_.])(agents|memory|worklog|readme|changelog|plan|workflow|roadmap|brief|spec|requirements?|todo)(?:[-_.]|$)/i;
const INTERESTING_EXTENSIONS = new Set([
  ".csv",
  ".doc",
  ".docx",
  ".fig",
  ".html",
  ".ipynb",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".pdf",
  ".ppt",
  ".pptx",
  ".py",
  ".rb",
  ".rst",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
  ".xls",
  ".xlsx",
]);

function isSecretPath(relativePath) {
  const parts = relativePath.split(path.sep);
  const basename = parts.at(-1)?.toLowerCase() ?? "";
  return (
    parts.some((part) => SKIPPED_DIRECTORIES.has(part))
    || SECRET_BASENAMES.has(basename)
    || basename.startsWith(".env.")
    || SECRET_NAME_PATTERN.test(basename)
  );
}

function classify(relativePath) {
  const basename = path.basename(relativePath).toLowerCase();
  const extension = path.extname(basename);
  if (basename === "agents.md") return { type: "rules", confidence: "high" };
  if (basename === "memory.md") return { type: "memory", confidence: "high" };
  if (basename.startsWith("worklog")) return { type: "worklog", confidence: "high" };
  if (basename.startsWith("readme")) return { type: "overview", confidence: "medium" };
  if (/workflow|roadmap|plan|brief|spec/.test(basename)) {
    return { type: "planning", confidence: "medium" };
  }
  if ([".ppt", ".pptx", ".pdf", ".doc", ".docx", ".xls", ".xlsx"].includes(extension)) {
    return { type: "deliverable", confidence: "medium" };
  }
  if (/^(scripts?|skills?)(?:\/|$)/.test(relativePath.replaceAll(path.sep, "/"))) {
    return { type: "capability", confidence: "medium" };
  }
  return { type: "workspace_file", confidence: "low" };
}

function shouldInclude(relativePath) {
  const basename = path.basename(relativePath);
  return (
    INTERESTING_FILE_PATTERN.test(basename)
    || INTERESTING_EXTENSIONS.has(path.extname(basename).toLowerCase())
  );
}

function sourceMetadata(absolutePath, relativePath, maxFileBytes) {
  const file = lstatSync(absolutePath);
  if (!file.isFile() || file.isSymbolicLink() || file.size > maxFileBytes) return null;
  const data = readFileSync(absolutePath);
  const classification = classify(relativePath);
  return {
    relativePath: relativePath.replaceAll(path.sep, "/"),
    type: classification.type,
    confidence: classification.confidence,
    size: file.size,
    mtimeMs: Math.trunc(file.mtimeMs),
    sha256: createHash("sha256").update(data).digest("hex"),
  };
}

function walkWorkspace(workspace, current, candidates) {
  const entries = readdirSync(current, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(workspace, absolutePath);
    if (isSecretPath(relativePath) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (entry.name === ".git") continue;
      walkWorkspace(workspace, absolutePath, candidates);
      continue;
    }
    if (entry.isFile() && shouldInclude(relativePath)) {
      candidates.push({ absolutePath, relativePath });
    }
  }
}

function parentAgentCandidates(workspace, candidates, maxAncestors) {
  let current = path.dirname(workspace);
  for (let index = 0; index < maxAncestors && current !== path.dirname(current); index += 1) {
    const candidate = path.join(current, "AGENTS.md");
    try {
      const file = lstatSync(candidate);
      if (file.isFile() && !file.isSymbolicLink()) {
        candidates.push({
          absolutePath: candidate,
          relativePath: path.relative(workspace, candidate),
        });
      }
    } catch {
      // Missing ancestor rules are normal.
    }
    current = path.dirname(current);
  }
}

export function inventoryDepartmentContext({
  workspace,
  capabilityCatalog = [],
  maxFiles = DEFAULT_MAX_FILES,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  maxAncestors = 4,
} = {}) {
  if (typeof workspace !== "string" || !path.isAbsolute(workspace)) {
    throw new TypeError("workspace must be an absolute path");
  }
  if (!Number.isInteger(maxFiles) || maxFiles < 1) {
    throw new TypeError("maxFiles must be a positive integer");
  }
  const canonicalWorkspace = realpathSync(workspace);
  if (!statSync(canonicalWorkspace).isDirectory()) {
    throw new TypeError("workspace must be a directory");
  }

  const candidates = [];
  walkWorkspace(canonicalWorkspace, canonicalWorkspace, candidates);
  parentAgentCandidates(canonicalWorkspace, candidates, maxAncestors);
  candidates.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));

  const sources = [];
  for (const candidate of candidates) {
    const source = sourceMetadata(candidate.absolutePath, candidate.relativePath, maxFileBytes);
    if (source) sources.push(source);
    if (sources.length >= maxFiles) break;
  }
  return {
    workspace: canonicalWorkspace,
    repository: {
      present: (() => {
        try {
          return lstatSync(path.join(canonicalWorkspace, ".git")).isDirectory();
        } catch {
          return false;
        }
      })(),
    },
    sources,
    capabilities: Array.isArray(capabilityCatalog)
      ? capabilityCatalog
        .filter((capability) => capability && typeof capability === "object")
        .map((capability) => ({
          id: capability.id,
          kind: capability.kind,
          required: capability.required,
          scope: capability.scope,
          installPolicy: capability.installPolicy,
          source: capability.source && typeof capability.source === "object"
            ? structuredClone(capability.source)
            : null,
          verification: capability.verification && typeof capability.verification === "object"
            ? structuredClone(capability.verification)
            : null,
        }))
      : [],
    truncated: candidates.length > sources.length,
  };
}
