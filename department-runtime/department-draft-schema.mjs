import path from "node:path";

const COMMON_FIELDS = new Set([
  "departmentName",
  "kind",
  "purpose",
  "workspace",
  "responsibilities",
  "outOfScope",
  "workflow",
  "businessLifecycle",
  "taskProtocols",
  "capabilityPlan",
  "organizationTopology",
  "approvalBoundaries",
  "confirmedFacts",
  "historicalRules",
  "contextSources",
  "openQuestions",
  "lifecycle",
]);
const PERMANENT_FIELDS = new Set([
  "mission",
  "serviceCatalog",
  "recurringWorkflows",
  "defaultProjects",
  "taskTypes",
]);
const PROJECT_FIELDS = new Set([
  "objective",
  "deadline",
  "noDeadlineConfirmed",
  "milestones",
  "deliverables",
  "doneWhen",
  "projectWorkflow",
  "temporaryCapabilities",
  "parentDepartment",
  "closeout",
]);
export const ALLOWED_DRAFT_FIELDS = new Set([
  ...COMMON_FIELDS,
  ...PERMANENT_FIELDS,
  ...PROJECT_FIELDS,
]);
const DANGEROUS_EXACT_ROOTS = new Set([
  "/",
  "/home",
  "/home/hao",
  "/Users",
  "/Users/crystal",
]);
const DANGEROUS_PREFIXES = [
  "/home/hao/.lark-channel",
  "/home/hao/.codex",
  "/home/hao/.ssh",
  "/home/hao/.local/share/opc-company",
  "/Users/crystal/.lark-channel",
  "/Users/crystal/.codex",
  "/Users/crystal/.ssh",
  "/Users/crystal/.local/share/opc-company/bridge-extension",
];
const PERMANENT_LIFECYCLES = new Set(["draft", "active", "suspended", "retired"]);
const PROJECT_LIFECYCLES = new Set([
  "draft",
  "planning",
  "active",
  "closing",
  "completed",
  "archived",
]);
const TASK_PROTOCOL_FIELDS = new Set([
  "id",
  "name",
  "intents",
  "purpose",
  "requiredInputs",
  "clarificationPolicy",
  "steps",
  "qualityChecks",
  "deliverables",
  "completionCriteria",
  "skills",
  "revisionPolicy",
  "executionPolicy",
]);
const CAPABILITY_FIELDS = new Set([
  "id",
  "kind",
  "required",
  "scope",
  "installPolicy",
  "source",
  "verification",
  "nodeId",
  "bindingMode",
  "identityBound",
]);
const CAPABILITY_SOURCE_FIELDS = new Set([
  "type",
  "name",
  "repo",
  "path",
  "ref",
  "sha256",
  "package",
  "version",
  "transport",
  "pluginId",
]);
const CAPABILITY_VERIFICATION_FIELDS = new Set(["type", "name"]);
const CAPABILITY_KINDS = new Set(["builtin", "skill", "mcp", "plugin", "tool"]);
const CAPABILITY_SCOPES = new Set(["host", "workspace"]);
const CAPABILITY_INSTALL_POLICIES = new Set(["auto", "approval_required", "manual"]);
const CAPABILITY_BINDING_MODES = new Set(["install", "bind_existing"]);
const CAPABILITY_VERIFICATIONS = new Set([
  "skill_manifest",
  "builtin_registry",
  "mcp_registration",
  "plugin_registration",
  "executable",
]);
const TOPOLOGY_FIELDS = new Set(["primaryNodeId", "nodes", "agentRoles", "handoffPolicy"]);
const NODE_FIELDS = new Set([
  "id", "host", "role", "workspace", "bridgeProfile", "messageGate", "capabilities", "adapterId",
]);
const AGENT_ROLE_FIELDS = new Set([
  "id", "type", "nodeId", "scope", "separationRequiredFor",
]);
const HANDOFF_POLICY_FIELDS = new Set([
  "adapterId", "ledgerNodeId", "defaultFailover", "maxSilenceSeconds", "progressVisibility",
]);
const EXECUTION_POLICY_FIELDS = new Set([
  "coordinatorNodeId", "preferredNodeId", "requiredCapabilities", "verifierRoleId",
  "deliveryMode", "failoverPolicy", "fallbackNodeIds", "maxSilenceSeconds", "contextScopes",
  "periodic", "directDeliveryApproved", "risk", "idempotent",
]);
const NODE_ROLES = new Set(["primary", "auxiliary"]);
const MESSAGE_GATES = new Set(["every_message", "explicit_mention", "internal_only"]);
const AGENT_ROLE_TYPES = new Set(["coordinator", "executor", "verifier", "domain"]);
const FAILOVER_POLICIES = new Set(["manual", "automatic", "none"]);
const DELIVERY_MODES = new Set(["primary_synthesized", "direct_with_receipt"]);
const TASK_RISKS = new Set(["low", "normal", "high", "identity_bound", "publishing"]);

export class DepartmentDraftValidationError extends Error {
  constructor(errors) {
    super(`department draft validation failed with ${errors.length} error(s)`);
    this.name = "DepartmentDraftValidationError";
    this.errors = structuredClone(errors);
  }
}

function addError(errors, pathValue, code, message) {
  errors.push({ path: pathValue, code, message });
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return value;
  const items = value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  return [...new Set(items)];
}

