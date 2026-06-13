import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { enumerateDomain, initialValues, UNMOUNTED, validateValue } from "modality-ts/kernel";
import type { AbstractDomain, EffectIR, ExprIR, Model, ModelState, OpaqueRef, Transition, Value } from "modality-ts/kernel";

export interface PendingOp {
  [key: string]: Value;
  opId: string;
  continuation: string;
  args: Record<string, Value>;
}

export interface EvalOptions {
  onBoundHit?: (hit: string) => void;
}

type OpaqueEffectFn = (state: Readonly<ModelState>) => ModelState | ModelState[];

const require = createRequire(import.meta.url);
const opaqueCache = new Map<string, OpaqueEffectFn>();

class TokenExhausted extends Error {
  constructor(readonly domainOf: string) {
    super(`token cap exhausted for ${domainOf}`);
  }
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
      return Boolean(evalExpr(model, state, expr.args[0], options)) ? evalExpr(model, state, expr.args[1], options) : evalExpr(model, state, expr.args[2], options);
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
    case "freshToken": {
      const decl = model.vars.find((candidate) => candidate.id === expr.domainOf);
      if (!decl || decl.domain.kind !== "tokens") throw new Error(`freshToken domainOf must reference token var: ${expr.domainOf}`);
      const names = enumerateDomain(decl.domain) as string[];
      const tokenSet = new Set(names);
      const used = new Set<string>();
      for (const value of Object.values(state)) collectTokens(value, used, tokenSet);
      const fresh = names.find((name) => !used.has(name));
      if (!fresh) throw new TokenExhausted(expr.domainOf);
      return fresh;
    }
  }
}

export function guardHolds(model: Model, transition: Transition, state: ModelState): boolean {
  return Boolean(evalExpr(model, state, transition.guard));
}

export function applyEffect(model: Model, state: ModelState, effect: EffectIR, options: EvalOptions = {}): ModelState[] {
  try {
    return applyEffectUnsafe(model, state, effect, options);
  } catch (error) {
    if (error instanceof TokenExhausted) {
      options.onBoundHit?.(`token cap exhausted for ${error.domainOf}`);
      return [];
    }
    throw error;
  }
}

function applyEffectUnsafe(model: Model, state: ModelState, effect: EffectIR, options: EvalOptions): ModelState[] {
  switch (effect.kind) {
    case "assign":
      return [{ ...state, [effect.var]: evalExpr(model, state, effect.expr, options) }];
    case "havoc": {
      const decl = mustVar(model, effect.var);
      return enumerateDomain(decl.domain).map((value) => ({ ...state, [effect.var]: value }));
    }
    case "choose":
      return effect.among.map((expr) => ({ ...state, [effect.var]: evalExpr(model, state, expr, options) }));
    case "if":
      return applyEffect(model, state, Boolean(evalExpr(model, state, effect.cond, options)) ? effect.then : effect.else, options);
    case "seq":
      return effect.effects.reduce<ModelState[]>((states, next) => states.flatMap((candidate) => applyEffect(model, candidate, next, options)), [state]);
    case "enqueue": {
      const pending = readPending(state);
      if (pending.length >= model.bounds.maxPending) return [];
      const op: PendingOp = {
        opId: effect.op,
        continuation: effect.continuation,
        args: Object.fromEntries(Object.entries(effect.args).map(([k, expr]) => [k, evalExpr(model, state, expr, options)]))
      };
      return [{ ...state, "sys:pending": [...pending, op] }];
    }
    case "dequeue": {
      const pending = readPending(state);
      if (effect.index < 0 || effect.index >= pending.length) return [state];
      return [{ ...state, "sys:pending": pending.filter((_, i) => i !== effect.index) }];
    }
    case "navigate":
      return navigate(model, state, effect, options);
    case "opaque":
      return applyOpaqueEffect(model, state, effect.ref);
  }
}

export function readPending(state: ModelState): PendingOp[] {
  const pending = state["sys:pending"];
  return Array.isArray(pending) ? (pending as PendingOp[]) : [];
}

function navigate(model: Model, state: ModelState, effect: Extract<EffectIR, { kind: "navigate" }>, options: EvalOptions): ModelState[] {
  const route = state["sys:route"];
  const history = Array.isArray(state["sys:history"]) ? state["sys:history"] : [];
  if (effect.mode === "back") {
    const previous = history[history.length - 1];
    if (typeof previous !== "string") return [state];
    return resetRouteLocals(model, { ...state, "sys:route": previous, "sys:history": history.slice(0, -1) }, route);
  }
  const to = effect.to ? evalExpr(model, state, effect.to) : undefined;
  if (typeof to !== "string") return [state];
  const historyDecl = model.vars.find((decl) => decl.id === "sys:history");
  const historyCap = historyDecl?.domain.kind === "boundedList" ? historyDecl.domain.maxLen : undefined;
  if (effect.mode === "push" && historyCap !== undefined && history.length >= historyCap) {
    options.onBoundHit?.("history cap saturated");
    return [];
  }
  const nextHistory = effect.mode === "push" && typeof route === "string" ? [...history, route] : history;
  return resetRouteLocals(model, { ...state, "sys:route": to, "sys:history": nextHistory }, route);
}

export function normalizeInitialRouteLocals(model: Model, state: ModelState): ModelState[] {
  return resetRouteLocals(model, state, undefined, { preserveMounted: true });
}

