import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const DEFAULT_DESIGN_TTL_MS = 30 * 60 * 1000;
const STORE_SCHEMA_VERSION = 2;
const TERMINAL_STATUSES = new Set(["completed", "cancelled"]);
const IMMUTABLE_STATUSES = new Set(["provisioning", "completed", "cancelled"]);

export class DepartmentDesignStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "DepartmentDesignStoreError";
    this.code = code;
  }
}

export function designSessionKey({ profile, chatId }) {
  if (typeof profile !== "string" || !profile || typeof chatId !== "string" || !chatId) {
    throw new DepartmentDesignStoreError(
      "INVALID_KEY",
      "profile and chatId are required",
    );
  }
  return `${profile}|${chatId}`;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function emptyDocument() {
  return {
    schemaVersion: STORE_SCHEMA_VERSION,
    designs: {},
    archived: [],
  };
}

function validateDocument(document) {
  if (
    !document
    || document.schemaVersion !== STORE_SCHEMA_VERSION
    || !document.designs
    || typeof document.designs !== "object"
    || Array.isArray(document.designs)
    || !Array.isArray(document.archived ?? [])
  ) {
    throw new DepartmentDesignStoreError(
      "MALFORMED_STATE",
      "design state must contain schemaVersion 2 and a designs object",
    );
  }
  document.archived ??= [];
  for (const [key, state] of Object.entries(document.designs)) {
    if (
      !state
      || typeof state !== "object"
      || state.key !== key
      || designSessionKey(state) !== key
      || typeof state.status !== "string"
      || typeof state.phase !== "string"
      || !Number.isInteger(state.version)
      || !Array.isArray(state.history)
    ) {
      throw new DepartmentDesignStoreError(
        "MALFORMED_STATE",
        `invalid department design state for key ${key}`,
      );
    }
  }
}

function auditEntry(version, metadata, at) {
  return {
    version,
    actorId: metadata.actorId ?? "system",
    source: metadata.source ?? "controller",
    reason: metadata.reason ?? "state updated",
    changedPaths: [...new Set(metadata.changedPaths ?? [])],
    at,
  };
}

export class DepartmentDesignStore {
  constructor(filePath, { now = () => Date.now(), ttlMs = DEFAULT_DESIGN_TTL_MS } = {}) {
    this.filePath = path.resolve(filePath);
    this.now = now;
    this.ttlMs = ttlMs;
    this.document = null;
  }

  load() {
    if (!existsSync(this.filePath)) {
      this.document = emptyDocument();
      return clone(this.document);
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
      validateDocument(parsed);
      this.document = parsed;
      this.#autoPauseExpired();
      return clone(this.document);
    } catch (error) {
      if (error instanceof DepartmentDesignStoreError) throw error;
      throw new DepartmentDesignStoreError(
        "MALFORMED_STATE",
        `cannot parse department design state: ${error.message}`,
        { cause: error },
      );
    }
  }

  get(key) {
    this.load();
    this.#autoPauseExpired();
    return clone(this.document.designs[key] ?? null);
  }

  getFor(metadata) {
    return this.get(designSessionKey(metadata));
  }

  list() {
    this.load();
    this.#autoPauseExpired();
    return Object.values(this.document.designs).map(clone);
  }

  start(input) {
    this.load();
    this.#autoPauseExpired();
    const key = designSessionKey(input);
    const existing = this.document.designs[key];
    if (existing && !TERMINAL_STATUSES.has(existing.status)) {
      throw new DepartmentDesignStoreError(
        "EXISTING_DESIGN",
        `a department design already exists for ${key}`,
      );
    }
    if (existing) this.document.archived.push(clone(existing));
    const timestamp = this.now();
    const state = {
      schemaVersion: STORE_SCHEMA_VERSION,
      key,
      profile: input.profile,
      host: input.host,
      botName: input.botName ?? null,
      chatId: input.chatId,
      senderId: input.senderId,
      groupName: input.groupName ?? null,
      status: "active",
      phase: "awaiting_name",
      version: 1,
      draft: {},
      contextInventory: clone(input.contextInventory ?? null),
      currentWorkspace: input.currentWorkspace ?? null,
      openQuestions: [],
      pendingParticipantMessages: [],
      autoPaused: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: timestamp + this.ttlMs,
      history: [
        auditEntry(1, {
          actorId: input.senderId,
          source: "user_explicit",
          reason: "department design started",
          changedPaths: ["/status", "/phase"],
        }, timestamp),
      ],
    };
    this.document.designs[key] = state;
    this.#persist();
    return clone(state);
  }

  update(key, patch, metadata = {}) {
    this.load();
    this.#autoPauseExpired();
    const current = this.document.designs[key];
    if (!current) {
      throw new DepartmentDesignStoreError("NOT_FOUND", `design not found: ${key}`);
    }
    if (IMMUTABLE_STATUSES.has(current.status)) {
      throw new DepartmentDesignStoreError(
        "IMMUTABLE_STATE",
        `design cannot be updated while ${current.status}`,
      );
    }
    const timestamp = this.now();
    const version = current.version + 1;
    const updated = {
      ...current,
      ...clone(patch),
      key: current.key,
      profile: current.profile,
      chatId: current.chatId,
      createdAt: current.createdAt,
      version,
      updatedAt: timestamp,
      history: [
        ...current.history,
        auditEntry(version, metadata, timestamp),
      ],
    };
    if (updated.status === "active" || updated.status === "needs_revision") {
      updated.expiresAt = timestamp + this.ttlMs;
      updated.autoPaused = false;
    } else {
      updated.expiresAt = null;
    }
    this.document.designs[key] = updated;
    this.#persist();
    return clone(updated);
  }

  pause(key, metadata = {}) {
    const current = this.get(key);
    if (!current) return null;
    if (current.status === "provisioning") {
      throw new DepartmentDesignStoreError(
        "PROVISIONING_STARTED",
        "design cannot be paused after provisioning starts",
      );
    }
    if (TERMINAL_STATUSES.has(current.status)) return current;
    if (current.status === "paused") return current;
    return this.update(key, { status: "paused", autoPaused: false }, {
      ...metadata,
      source: metadata.source ?? "user_explicit",
      changedPaths: metadata.changedPaths ?? ["/status"],
    });
  }

  resume(key, metadata = {}) {
    const current = this.get(key);
    if (!current) return null;
    if (current.status !== "paused") {
      throw new DepartmentDesignStoreError(
        "NOT_PAUSED",
        `design is not paused: ${current.status}`,
      );
    }
    return this.update(key, { status: "active", autoPaused: false }, {
      ...metadata,
      source: metadata.source ?? "user_explicit",
      changedPaths: metadata.changedPaths ?? ["/status"],
    });
  }

  cancel(key, metadata = {}) {
    const current = this.get(key);
    if (!current) return null;
    if (current.status === "provisioning") {
      throw new DepartmentDesignStoreError(
        "PROVISIONING_STARTED",
        "design cannot be cancelled after provisioning starts",
      );
    }
    if (TERMINAL_STATUSES.has(current.status)) return current;
    return this.update(key, { status: "cancelled", phase: "cancelled" }, {
      ...metadata,
      source: metadata.source ?? "user_explicit",
      changedPaths: metadata.changedPaths ?? ["/status", "/phase"],
    });
  }

  beginProvisioning(key, { actorId, confirmationText } = {}) {
    const current = this.get(key);
    if (!current) {
      throw new DepartmentDesignStoreError("NOT_FOUND", `design not found: ${key}`);
    }
    if (IMMUTABLE_STATUSES.has(current.status)) {
      throw new DepartmentDesignStoreError(
        "IMMUTABLE_STATE",
        `design cannot begin provisioning while ${current.status}`,
      );
    }
    if (current.phase !== "awaiting_final_confirmation") {
      throw new DepartmentDesignStoreError(
        "NOT_READY",
        `design is not awaiting final confirmation: ${current.phase}`,
      );
    }
    if (typeof actorId !== "string" || !actorId || typeof confirmationText !== "string") {
      throw new DepartmentDesignStoreError(
        "INVALID_CONFIRMATION",
        "actorId and confirmationText are required",
      );
    }
    const timestamp = this.now();
    return this.update(key, {
      status: "provisioning",
      phase: "provisioning",
      confirmation: {
        actorId,
        text: confirmationText,
        draftVersion: current.version,
        at: timestamp,
      },
    }, {
      actorId,
      source: "user_explicit",
      reason: "final department creation confirmed",
      changedPaths: ["/status", "/phase", "/confirmation"],
    });
  }

  completeProvisioning(key, { transactionId, receiptPath } = {}) {
    return this.#finishProvisioning(key, {
      status: "completed",
      phase: "completed",
      transactionId: transactionId ?? null,
      receiptPath: receiptPath ?? null,
      provisioningFailure: null,
    }, {
      reason: "department provisioning completed",
      changedPaths: ["/status", "/phase", "/transactionId", "/receiptPath"],
    });
  }

  failProvisioning(key, {
    transactionId,
    failedStage,
    errorMessage,
  } = {}) {
    return this.#finishProvisioning(key, {
      status: "needs_revision",
      phase: "awaiting_final_confirmation",
      transactionId: transactionId ?? null,
      provisioningFailure: {
        stage: failedStage ?? "provisioning",
        message: errorMessage ?? "department provisioning failed",
      },
    }, {
      reason: "department provisioning failed and candidate was retained",
      changedPaths: ["/status", "/phase", "/transactionId", "/provisioningFailure"],
    });
  }

  #autoPauseExpired() {
    if (!this.document) return;
    const timestamp = this.now();
    let changed = false;
    for (const state of Object.values(this.document.designs)) {
      if (
        (state.status === "active" || state.status === "needs_revision")
        && Number.isFinite(state.expiresAt)
        && state.expiresAt <= timestamp
      ) {
        state.status = "paused";
        state.autoPaused = true;
        state.expiresAt = null;
        state.updatedAt = timestamp;
        state.version += 1;
        state.history.push(auditEntry(state.version, {
          actorId: "system",
          source: "controller",
          reason: "inactivity auto-pause",
          changedPaths: ["/status", "/autoPaused"],
        }, timestamp));
        changed = true;
      }
    }
    if (changed) this.#persist();
  }

  #finishProvisioning(key, patch, metadata) {
    this.load();
    const current = this.document.designs[key];
    if (!current) {
      throw new DepartmentDesignStoreError("NOT_FOUND", `design not found: ${key}`);
    }
    if (current.status !== "provisioning") {
      throw new DepartmentDesignStoreError(
        "NOT_PROVISIONING",
        `design is not provisioning: ${current.status}`,
      );
    }
    const timestamp = this.now();
    const version = current.version + 1;
    const updated = {
      ...current,
      ...clone(patch),
      version,
      updatedAt: timestamp,
      expiresAt: patch.status === "needs_revision" ? timestamp + this.ttlMs : null,
      autoPaused: false,
      history: [
        ...current.history,
        auditEntry(version, {
          actorId: "system",
          source: "controller",
          ...metadata,
        }, timestamp),
      ],
    };
    this.document.designs[key] = updated;
    this.#persist();
    return clone(updated);
  }

  #persist() {
    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const mode = existsSync(this.filePath) ? statSync(this.filePath).mode : 0o600;
    writeFileSync(temporary, `${JSON.stringify(this.document, null, 2)}\n`, { mode });
    chmodSync(temporary, mode);
    const descriptor = openSync(temporary, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, this.filePath);
  }
}