function normalizeTaskProtocols(value) {
  if (!Array.isArray(value)) return value;
  return value.map((protocol) => {
    if (!protocol || typeof protocol !== "object" || Array.isArray(protocol)) return protocol;
    const normalized = structuredClone(protocol);
    for (const field of ["id", "name", "purpose", "clarificationPolicy", "revisionPolicy"]) {
      if (field in normalized) normalized[field] = normalizeText(normalized[field]);
    }
    for (const field of [
      "intents",
      "requiredInputs",
      "steps",
      "qualityChecks",
      "deliverables",
      "completionCriteria",
      "skills",
    ]) {
      if (field in normalized) normalized[field] = normalizeStringArray(normalized[field]);
    }
    if (normalized.executionPolicy && typeof normalized.executionPolicy === "object") {
      const policy = normalized.executionPolicy;
      for (const field of [
        "coordinatorNodeId", "preferredNodeId", "verifierRoleId", "deliveryMode",
        "failoverPolicy", "risk",
      ]) {
        if (field in policy) policy[field] = normalizeText(policy[field]);
      }
      for (const field of ["requiredCapabilities", "fallbackNodeIds", "contextScopes"]) {
        if (field in policy) policy[field] = normalizeStringArray(policy[field]);
      }
    }
    return normalized;
  });
}

function normalizeCapabilityPlan(value) {
  if (!Array.isArray(value)) return value;
  return value.map((capability) => {
    if (!capability || typeof capability !== "object" || Array.isArray(capability)) {
      return capability;
    }
    const normalized = structuredClone(capability);
    for (const field of ["id", "kind", "scope", "installPolicy", "nodeId", "bindingMode"]) {
      if (field in normalized) normalized[field] = normalizeText(normalized[field]);
    }
    if (normalized.source && typeof normalized.source === "object") {
      for (const field of Object.keys(normalized.source)) {
        normalized.source[field] = normalizeText(normalized.source[field]);
      }
    }
    if (normalized.verification && typeof normalized.verification === "object") {
      for (const field of Object.keys(normalized.verification)) {
        normalized.verification[field] = normalizeText(normalized.verification[field]);
      }
    }
    return normalized;
  });
}

function normalizeOrganizationTopology(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const normalized = structuredClone(value);
  normalized.primaryNodeId = normalizeText(normalized.primaryNodeId);
  if (Array.isArray(normalized.nodes)) {
    normalized.nodes = normalized.nodes.map((node) => {
      if (!node || typeof node !== "object" || Array.isArray(node)) return node;
      const item = structuredClone(node);
      for (const field of ["id", "host", "role", "workspace", "bridgeProfile", "messageGate", "adapterId"]) {
        if (field in item) item[field] = normalizeText(item[field]);
      }
      item.capabilities = normalizeStringArray(item.capabilities ?? []);
      return item;
    });
  }
  if (Array.isArray(normalized.agentRoles)) {
    normalized.agentRoles = normalized.agentRoles.map((role) => {
      if (!role || typeof role !== "object" || Array.isArray(role)) return role;
      const item = structuredClone(role);
      for (const field of ["id", "type", "nodeId"]) {
        if (field in item) item[field] = normalizeText(item[field]);
      }
      item.scope = normalizeStringArray(item.scope ?? []);
      item.separationRequiredFor = normalizeStringArray(item.separationRequiredFor ?? []);
      return item;
    });
  }
  if (normalized.handoffPolicy && typeof normalized.handoffPolicy === "object") {
    for (const field of ["adapterId", "ledgerNodeId", "defaultFailover", "progressVisibility"]) {
      if (field in normalized.handoffPolicy) {
        normalized.handoffPolicy[field] = normalizeText(normalized.handoffPolicy[field]);
      }
    }
  }
  return normalized;
}

function synthesizedTopology(workspace) {
  return {
    primaryNodeId: "primary",
    nodes: [{
      id: "primary",
      host: "current",
      role: "primary",
      workspace,
      bridgeProfile: "default",
      messageGate: "every_message",
      capabilities: [],
      adapterId: "local",
    }],
    agentRoles: [{
      id: "default_coordinator",
      type: "coordinator",
      nodeId: "primary",
      scope: ["governance", "synthesis"],
      separationRequiredFor: [],
    }, {
      id: "default_executor",
      type: "executor",
      nodeId: "primary",
      scope: ["task_execution"],
      separationRequiredFor: [],
    }, {
      id: "default_verifier",
      type: "verifier",
      nodeId: "primary",
      scope: ["quality"],
      separationRequiredFor: ["publishing", "identity"],
    }],
    handoffPolicy: {
      adapterId: "local",
      ledgerNodeId: "primary",
      defaultFailover: "manual",
      maxSilenceSeconds: 300,
      progressVisibility: "concise_group_status",
    },
  };
}

function defaultExecutionPolicy(primaryNodeId, verifierRoleId, requiredCapabilities = []) {
  return {
    coordinatorNodeId: primaryNodeId,
    preferredNodeId: primaryNodeId,
    requiredCapabilities,
    verifierRoleId,
    deliveryMode: "primary_synthesized",
    failoverPolicy: "manual",
    fallbackNodeIds: [],
    maxSilenceSeconds: 300,
    contextScopes: ["request", "accepted_department_facts"],
    periodic: false,
    directDeliveryApproved: false,
    risk: "normal",
    idempotent: false,
  };
}

function requireText(value, field, errors) {
  if (typeof value !== "string" || !value.trim()) {
    addError(errors, `/${field}`, "REQUIRED", `${field} is required`);
  }
}

function requireStringArray(value, field, errors, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    addError(errors, `/${field}`, "INVALID_ARRAY", `${field} must be an array of strings`);
    return;
  }
  if (!allowEmpty && value.filter((item) => item.trim()).length === 0) {
    addError(errors, `/${field}`, "REQUIRED", `${field} must not be empty`);
  }
}

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
  );
}