function resetRouteLocals(model: Model, state: ModelState, previousRoute: Value | undefined, options: { preserveMounted?: boolean } = {}): ModelState[] {
  const currentRoute = state["sys:route"];
  if (previousRoute === currentRoute) return [state];
  let states = [state];
  for (const decl of model.vars) {
    if (decl.scope.kind !== "route-local") continue;
    if (decl.scope.route === currentRoute) {
      if (options.preserveMounted) continue;
      states = states.flatMap((candidate) => initialValues(decl.domain, decl.initial).map((value) => ({ ...candidate, [decl.id]: value })));
    } else {
      states = states.map((candidate) => ({ ...candidate, [decl.id]: UNMOUNTED }));
    }
  }
  return states;
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

function taggedDomainForExpr(model: Model, expr: ExprIR): Extract<AbstractDomain, { kind: "tagged" }> | undefined {
  const domain = domainForExpr(model, expr);
  return domain?.kind === "tagged" ? domain : undefined;
}

function domainForExpr(model: Model, expr: ExprIR): AbstractDomain | undefined {
  switch (expr.kind) {
    case "read": {
      const decl = model.vars.find((candidate) => candidate.id === expr.var);
      return decl ? domainAtPath(decl.domain, expr.path ?? []) : undefined;
    }
    case "cond": {
      const thenDomain = domainForExpr(model, expr.args[1]);
      const elseDomain = domainForExpr(model, expr.args[2]);
      return thenDomain && elseDomain && JSON.stringify(thenDomain) === JSON.stringify(elseDomain) ? thenDomain : undefined;
    }
    case "updateField":
      return domainForExpr(model, expr.target);
    default:
      return undefined;
  }
}

function domainAtPath(domain: AbstractDomain, path: readonly string[]): AbstractDomain | undefined {
  let current: AbstractDomain | undefined = domain;
  for (const segment of path) {
    if (!current) return undefined;
    while (current.kind === "option") current = current.inner;
    if (current.kind === "record") current = current.fields[segment];
    else if (current.kind === "boundedList") {
      if (!/^\d+$/.test(segment)) return undefined;
      const index = Number(segment);
      current = index >= 0 && index < current.maxLen ? current.inner : undefined;
    } else if (current.kind === "tagged") {
      current = segment === current.tag ? { kind: "enum", values: Object.keys(current.variants) } : undefined;
    } else return undefined;
  }
  return current;
}

function isRecord(value: Value): value is Record<string, Value> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectTokens(value: Value, out: Set<string>, tokenSet: ReadonlySet<string>): void {
  if (typeof value === "string" && tokenSet.has(value)) out.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectTokens(item, out, tokenSet));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectTokens(item, out, tokenSet));
}

function applyOpaqueEffect(model: Model, state: ModelState, ref: OpaqueRef): ModelState[] {
  const fn = loadOpaqueEffect(ref);
  const first = normalizeOpaqueResults(fn(deepFreeze(cloneValue(state)) as Readonly<ModelState>));
  const second = normalizeOpaqueResults(fn(deepFreeze(cloneValue(state)) as Readonly<ModelState>));
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error(`Opaque effect ${ref.module}#${ref.export} returned nondeterministic results for identical input`);
  }
  const states = first;
  return states.map((candidate, index) => validateOpaqueState(model, state, candidate, ref, index));
}

function normalizeOpaqueResults(results: ModelState | ModelState[]): ModelState[] {
  return Array.isArray(results) ? results : [results];
}

function loadOpaqueEffect(ref: OpaqueRef): OpaqueEffectFn {
  const key = `${ref.module}#${ref.export}`;
  const cached = opaqueCache.get(key);
  if (cached) return cached;
  const modulePath = isAbsolute(ref.module) ? ref.module : resolve(process.cwd(), ref.module);
  const moduleValue = require(modulePath) as Record<string, unknown>;
  const fn = moduleValue[ref.export];
  if (typeof fn !== "function") throw new Error(`Opaque effect ${key} does not export a function`);
  opaqueCache.set(key, fn as OpaqueEffectFn);
  return fn as OpaqueEffectFn;
}

function validateOpaqueState(model: Model, pre: ModelState, post: ModelState, ref: OpaqueRef, index: number): ModelState {
  if (!post || typeof post !== "object" || Array.isArray(post)) {
    throw new Error(`Opaque effect ${ref.module}#${ref.export} result ${index} must be a state object`);
  }
  const declaredWrites = new Set(ref.declaredWrites);
  const varIds = new Set(model.vars.map((decl) => decl.id));
  for (const key of Object.keys(post)) {
    if (!varIds.has(key)) throw new Error(`Opaque effect ${ref.module}#${ref.export} wrote unknown var ${key}`);
  }
  for (const decl of model.vars) {
    if (!Object.hasOwn(post, decl.id)) throw new Error(`Opaque effect ${ref.module}#${ref.export} result ${index} omitted var ${decl.id}`);
    if (!validateValue(decl.domain, post[decl.id]!)) {
      throw new Error(`Opaque effect ${ref.module}#${ref.export} produced invalid value for ${decl.id}: ${JSON.stringify(post[decl.id])}`);
    }
  }
  for (const id of changedKeys(pre, post)) {
    if (!declaredWrites.has(id)) throw new Error(`Opaque effect ${ref.module}#${ref.export} wrote undeclared var ${id}`);
  }
  return post;
}

function changedKeys(left: ModelState, right: ModelState): string[] {
  const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...ids].filter((id) => JSON.stringify(left[id]) !== JSON.stringify(right[id]));
}

function cloneValue<T extends Value | ModelState>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function mustVar(model: Model, id: string) {
  const decl = model.vars.find((candidate) => candidate.id === id);
  if (!decl) throw new Error(`Unknown var ${id}`);
  return decl;
}
