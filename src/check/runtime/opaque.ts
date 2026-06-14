import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { validateValue } from "modality-ts/core";
import type { Model, ModelState, OpaqueRef, Value } from "modality-ts/core";

type OpaqueEffectFn = (state: Readonly<ModelState>) => ModelState | ModelState[];

const require = createRequire(import.meta.url);
const opaqueCache = new Map<string, OpaqueEffectFn>();

export function applyOpaqueEffect(model: Model, state: ModelState, ref: OpaqueRef): ModelState[] {
  const fn = loadOpaqueEffect(ref);
  const first = normalizeOpaqueResults(fn(deepFreeze(cloneValue(state)) as Readonly<ModelState>));
  const second = normalizeOpaqueResults(fn(deepFreeze(cloneValue(state)) as Readonly<ModelState>));
  if (JSON.stringify(first) !== JSON.stringify(second)) {
    throw new Error(`Opaque effect ${ref.module}#${ref.export} returned nondeterministic results for identical input`);
  }
  return first.map((candidate, index) => validateOpaqueState(model, state, candidate, ref, index));
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