function validateWorkspace(value, errors) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    addError(errors, "/workspace", "INVALID_WORKSPACE", "workspace must be an absolute path");
    return;
  }
  const normalized = path.resolve(value);
  if (
    DANGEROUS_EXACT_ROOTS.has(normalized)
    || DANGEROUS_PREFIXES.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}${path.sep}`),
    )
  ) {
    addError(errors, "/workspace", "DANGEROUS_WORKSPACE", "workspace is a protected root");
  }
}

function validateContextSources(value, errors) {
  if (!Array.isArray(value)) {
    addError(errors, "/contextSources", "INVALID_ARRAY", "contextSources must be an array");
    return;
  }
  for (const [index, source] of value.entries()) {
    if (
      !source
      || typeof source !== "object"
      || Array.isArray(source)
      || typeof source.path !== "string"
      || typeof source.type !== "string"
      || !["low", "medium", "high"].includes(source.confidence)
    ) {
      addError(
        errors,
        `/contextSources/${index}`,
        "INVALID_CONTEXT_SOURCE",
        "context source requires path, type, and confidence",
      );
    }
  }
}

function validateOpenQuestions(value, errors, requireReady) {
  if (!Array.isArray(value)) {
    addError(errors, "/openQuestions", "INVALID_ARRAY", "openQuestions must be an array");
    return;
  }
  for (const [index, question] of value.entries()) {
    if (
      !question
      || typeof question !== "object"
      || Array.isArray(question)
      || typeof question.text !== "string"
      || !question.text.trim()
      || typeof question.critical !== "boolean"
    ) {
      addError(
        errors,
        `/openQuestions/${index}`,
        "INVALID_OPEN_QUESTION",
        "open question requires text and critical",
      );
      continue;
    }
    if (requireReady && question.critical) {
      addError(
        errors,
        `/openQuestions/${index}`,
        "UNRESOLVED_CRITICAL_QUESTION",
        `critical question is unresolved: ${question.text}`,
      );
    }
  }
}

function validateTaskProtocols(value, errors, requireReady) {
  if (value === undefined) value = [];
  if (!Array.isArray(value)) {
    addError(errors, "/taskProtocols", "INVALID_ARRAY", "taskProtocols must be an array");
    return;
  }
  if (requireReady && value.length === 0) {
    addError(
      errors,
      "/taskProtocols",
      "CORE_TASK_PROTOCOL_REQUIRED",
      "at least one core task protocol is required before final confirmation",
    );
  }
  const ids = new Set();
  for (const [index, protocol] of value.entries()) {
    const base = `/taskProtocols/${index}`;
    if (!protocol || typeof protocol !== "object" || Array.isArray(protocol)) {
      addError(errors, base, "INVALID_TASK_PROTOCOL", "task protocol must be an object");
      continue;
    }
    for (const field of Object.keys(protocol)) {
      if (!TASK_PROTOCOL_FIELDS.has(field)) {
        addError(errors, `${base}/${field}`, "UNKNOWN_FIELD", `unknown task protocol field: ${field}`);
      }
    }
    if (typeof protocol.id !== "string" || !/^[a-z][a-z0-9_]*$/.test(protocol.id)) {
      addError(
        errors,
        `${base}/id`,
        "INVALID_TASK_PROTOCOL_ID",
        "task protocol id must be snake_case",
      );
    } else if (ids.has(protocol.id)) {
      addError(
        errors,
        `${base}/id`,
        "DUPLICATE_TASK_PROTOCOL_ID",
        `duplicate task protocol id: ${protocol.id}`,
      );
    } else {
      ids.add(protocol.id);
    }
    requireText(protocol.name, `${base.slice(1)}/name`, errors);
    requireText(protocol.purpose, `${base.slice(1)}/purpose`, errors);
    requireText(
      protocol.clarificationPolicy,
      `${base.slice(1)}/clarificationPolicy`,
      errors,
    );
    requireText(protocol.revisionPolicy, `${base.slice(1)}/revisionPolicy`, errors);
    for (const field of ["intents", "steps", "qualityChecks", "deliverables", "completionCriteria"]) {
      requireStringArray(protocol[field], `${base.slice(1)}/${field}`, errors);
    }
    for (const field of ["requiredInputs", "skills"]) {
      requireStringArray(protocol[field] ?? [], `${base.slice(1)}/${field}`, errors, {
        allowEmpty: true,
      });
    }
  }
}

function isSafeRelativePath(value) {
  if (typeof value !== "string" || !value || path.isAbsolute(value) || value.includes("\0")) {
    return false;
  }
  const parts = value.split(/[\\/]+/);
  return parts.every((part) => part && part !== "." && part !== "..");
}

function validateCapabilitySource(source, capability, base, errors) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    addError(errors, `${base}/source`, "INVALID_CAPABILITY_SOURCE", "source must be an object");
    return;
  }
  for (const field of Object.keys(source)) {
    if (!CAPABILITY_SOURCE_FIELDS.has(field)) {
      addError(errors, `${base}/source/${field}`, "UNKNOWN_FIELD", `unknown source field: ${field}`);
    }
  }
  const type = source.type;
  const compatible = {
    builtin: new Set(["builtin"]),
    skill: new Set(["github_skill", "local_skill"]),
    mcp: new Set(["mcp_server"]),
    plugin: new Set(["codex_plugin"]),
    tool: new Set(["tool"]),
  }[capability.kind];
  if (!compatible?.has(type)) {
    addError(
      errors,
      `${base}/source/type`,
      "INVALID_CAPABILITY_SOURCE",
      `source type ${String(type)} is not valid for ${String(capability.kind)}`,
    );
    return;
  }
  if (type === "builtin") {
    if (typeof source.name !== "string" || !/^[a-z][a-z0-9._-]*$/.test(source.name)) {
      addError(errors, `${base}/source/name`, "INVALID_CAPABILITY_SOURCE", "invalid builtin name");
    }
  }
  if (type === "github_skill") {
    if (typeof source.repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repo)) {
      addError(errors, `${base}/source/repo`, "INVALID_CAPABILITY_SOURCE", "repo must be owner/name");
    }
    if (!isSafeRelativePath(source.path)) {
      addError(errors, `${base}/source/path`, "UNSAFE_SOURCE_PATH", "GitHub skill path is unsafe");
    }
    if (
      typeof source.ref !== "string"
      || !/^(?:v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?|[a-f0-9]{40})$/i.test(source.ref)
    ) {
      addError(errors, `${base}/source/ref`, "UNPINNED_SOURCE", "GitHub skill ref must be a version tag or full commit SHA");
    }
  }
  if (type === "local_skill") {
    if (typeof source.path !== "string" || !path.isAbsolute(source.path) || source.path.includes("\0")) {
      addError(errors, `${base}/source/path`, "UNSAFE_SOURCE_PATH", "local skill source must be an absolute path");
    }
    if (typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(source.sha256)) {
      addError(errors, `${base}/source/sha256`, "UNPINNED_SOURCE", "local skill source requires sha256");
    }
  }
  if (type === "mcp_server") {
    if (typeof source.package !== "string" || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(source.package)) {
      addError(errors, `${base}/source/package`, "INVALID_CAPABILITY_SOURCE", "invalid MCP package");
    }
    if (typeof source.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(source.version)) {
      addError(errors, `${base}/source/version`, "UNPINNED_SOURCE", "MCP package requires a fixed version");
    }
    if (!new Set(["stdio", "http"]).has(source.transport)) {
      addError(errors, `${base}/source/transport`, "INVALID_CAPABILITY_SOURCE", "invalid MCP transport");
    }
  }
  if (type === "codex_plugin") {
    if (typeof source.pluginId !== "string" || !/^[A-Za-z0-9._@/-]+$/.test(source.pluginId)) {
      addError(errors, `${base}/source/pluginId`, "INVALID_CAPABILITY_SOURCE", "invalid plugin id");
    }
    if (typeof source.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(source.version)) {
      addError(errors, `${base}/source/version`, "UNPINNED_SOURCE", "plugin requires a fixed version");
    }
  }
  if (type === "tool") {
    if (typeof source.name !== "string" || !/^[A-Za-z0-9._+-]+$/.test(source.name)) {
      addError(errors, `${base}/source/name`, "INVALID_CAPABILITY_SOURCE", "invalid tool name");
    }
    if (typeof source.version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(source.version)) {
      addError(errors, `${base}/source/version`, "UNPINNED_SOURCE", "tool requires a fixed version");
    }
  }
}

function validateCapabilityPlan(value, errors) {
  if (!Array.isArray(value)) {
    addError(errors, "/capabilityPlan", "INVALID_ARRAY", "capabilityPlan must be an array");
    return;
  }
  const ids = new Set();
  for (const [index, capability] of value.entries()) {
    const base = `/capabilityPlan/${index}`;
    if (!capability || typeof capability !== "object" || Array.isArray(capability)) {
      addError(errors, base, "INVALID_CAPABILITY", "capability must be an object");
      continue;
    }
    for (const field of Object.keys(capability)) {
      if (!CAPABILITY_FIELDS.has(field)) {
        addError(errors, `${base}/${field}`, "UNKNOWN_FIELD", `unknown capability field: ${field}`);
      }
    }
    if (typeof capability.id !== "string" || !/^[a-z][a-z0-9._-]*$/.test(capability.id)) {
      addError(errors, `${base}/id`, "INVALID_CAPABILITY_ID", "invalid capability id");
    } else if (ids.has(capability.id)) {
      addError(errors, `${base}/id`, "DUPLICATE_CAPABILITY_ID", `duplicate capability id: ${capability.id}`);
    } else {
      ids.add(capability.id);
    }
    if (!CAPABILITY_KINDS.has(capability.kind)) {
      addError(errors, `${base}/kind`, "INVALID_CAPABILITY_KIND", "invalid capability kind");
    }
    if (typeof capability.required !== "boolean") {
      addError(errors, `${base}/required`, "INVALID_CAPABILITY_REQUIRED", "required must be boolean");
    }
    if (!CAPABILITY_SCOPES.has(capability.scope)) {
      addError(errors, `${base}/scope`, "INVALID_CAPABILITY_SCOPE", "invalid capability scope");
    }
    if (!CAPABILITY_INSTALL_POLICIES.has(capability.installPolicy)) {
      addError(errors, `${base}/installPolicy`, "INVALID_INSTALL_POLICY", "invalid install policy");
    }
    if (typeof capability.nodeId !== "string" || !/^[a-z][a-z0-9_-]*$/.test(capability.nodeId)) {
      addError(errors, `${base}/nodeId`, "INVALID_CAPABILITY_NODE", "capability nodeId is invalid");
    }
    if (!CAPABILITY_BINDING_MODES.has(capability.bindingMode)) {
      addError(errors, `${base}/bindingMode`, "INVALID_BINDING_MODE", "invalid binding mode");
    }
    if (typeof capability.identityBound !== "boolean") {
      addError(errors, `${base}/identityBound`, "INVALID_IDENTITY_BOUND", "identityBound must be boolean");
    }
    validateCapabilitySource(capability.source, capability, base, errors);
    const verification = capability.verification;
    if (!verification || typeof verification !== "object" || Array.isArray(verification)) {
      addError(errors, `${base}/verification`, "INVALID_VERIFICATION", "verification must be an object");
    } else {
      for (const field of Object.keys(verification)) {
        if (!CAPABILITY_VERIFICATION_FIELDS.has(field)) {
          addError(errors, `${base}/verification/${field}`, "UNKNOWN_FIELD", `unknown verification field: ${field}`);
        }
      }
      if (!CAPABILITY_VERIFICATIONS.has(verification.type)) {
        addError(errors, `${base}/verification/type`, "INVALID_VERIFICATION", "unsupported verification type");
      }
      if (verification.name !== undefined && !/^[A-Za-z0-9._+-]+$/.test(verification.name)) {
        addError(errors, `${base}/verification/name`, "INVALID_VERIFICATION", "invalid verification name");
      }
    }
  }
}

function validateIdentifier(value, base, errors, code = "INVALID_ID") {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_-]*$/.test(value)) {
    addError(errors, base, code, "identifier must be snake_case");
    return false;
  }
  return true;
}

function validateNodeWorkspace(value, base, errors) {
  if (typeof value !== "string" || !path.isAbsolute(value) || value.includes("\0")) {
    addError(errors, base, "INVALID_NODE_WORKSPACE", "node workspace must be an absolute path");
    return;
  }
  const normalized = path.resolve(value);
  if (
    DANGEROUS_EXACT_ROOTS.has(normalized)
    || DANGEROUS_PREFIXES.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}${path.sep}`),
    )
  ) {
    addError(errors, base, "DANGEROUS_NODE_WORKSPACE", "node workspace is a protected root");
  }
}

