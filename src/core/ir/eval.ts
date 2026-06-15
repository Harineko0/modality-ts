import type { ExprIR, ModelState, Value } from "./types.js";

export class StatePredicateEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatePredicateEvalError";
  }
}

export function evalStatePredicate(expr: ExprIR, state: ModelState): boolean {
  return Boolean(evalExpr(expr, state));
}

function evalExpr(expr: ExprIR, state: ModelState): Value {
  switch (expr.kind) {
    case "lit":
      return expr.value;
    case "read":
      return readPath(state[expr.var], expr.path ?? []);
    case "eq":
      return (
        stableJson(evalExpr(expr.args[0], state)) ===
        stableJson(evalExpr(expr.args[1], state))
      );
    case "neq":
      return (
        stableJson(evalExpr(expr.args[0], state)) !==
        stableJson(evalExpr(expr.args[1], state))
      );
    case "and":
      return expr.args.every((arg) => Boolean(evalExpr(arg, state)));
    case "or":
      return expr.args.some((arg) => Boolean(evalExpr(arg, state)));
    case "not":
      return !evalExpr(expr.args[0], state);
    case "cond":
      return evalExpr(expr.args[0], state)
        ? evalExpr(expr.args[1], state)
        : evalExpr(expr.args[2], state);
    case "updateField":
      return writePath(
        evalExpr(expr.target, state),
        expr.path,
        evalExpr(expr.value, state),
      );
    case "tagIs": {
      const value = evalExpr(expr.arg, state);
      return tagMatches(value, expr.tag);
    }
    case "lenCat": {
      const value = evalExpr(expr.arg, state);
      if (!Array.isArray(value)) return "0";
      return value.length === 0 ? "0" : value.length === 1 ? "1" : "many";
    }
    case "freshToken":
      return false;
    case "readPre":
      throw new StatePredicateEvalError(
        "readPre is only valid in step predicates, not plain state predicates",
      );
    case "readOpArg":
      throw new StatePredicateEvalError(
        "readOpArg is only valid in step predicates, not plain state predicates",
      );
    case "transitionEnabled":
      throw new StatePredicateEvalError(
        "transitionEnabled is only valid in step predicates, not plain state predicates",
      );
    default: {
      const _exhaustive: never = expr;
      throw new StatePredicateEvalError(
        `unsupported expression kind: ${(_exhaustive as ExprIR).kind}`,
      );
    }
  }
}

function tagMatches(value: Value, expectedTag: string): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, Value>;
  const discriminant = record.kind;
  return typeof discriminant === "string" && discriminant === expectedTag;
}

function readPath(value: Value | undefined, path: readonly string[]): Value {
  let current: Value | undefined = value;
  for (const segment of path) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object" ||
      Array.isArray(current)
    ) {
      return null;
    }
    current = (current as Record<string, Value>)[segment];
  }
  return current ?? null;
}

function writePath(
  target: Value,
  path: readonly string[],
  value: Value,
): Value {
  if (path.length === 0) return value;
  const [head, ...tail] = path;
  const record =
    typeof target === "object" && target !== null && !Array.isArray(target)
      ? ({ ...(target as Record<string, Value>) } as Record<string, Value>)
      : ({} as Record<string, Value>);
  return {
    ...record,
    [head]: writePath(record[head] ?? null, tail, value),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
