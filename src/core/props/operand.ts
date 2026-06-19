import type { AbstractDomain, ExprIR, Value } from "../ir/types.js";

export interface Variable<D = AbstractDomain, Id extends string = string> {
  readonly __modalityVar: true;
  readonly varId: Id;
  readonly path?: readonly string[];
  readonly domain?: D;
  /** Extend the handle with nested path segments (record fields / list indices). */
  at(...segments: readonly string[]): Variable<D, Id>;
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

export type Operand = ExprIR | Variable | Value;

function createVariable<const Id extends string = string, D = AbstractDomain>(
  varId: Id,
  domain?: D,
  path?: readonly string[],
): Variable<D, Id> {
  return {
    __modalityVar: true,
    varId,
    ...(path !== undefined ? { path } : {}),
    ...(domain !== undefined ? { domain } : {}),
    at(...segments: readonly string[]): Variable<D, Id> {
      return createVariable(varId, domain, [...(path ?? []), ...segments]);
    },
  };
}

export { createVariable as variable };

export function isVariable(value: unknown): value is Variable {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Variable).__modalityVar === true
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
  if (isVariable(op)) {
    return {
      kind: "read",
      var: op.varId,
      ...(op.path ? { path: op.path } : {}),
    };
  }
  if (isExprIR(op)) return op;
  return { kind: "lit", value: op };
}