function validateOrganizationTopology(topology, capabilityPlan, taskProtocols, errors) {
  if (!topology || typeof topology !== "object" || Array.isArray(topology)) {
    addError(errors, "/organizationTopology", "INVALID_TOPOLOGY", "organizationTopology must be an object");
    return;
  }
  for (const field of Object.keys(topology)) {
    if (!TOPOLOGY_FIELDS.has(field)) {
      addError(errors, `/organizationTopology/${field}`, "UNKNOWN_FIELD", `unknown topology field: ${field}`);
    }
  }
  validateIdentifier(
    topology.primaryNodeId,
    "/organizationTopology/primaryNodeId",
    errors,
    "INVALID_PRIMARY_NODE",
  );

  const nodeIds = new Set();
  const nodes = new Map();
  let primaryCount = 0;
  if (!Array.isArray(topology.nodes) || topology.nodes.length === 0) {
    addError(errors, "/organizationTopology/nodes", "TOPOLOGY_NODES_REQUIRED", "topology nodes are required");
  } else {
    for (const [index, node] of topology.nodes.entries()) {
      const base = `/organizationTopology/nodes/${index}`;
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        addError(errors, base, "INVALID_TOPOLOGY_NODE", "topology node must be an object");
        continue;
      }
      for (const field of Object.keys(node)) {
        if (!NODE_FIELDS.has(field)) {
          addError(errors, `${base}/${field}`, "UNKNOWN_FIELD", `unknown node field: ${field}`);
        }
      }
      if (validateIdentifier(node.id, `${base}/id`, errors, "INVALID_NODE_ID")) {
        if (nodeIds.has(node.id)) {
          addError(errors, `${base}/id`, "DUPLICATE_NODE_ID", `duplicate node id: ${node.id}`);
        } else {
          nodeIds.add(node.id);
          nodes.set(node.id, node);
        }
      }
      if (typeof node.host !== "string" || !/^[a-z][a-z0-9_-]*$/.test(node.host)) {
        addError(errors, `${base}/host`, "INVALID_NODE_HOST", "invalid node host");
      }
      if (!NODE_ROLES.has(node.role)) {
        addError(errors, `${base}/role`, "INVALID_NODE_ROLE", "node role must be primary or auxiliary");
      } else if (node.role === "primary") {
        primaryCount += 1;
      }
      const synthesizedSingleNode = topology.nodes.length === 1
        && node.id === "primary"
        && node.host === "current"
        && node.bridgeProfile === "default";
      if (!synthesizedSingleNode) {
        validateNodeWorkspace(node.workspace, `${base}/workspace`, errors);
      }
      if (typeof node.bridgeProfile !== "string" || !node.bridgeProfile.trim()) {
        addError(errors, `${base}/bridgeProfile`, "INVALID_BRIDGE_PROFILE", "bridgeProfile is required");
      }
      if (!MESSAGE_GATES.has(node.messageGate)) {
        addError(errors, `${base}/messageGate`, "INVALID_MESSAGE_GATE", "invalid message gate");
      }
      requireStringArray(node.capabilities ?? [], `${base.slice(1)}/capabilities`, errors, { allowEmpty: true });
      if (typeof node.adapterId !== "string" || !/^[a-z][a-z0-9_-]*$/.test(node.adapterId)) {
        addError(errors, `${base}/adapterId`, "INVALID_ADAPTER_ID", "invalid adapter id");
      }
    }
  }
  if (primaryCount !== 1) {
    addError(
      errors,
      "/organizationTopology/nodes",
      "EXACTLY_ONE_PRIMARY_REQUIRED",
      "topology must contain exactly one primary node",
    );
  }
  if (!nodes.has(topology.primaryNodeId) || nodes.get(topology.primaryNodeId)?.role !== "primary") {
    addError(
      errors,
      "/organizationTopology/primaryNodeId",
      "PRIMARY_NODE_MISMATCH",
      "primaryNodeId must reference the only primary node",
    );
  }

  const roleIds = new Set();
  const roles = new Map();
  const roleTypeCounts = new Map();
  if (!Array.isArray(topology.agentRoles) || topology.agentRoles.length === 0) {
    addError(errors, "/organizationTopology/agentRoles", "AGENT_ROLES_REQUIRED", "agent roles are required");
  } else {
    for (const [index, role] of topology.agentRoles.entries()) {
      const base = `/organizationTopology/agentRoles/${index}`;
      if (!role || typeof role !== "object" || Array.isArray(role)) {
        addError(errors, base, "INVALID_AGENT_ROLE", "agent role must be an object");
        continue;
      }
      for (const field of Object.keys(role)) {
        if (!AGENT_ROLE_FIELDS.has(field)) {
          addError(errors, `${base}/${field}`, "UNKNOWN_FIELD", `unknown agent role field: ${field}`);
        }
      }
      if (validateIdentifier(role.id, `${base}/id`, errors, "INVALID_AGENT_ROLE_ID")) {
        if (roleIds.has(role.id)) {
          addError(errors, `${base}/id`, "DUPLICATE_AGENT_ROLE_ID", `duplicate agent role id: ${role.id}`);
        } else {
          roleIds.add(role.id);
          roles.set(role.id, role);
        }
      }
      if (!AGENT_ROLE_TYPES.has(role.type)) {
        addError(errors, `${base}/type`, "INVALID_AGENT_ROLE_TYPE", "invalid agent role type");
      } else {
        roleTypeCounts.set(role.type, (roleTypeCounts.get(role.type) ?? 0) + 1);
      }
      if (!nodeIds.has(role.nodeId)) {
        addError(errors, `${base}/nodeId`, "UNKNOWN_AGENT_ROLE_NODE", "agent role node does not exist");
      }
      requireStringArray(role.scope ?? [], `${base.slice(1)}/scope`, errors, { allowEmpty: true });
      requireStringArray(
        role.separationRequiredFor ?? [],
        `${base.slice(1)}/separationRequiredFor`,
        errors,
        { allowEmpty: true },
      );
    }
  }
  for (const requiredType of ["coordinator", "executor", "verifier"]) {
    if (!roleTypeCounts.has(requiredType)) {
      addError(
        errors,
        "/organizationTopology/agentRoles",
        "GOVERNANCE_ROLE_REQUIRED",
        `at least one ${requiredType} role is required`,
      );
    }
  }

  const handoff = topology.handoffPolicy;
  if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
    addError(errors, "/organizationTopology/handoffPolicy", "INVALID_HANDOFF_POLICY", "handoff policy is required");
  } else {
    for (const field of Object.keys(handoff)) {
      if (!HANDOFF_POLICY_FIELDS.has(field)) {
        addError(errors, `/organizationTopology/handoffPolicy/${field}`, "UNKNOWN_FIELD", `unknown handoff policy field: ${field}`);
      }
    }
    if (typeof handoff.adapterId !== "string" || !/^[a-z][a-z0-9_-]*$/.test(handoff.adapterId)) {
      addError(errors, "/organizationTopology/handoffPolicy/adapterId", "INVALID_ADAPTER_ID", "invalid adapter id");
    }
    if (!nodeIds.has(handoff.ledgerNodeId) || handoff.ledgerNodeId !== topology.primaryNodeId) {
      addError(errors, "/organizationTopology/handoffPolicy/ledgerNodeId", "LEDGER_MUST_BE_PRIMARY", "ledger must be owned by the primary node");
    }
    if (!FAILOVER_POLICIES.has(handoff.defaultFailover)) {
      addError(errors, "/organizationTopology/handoffPolicy/defaultFailover", "INVALID_FAILOVER_POLICY", "invalid default failover policy");
    }
    if (!Number.isInteger(handoff.maxSilenceSeconds) || handoff.maxSilenceSeconds < 30 || handoff.maxSilenceSeconds > 86_400) {
      addError(errors, "/organizationTopology/handoffPolicy/maxSilenceSeconds", "INVALID_SILENCE_WINDOW", "maxSilenceSeconds must be between 30 and 86400");
    }
    if (!new Set(["concise_group_status", "internal_only"]).has(handoff.progressVisibility)) {
      addError(errors, "/organizationTopology/handoffPolicy/progressVisibility", "INVALID_PROGRESS_VISIBILITY", "invalid progress visibility");
    }
  }

  const capabilities = new Map();
  for (const [index, capability] of (Array.isArray(capabilityPlan) ? capabilityPlan : []).entries()) {
    if (!capability?.id) continue;
    capabilities.set(capability.id, capability);
    if (!nodeIds.has(capability.nodeId)) {
      addError(errors, `/capabilityPlan/${index}/nodeId`, "UNKNOWN_CAPABILITY_NODE", "capability node does not exist");
    }
    if (nodes.has(capability.nodeId) && !nodes.get(capability.nodeId).capabilities?.includes(capability.id)) {
      addError(errors, `/capabilityPlan/${index}/nodeId`, "CAPABILITY_NODE_MISMATCH", "capability owner node must list the capability");
    }
  }
  for (const [nodeIndex, node] of (Array.isArray(topology.nodes) ? topology.nodes : []).entries()) {
    for (const [capIndex, capabilityId] of (Array.isArray(node?.capabilities) ? node.capabilities : []).entries()) {
      if (!capabilities.has(capabilityId)) {
        addError(errors, `/organizationTopology/nodes/${nodeIndex}/capabilities/${capIndex}`, "UNKNOWN_NODE_CAPABILITY", "node capability does not exist");
      } else if (capabilities.get(capabilityId).nodeId !== node.id) {
        addError(errors, `/organizationTopology/nodes/${nodeIndex}/capabilities/${capIndex}`, "CAPABILITY_NODE_MISMATCH", "capability is owned by another node");
      }
    }
  }

  for (const [index, protocol] of (Array.isArray(taskProtocols) ? taskProtocols : []).entries()) {
    const base = `/taskProtocols/${index}/executionPolicy`;
    const policy = protocol?.executionPolicy;
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
      addError(errors, base, "EXECUTION_POLICY_REQUIRED", "task execution policy is required");
      continue;
    }
    for (const field of Object.keys(policy)) {
      if (!EXECUTION_POLICY_FIELDS.has(field)) {
        addError(errors, `${base}/${field}`, "UNKNOWN_FIELD", `unknown execution policy field: ${field}`);
      }
    }
    if (!nodeIds.has(policy.coordinatorNodeId)) {
      addError(errors, `${base}/coordinatorNodeId`, "UNKNOWN_EXECUTION_NODE", "coordinator node does not exist");
    }
    if (!nodeIds.has(policy.preferredNodeId)) {
      addError(errors, `${base}/preferredNodeId`, "UNKNOWN_EXECUTION_NODE", "preferred node does not exist");
    }
    const requiredCapabilities = Array.isArray(policy.requiredCapabilities) ? policy.requiredCapabilities : [];
    requireStringArray(requiredCapabilities, `${base.slice(1)}/requiredCapabilities`, errors, { allowEmpty: true });
    for (const [capIndex, capabilityId] of requiredCapabilities.entries()) {
      if (!capabilities.has(capabilityId)) {
        addError(errors, `${base}/requiredCapabilities/${capIndex}`, "UNKNOWN_REQUIRED_CAPABILITY", "required capability does not exist");
      } else if (nodes.has(policy.preferredNodeId) && !nodes.get(policy.preferredNodeId).capabilities?.includes(capabilityId)) {
        addError(errors, `${base}/preferredNodeId`, "CAPABILITY_NOT_ON_PREFERRED_NODE", `preferred node does not provide ${capabilityId}`);
      }
    }
    if (!roles.has(policy.verifierRoleId) || roles.get(policy.verifierRoleId)?.type !== "verifier") {
      addError(errors, `${base}/verifierRoleId`, "INVALID_VERIFIER_ROLE", "verifierRoleId must reference a verifier role");
    }
    if (!DELIVERY_MODES.has(policy.deliveryMode)) {
      addError(errors, `${base}/deliveryMode`, "INVALID_DELIVERY_MODE", "invalid delivery mode");
    }
    if (!FAILOVER_POLICIES.has(policy.failoverPolicy)) {
      addError(errors, `${base}/failoverPolicy`, "INVALID_FAILOVER_POLICY", "invalid failover policy");
    }
    requireStringArray(policy.fallbackNodeIds ?? [], `${base.slice(1)}/fallbackNodeIds`, errors, { allowEmpty: true });
    for (const [fallbackIndex, nodeId] of (policy.fallbackNodeIds ?? []).entries()) {
      if (!nodeIds.has(nodeId)) {
        addError(errors, `${base}/fallbackNodeIds/${fallbackIndex}`, "UNKNOWN_EXECUTION_NODE", "fallback node does not exist");
      }
    }
    if (!Number.isInteger(policy.maxSilenceSeconds) || policy.maxSilenceSeconds < 30 || policy.maxSilenceSeconds > 86_400) {
      addError(errors, `${base}/maxSilenceSeconds`, "INVALID_SILENCE_WINDOW", "maxSilenceSeconds must be between 30 and 86400");
    }
    requireStringArray(policy.contextScopes ?? [], `${base.slice(1)}/contextScopes`, errors, { allowEmpty: true });
    if (typeof policy.periodic !== "boolean" || typeof policy.directDeliveryApproved !== "boolean" || typeof policy.idempotent !== "boolean") {
      addError(errors, base, "INVALID_EXECUTION_POLICY_BOOLEAN", "periodic, directDeliveryApproved and idempotent must be booleans");
    }
    if (!TASK_RISKS.has(policy.risk)) {
      addError(errors, `${base}/risk`, "INVALID_TASK_RISK", "invalid task risk");
    }
    if (
      policy.deliveryMode === "direct_with_receipt"
      && (policy.periodic !== true || policy.directDeliveryApproved !== true)
    ) {
      addError(errors, `${base}/deliveryMode`, "DIRECT_DELIVERY_NOT_APPROVED", "direct delivery requires an approved periodic protocol");
    }
    const hasIdentityCapability = requiredCapabilities.some((id) => capabilities.get(id)?.identityBound === true);
    if (
      policy.failoverPolicy === "automatic"
      && (policy.idempotent !== true || policy.risk !== "low" || hasIdentityCapability)
    ) {
      addError(errors, `${base}/failoverPolicy`, "UNSAFE_AUTOMATIC_FAILOVER", "automatic failover is limited to low-risk idempotent non-identity work");
    }
  }
}

