import type { AbstractDomain, ExprIR, Value } from "../ir/types.js";

export interface VarHandle<D = AbstractDomain, Id extends string = string> {
  readonly __modalityVar: true;
  readonly varId: Id;
  readonly path?: readonly string[];
  readonly domain?: D;
  /** Extend the handle with nested path segments (record fields / list indices). */
  at(...segments: readonly string[]): VarHandle<D, Id>;
}

const EXPR_IR_KINDS = new Set([
  "lit",
  "read",
  "readPre",
  "readOpArg",
  "eq",
  "neq",
  "and",
  "or",
  "not",
  "cond",
  "updateField",
  "tagIs",
  "lenCat",
  "freshToken",
  "transitionEnabled",
  "transitionEnabledPrefix",
  "lt",
  "lte",
  "gt",
  "gte",
  "add",
  "sub",
  "mod",
]);

export type Operand = ExprIR | VarHandle | Value;

export function varHandle<const Id extends string = string, D = AbstractDomain>(
  varId: Id,
  domain?: D,
  path?: readonly string[],
): VarHandle<D, Id> {
  return {
    __modalityVar: true,
    varId,
    ...(path !== undefined ? { path } : {}),
    ...(domain !== undefined ? { domain } : {}),
    at(...segments: readonly string[]): VarHandle<D, Id> {
      return varHandle(varId, domain, [...(path ?? []), ...segments]);
    },
  };
}

export function isVarHandle(value: unknown): value is VarHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as VarHandle).__modalityVar === true
  );
}

export function isExprIR(value: unknown): value is ExprIR {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as ExprIR).kind === "string" &&
    EXPR_IR_KINDS.has((value as ExprIR).kind)
  );
}

export function lift(op: Operand): ExprIR {
  if (isVarHandle(op)) {
    return {
      kind: "read",
      var: op.varId,
      ...(op.path ? { path: op.path } : {}),
    };
  }
  if (isExprIR(op)) return op;
  return { kind: "lit", value: op };
}
