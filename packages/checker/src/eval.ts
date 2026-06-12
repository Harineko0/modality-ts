import { enumerateDomain } from "@modality/kernel";
import type { EffectIR, ExprIR, Model, ModelState, Transition, Value } from "@modality/kernel";

export interface PendingOp {
  [key: string]: Value;
  opId: string;
  continuation: string;
  args: Record<string, Value>;
}

export function evalExpr(model: Model, state: ModelState, expr: ExprIR): Value {
  switch (expr.kind) {
    case "lit":
      return expr.value;
    case "read":
      return readPath(state[expr.var], expr.path ?? []);
    case "eq":
      return JSON.stringify(evalExpr(model, state, expr.args[0])) === JSON.stringify(evalExpr(model, state, expr.args[1]));
    case "neq":
      return JSON.stringify(evalExpr(model, state, expr.args[0])) !== JSON.stringify(evalExpr(model, state, expr.args[1]));
    case "and":
      return expr.args.every((arg) => Boolean(evalExpr(model, state, arg)));
    case "or":
      return expr.args.some((arg) => Boolean(evalExpr(model, state, arg)));
    case "not":
      return !Boolean(evalExpr(model, state, expr.args[0]));
    case "cond":
      return Boolean(evalExpr(model, state, expr.args[0])) ? evalExpr(model, state, expr.args[1]) : evalExpr(model, state, expr.args[2]);
    case "updateField":
      return writePath(evalExpr(model, state, expr.target), expr.path, evalExpr(model, state, expr.value));
    case "tagIs": {
      const arg = evalExpr(model, state, expr.arg);
      return typeof arg === "object" && arg !== null && !Array.isArray(arg) && Object.values(arg).includes(expr.tag);
    }
    case "lenCat": {
      const arg = evalExpr(model, state, expr.arg);
      if (!Array.isArray(arg)) return "0";
      return arg.length === 0 ? "0" : arg.length === 1 ? "1" : "many";
    }
    case "freshToken": {
      const decl = model.vars.find((candidate) => candidate.id === expr.domainOf);
      if (!decl || decl.domain.kind !== "tokens") throw new Error(`freshToken domainOf must reference token var: ${expr.domainOf}`);
      const names = enumerateDomain(decl.domain) as string[];
      const used = new Set<string>();
      for (const value of Object.values(state)) collectTokens(value, used);
      return names.find((name) => !used.has(name)) ?? names[names.length - 1];
    }
  }
}

export function guardHolds(model: Model, transition: Transition, state: ModelState): boolean {
  return Boolean(evalExpr(model, state, transition.guard));
}

export function applyEffect(model: Model, state: ModelState, effect: EffectIR): ModelState[] {
  switch (effect.kind) {
    case "assign":
      return [{ ...state, [effect.var]: evalExpr(model, state, effect.expr) }];
    case "havoc": {
      const decl = mustVar(model, effect.var);
      return enumerateDomain(decl.domain).map((value) => ({ ...state, [effect.var]: value }));
    }
    case "choose":
      return effect.among.map((expr) => ({ ...state, [effect.var]: evalExpr(model, state, expr) }));
    case "if":
      return applyEffect(model, state, Boolean(evalExpr(model, state, effect.cond)) ? effect.then : effect.else);
    case "seq":
      return effect.effects.reduce<ModelState[]>((states, next) => states.flatMap((candidate) => applyEffect(model, candidate, next)), [state]);
    case "enqueue": {
      const pending = readPending(state);
      if (pending.length >= model.bounds.maxPending) return [];
      const op: PendingOp = {
        opId: effect.op,
        continuation: effect.continuation,
        args: Object.fromEntries(Object.entries(effect.args).map(([k, expr]) => [k, evalExpr(model, state, expr)]))
      };
      return [{ ...state, "sys:pending": [...pending, op] }];
    }
    case "dequeue": {
      const pending = readPending(state);
      if (effect.index < 0 || effect.index >= pending.length) return [state];
      return [{ ...state, "sys:pending": pending.filter((_, i) => i !== effect.index) }];
    }
    case "navigate":
      return navigate(model, state, effect);
    case "opaque":
      throw new Error(`Opaque effects are not executable in this MVP checker: ${effect.ref.module}#${effect.ref.export}`);
  }
}

export function readPending(state: ModelState): PendingOp[] {
  const pending = state["sys:pending"];
  return Array.isArray(pending) ? (pending as PendingOp[]) : [];
}

function navigate(model: Model, state: ModelState, effect: Extract<EffectIR, { kind: "navigate" }>): ModelState[] {
  const route = state["sys:route"];
  const history = Array.isArray(state["sys:history"]) ? state["sys:history"] : [];
  if (effect.mode === "back") {
    const previous = history[history.length - 1];
    if (typeof previous !== "string") return [state];
    return [{ ...state, "sys:route": previous, "sys:history": history.slice(0, -1) }];
  }
  const to = effect.to ? evalExpr(model, state, effect.to) : undefined;
  if (typeof to !== "string") return [state];
  const nextHistory = effect.mode === "push" && typeof route === "string" ? [...history, route] : history;
  return [{ ...state, "sys:route": to, "sys:history": nextHistory }];
}

function readPath(value: Value | undefined, path: readonly string[]): Value {
  let current: unknown = value;
  for (const segment of path) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (current && typeof current === "object") current = (current as Record<string, Value>)[segment];
    else return undefined as unknown as Value;
  }
  return current as Value;
}

function writePath(target: Value, path: readonly string[], value: Value): Value {
  if (path.length === 0) return value;
  const [head, ...tail] = path;
  if (Array.isArray(target)) {
    const copy = [...target];
    copy[Number(head)] = writePath(copy[Number(head)], tail, value);
    return copy;
  }
  const base = target && typeof target === "object" ? target : {};
  return { ...base, [head]: writePath((base as Record<string, Value>)[head], tail, value) };
}

function collectTokens(value: Value, out: Set<string>): void {
  if (typeof value === "string" && /^tok\d+$/.test(value)) out.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectTokens(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectTokens(item, out));
}

function mustVar(model: Model, id: string) {
  const decl = model.vars.find((candidate) => candidate.id === id);
  if (!decl) throw new Error(`Unknown var ${id}`);
  return decl;
}