function normalizeDraft(input) {
  const value = structuredClone(input ?? {});
  for (const field of [
    "departmentName",
    "purpose",
    "workspace",
    "mission",
    "objective",
    "parentDepartment",
  ]) {
    if (field in value && value[field] !== null) value[field] = normalizeText(value[field]);
  }
  for (const field of [
    "responsibilities",
    "outOfScope",
    "workflow",
    "businessLifecycle",
    "approvalBoundaries",
    "confirmedFacts",
    "historicalRules",
    "serviceCatalog",
    "recurringWorkflows",
    "defaultProjects",
    "taskTypes",
    "milestones",
    "deliverables",
    "doneWhen",
    "projectWorkflow",
    "temporaryCapabilities",
  ]) {
    if (field in value) value[field] = normalizeStringArray(value[field]);
  }
  value.organizationTopology = "organizationTopology" in value
    ? normalizeOrganizationTopology(value.organizationTopology)
    : synthesizedTopology(value.workspace);
  value.capabilityPlan = normalizeCapabilityPlan(value.capabilityPlan ?? []);
  const primaryNodeId = value.organizationTopology?.primaryNodeId;
  if (Array.isArray(value.capabilityPlan) && typeof primaryNodeId === "string") {
    for (const capability of value.capabilityPlan) {
      if (!capability || typeof capability !== "object" || Array.isArray(capability)) continue;
      capability.nodeId ??= primaryNodeId;
      capability.bindingMode ??= "install";
      capability.identityBound ??= false;
    }
  }
  if (Array.isArray(value.organizationTopology?.nodes)) {
    const capabilitiesByNode = new Map();
    for (const capability of value.capabilityPlan) {
      if (!capability?.nodeId || !capability?.id) continue;
      if (!capabilitiesByNode.has(capability.nodeId)) capabilitiesByNode.set(capability.nodeId, []);
      capabilitiesByNode.get(capability.nodeId).push(capability.id);
    }
    if (!("organizationTopology" in (input ?? {}))) {
      for (const node of value.organizationTopology.nodes) {
        node.capabilities = capabilitiesByNode.get(node.id) ?? [];
      }
    }
  }
  if ("taskProtocols" in value) value.taskProtocols = normalizeTaskProtocols(value.taskProtocols);
  if (Array.isArray(value.taskProtocols) && typeof primaryNodeId === "string") {
    const verifierRoleId = value.organizationTopology?.agentRoles?.find(
      (role) => role?.type === "verifier",
    )?.id ?? "default_verifier";
    for (const protocol of value.taskProtocols) {
      if (!protocol || typeof protocol !== "object" || Array.isArray(protocol)) continue;
      protocol.executionPolicy ??= defaultExecutionPolicy(primaryNodeId, verifierRoleId);
    }
  }
  if (
    value.kind === "project"
    && (!Array.isArray(value.businessLifecycle) || value.businessLifecycle.length === 0)
    && Array.isArray(value.projectWorkflow)
    && value.projectWorkflow.length > 0
  ) {
    value.businessLifecycle = structuredClone(value.projectWorkflow);
  }
  if (value.kind === "permanent") value.lifecycle ??= "active";
  if (value.kind === "project") value.lifecycle ??= "planning";
  return value;
}

