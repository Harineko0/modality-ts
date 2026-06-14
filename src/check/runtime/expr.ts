import type { ExprIR, Model, ModelState, Transition, Value } from "modality-ts/core";
import { taggedDomainForExpr } from "./domains.js";
import { readPath, writePath } from "./paths.js";
import { freshToken } from "./tokens.js";

export interface EvalOptions {
  onBoundHit?: (hit: string) => void;
}

export function evalExpr(model: Model, state: ModelState, expr: ExprIR, options: EvalOptions = {}): Value {
  switch (expr.kind) {
    case "lit":
      return expr.value;
    case "read":
      return readPath(state[expr.var], expr.path ?? []);
    case "eq":
      return JSON.stringify(evalExpr(model, state, expr.args[0], options)) === JSON.stringify(evalExpr(model, state, expr.args[1], options));
    case "neq":
      return JSON.stringify(evalExpr(model, state, expr.args[0], options)) !== JSON.stringify(evalExpr(model, state, expr.args[1], options));
    case "and":
      return expr.args.every((arg) => Boolean(evalExpr(model, state, arg, options)));
    case "or":
      return expr.args.some((arg) => Boolean(evalExpr(model, state, arg, options)));
    case "not":
      return !Boolean(evalExpr(model, state, expr.args[0], options));
    case "cond":
      return Boolean(evalExpr(model, state, expr.args[0], options))
        ? evalExpr(model, state, expr.args[1], options)
        : evalExpr(model, state, expr.args[2], options);
    case "updateField":
      return writePath(evalExpr(model, state, expr.target, options), expr.path, evalExpr(model, state, expr.value, options));
    case "tagIs": {
      const arg = evalExpr(model, state, expr.arg, options);
      const domain = taggedDomainForExpr(model, expr.arg);
      return isRecord(arg) && domain !== undefined && arg[domain.tag] === expr.tag;
    }
    case "lenCat": {
      const arg = evalExpr(model, state, expr.arg, options);
      if (!Array.isArray(arg)) return "0";
      return arg.length === 0 ? "0" : arg.length === 1 ? "1" : "many";
    }
    case "freshToken":
      return freshToken(model, state, expr.domainOf);
  }
}

export function guardHolds(model: Model, transition: Transition, state: ModelState): boolean {
  return Boolean(evalExpr(model, state, transition.guard));
}

function isRecord(value: Value): value is Record<string, Value> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
