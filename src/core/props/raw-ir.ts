import type { ExprIR, Value } from "../ir/types.js";

/**
 * Low-level IR expression builders.
 *
 * These construct raw {@link ExprIR} nodes by string var id and are intentionally
 * NOT part of the authoring API (`modality-ts/properties`). Property authors reference
 * state through typed handles instead — `s(Component).field`, `variable(id)`, and
 * `pre(handle)` — so that imports stay symbol-based and rename-safe.
 *
 * They remain available from `modality-ts/core` for internal model/IR construction and
 * for tests that build hand-written models directly.
 */
export function readVar(varId: string, path?: readonly string[]): ExprIR {
  return { kind: "read", var: varId, path };
}

export function readPreVar(varId: string, path?: readonly string[]): ExprIR {
  return { kind: "readPre", var: varId, path };
}

export function lit(value: Value): ExprIR {
  return { kind: "lit", value };
}