export function validateDepartmentDraft(input, { requireReady = false } = {}) {
  const value = normalizeDraft(input);
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      value: {},
      errors: [{ path: "/", code: "INVALID_DRAFT", message: "draft must be an object" }],
    };
  }
  for (const field of Object.keys(value)) {
    if (!ALLOWED_DRAFT_FIELDS.has(field)) {
      addError(errors, `/${field}`, "UNKNOWN_FIELD", `unknown draft field: ${field}`);
    }
  }

  requireText(value.departmentName, "departmentName", errors);
  if (!new Set(["permanent", "project"]).has(value.kind)) {
    addError(errors, "/kind", "INVALID_KIND", "kind must be permanent or project");
  }
  requireText(value.purpose, "purpose", errors);
  validateWorkspace(value.workspace, errors);
  requireStringArray(value.responsibilities, "responsibilities", errors);
  requireStringArray(value.outOfScope, "outOfScope", errors, { allowEmpty: true });
  requireStringArray(value.workflow, "workflow", errors);
  requireStringArray(value.businessLifecycle ?? [], "businessLifecycle", errors, {
    allowEmpty: true,
  });
  validateTaskProtocols(value.taskProtocols, errors, requireReady);
  validateCapabilityPlan(value.capabilityPlan, errors);
  validateOrganizationTopology(
    value.organizationTopology,
    value.capabilityPlan,
    value.taskProtocols,
    errors,
  );
  requireStringArray(value.approvalBoundaries, "approvalBoundaries", errors);
  requireStringArray(value.confirmedFacts, "confirmedFacts", errors, { allowEmpty: true });
  requireStringArray(value.historicalRules, "historicalRules", errors, { allowEmpty: true });
  validateContextSources(value.contextSources, errors);
  validateOpenQuestions(value.openQuestions, errors, requireReady);

  if (value.kind === "permanent") {
    requireText(value.mission, "mission", errors);
    requireStringArray(value.serviceCatalog, "serviceCatalog", errors);
    requireStringArray(value.recurringWorkflows, "recurringWorkflows", errors, { allowEmpty: true });
    requireStringArray(value.defaultProjects, "defaultProjects", errors, { allowEmpty: true });
    requireStringArray(value.taskTypes, "taskTypes", errors);
    if (!PERMANENT_LIFECYCLES.has(value.lifecycle)) {
      addError(errors, "/lifecycle", "INVALID_LIFECYCLE", "invalid permanent lifecycle");
    }
  }

  if (value.kind === "project") {
    requireText(value.objective, "objective", errors);
    if (value.deadline == null) {
      if (value.noDeadlineConfirmed !== true) {
        addError(
          errors,
          "/deadline",
          "DEADLINE_CONFIRMATION_REQUIRED",
          "a missing project deadline requires explicit confirmation",
        );
      }
    } else if (typeof value.deadline !== "string" || !isValidIsoDate(value.deadline)) {
      addError(errors, "/deadline", "INVALID_DATE", "deadline must be a real YYYY-MM-DD date");
    }
    requireStringArray(value.milestones, "milestones", errors, { allowEmpty: true });
    requireStringArray(value.deliverables, "deliverables", errors);
    requireStringArray(value.doneWhen, "doneWhen", errors);
    if (value.projectWorkflow !== undefined) {
      requireStringArray(value.projectWorkflow, "projectWorkflow", errors, { allowEmpty: true });
    }
    if (requireReady && !value.businessLifecycle?.length) {
      addError(
        errors,
        "/businessLifecycle",
        "BUSINESS_LIFECYCLE_REQUIRED",
        "project departments require a business lifecycle before final confirmation",
      );
    }
    requireStringArray(
      value.temporaryCapabilities ?? [],
      "temporaryCapabilities",
      errors,
      { allowEmpty: true },
    );
    if (value.parentDepartment !== null && value.parentDepartment !== undefined) {
      requireText(value.parentDepartment, "parentDepartment", errors);
    }
    if (!PROJECT_LIFECYCLES.has(value.lifecycle)) {
      addError(errors, "/lifecycle", "INVALID_LIFECYCLE", "invalid project lifecycle");
    }
  }

  return errors.length === 0
    ? { ok: true, value, errors: [] }
    : { ok: false, value, errors };
}

export function assertDepartmentDraft(input, options = {}) {
  const result = validateDepartmentDraft(input, options);
  if (!result.ok) throw new DepartmentDraftValidationError(result.errors);
  return result.value;
}
