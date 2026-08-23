#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { DepartmentDesignStore } from "./department-design-store.mjs";
import {
  ALLOWED_DRAFT_FIELDS,
  assertDepartmentDraft,
} from "./department-draft-schema.mjs";

const MAX_OPERATIONS = 100;
const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function parseArguments(argv) {
  const options = {};
  let command = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const name = token.slice(2);
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing value for --${name}`);
      options[name] = value;
      index += 1;
    } else if (!command) {
      command = token;
    } else {
      throw new Error(`unexpected argument: ${token}`);
    }
  }
  if (!command) throw new Error("command is required");
  if (!options.store) throw new Error("--store is required");
  if (!options["session-key"]) throw new Error("--session-key is required");
  return { command, options };
}

function parsePointer(pointer) {
  if (typeof pointer !== "string" || (pointer !== "/draft" && !pointer.startsWith("/draft/"))) {
    throw new Error(`path must be /draft or below: ${pointer}`);
  }
  const segments = pointer.slice(1).split("/").map((segment) => (
    segment.replaceAll("~1", "/").replaceAll("~0", "~")
  ));
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    throw new Error(`prototype path segment is forbidden: ${pointer}`);
  }
  if (segments.length > 1 && !ALLOWED_DRAFT_FIELDS.has(segments[1])) {
    throw new Error(`unknown draft path: ${pointer}`);
  }
  return segments.slice(1);
}

function containerAt(root, segments, { create = false } = {}) {
  let current = root;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") {
      throw new Error(`path crosses a non-container at ${segment}`);
    }
    if (!(segment in current)) {
      if (!create) throw new Error(`path does not exist at ${segment}`);
      current[segment] = {};
    }
    current = current[segment];
  }
  return current;
}

function applyOperation(draft, operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new Error("operation must be an object");
  }
  const segments = parsePointer(operation.path);
  if (segments.length === 0) {
    if (!["set", "replace"].includes(operation.op)) {
      throw new Error("/draft only supports set or replace");
    }
    if (!operation.value || typeof operation.value !== "object" || Array.isArray(operation.value)) {
      throw new Error("draft value must be an object");
    }
    for (const key of Object.keys(operation.value)) {
      if (FORBIDDEN_SEGMENTS.has(key) || !ALLOWED_DRAFT_FIELDS.has(key)) {
        throw new Error(`unknown or prototype draft path: /draft/${key}`);
      }
    }
    return structuredClone(operation.value);
  }

  const parentSegments = segments.slice(0, -1);
  const key = segments.at(-1);
  const parent = containerAt(draft, parentSegments, { create: operation.op === "set" });
  if (parent == null || typeof parent !== "object") throw new Error(`invalid path: ${operation.path}`);

  if (operation.op === "set") {
    parent[key] = structuredClone(operation.value);
  } else if (operation.op === "replace") {
    if (!(key in parent)) throw new Error(`replace path does not exist: ${operation.path}`);
    parent[key] = structuredClone(operation.value);
  } else if (operation.op === "append") {
    if (!(key in parent)) parent[key] = [];
    if (!Array.isArray(parent[key])) throw new Error(`append path is not an array: ${operation.path}`);
    parent[key].push(structuredClone(operation.value));
  } else if (operation.op === "remove") {
    if (!(key in parent)) throw new Error(`remove path does not exist: ${operation.path}`);
    if (Array.isArray(parent)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
        throw new Error(`invalid array path: ${operation.path}`);
      }
      parent.splice(index, 1);
    } else {
      delete parent[key];
    }
  } else {
    throw new Error(`unsupported operation: ${operation.op}`);
  }
  return draft;
}

function readTurn(inputPath) {
  const raw = inputPath === "-" ? readFileSync(0, "utf8") : readFileSync(inputPath, "utf8");
  const turn = JSON.parse(raw);
  if (!turn || typeof turn !== "object" || !Array.isArray(turn.operations)) {
    throw new Error("turn must contain operations");
  }
  if (turn.operations.length > MAX_OPERATIONS) {
    throw new Error(`a turn may contain at most ${MAX_OPERATIONS} operations`);
  }
  return turn;
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  const store = new DepartmentDesignStore(options.store);
  const key = options["session-key"];
  const actorId = options["actor-id"] ?? "assistant";
  const current = store.get(key);
  if (!current) throw new Error(`design session not found: ${key}`);

  if (command === "show") {
    output(current);
    return;
  }
  if (command === "apply-turn") {
    if (!options["input-json"]) throw new Error("--input-json is required");
    const turn = readTurn(options["input-json"]);
    let draft = structuredClone(current.draft ?? {});
    const proposedName = turn.operations.reduce((value, operation) => {
      if (operation.path === "/draft/departmentName" && ["set", "replace"].includes(operation.op)) {
        return operation.value;
      }
      if (
        operation.path === "/draft"
        && ["set", "replace"].includes(operation.op)
        && operation.value
        && typeof operation.value === "object"
        && Object.hasOwn(operation.value, "departmentName")
      ) {
        return operation.value.departmentName;
      }
      return value;
    }, current.draft?.departmentName);
    if (
      proposedName !== current.draft?.departmentName
      && turn.source !== "user_explicit"
    ) {
      throw new Error("department name may only come from an explicit user statement");
    }
    for (const operation of turn.operations) draft = applyOperation(draft, operation);
    const changedPaths = turn.operations.map((operation) => operation.path);
    output(store.update(key, { draft, phase: "designing", status: "active" }, {
      actorId,
      source: typeof turn.source === "string" ? turn.source : "ai_proposal",
      reason: typeof turn.reason === "string" ? turn.reason : "draft turn applied",
      changedPaths,
    }));
    return;
  }
  if (command === "mark-ready") {
    const draft = assertDepartmentDraft(current.draft, { requireReady: true });
    output(store.update(key, {
      draft,
      phase: "awaiting_final_confirmation",
      status: "active",
    }, {
      actorId,
      source: "ai_proposal",
      reason: "draft validated and presented for final confirmation",
      changedPaths: ["/draft", "/phase"],
    }));
    return;
  }
  if (command === "pause") {
    output(store.pause(key, { actorId, reason: "department design paused" }));
    return;
  }
  if (command === "resume") {
    output(store.resume(key, { actorId, reason: "department design resumed" }));
    return;
  }
  throw new Error(`unknown command: ${command}`);
}

try {
  main();
} catch (error) {
  if (error?.errors) process.stderr.write(`${JSON.stringify(error.errors)}\n`);
  else process.stderr.write(`${error?.message ?? error}\n`);
  process.exitCode = 1;
}
