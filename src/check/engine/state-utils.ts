import { canonicalState } from "modality-ts/core";
import type { Model, ModelState, Value } from "modality-ts/core";

const EMPTY_CHANGED_VARS: ReadonlySet<string> = new Set();

export function changedVars(
  pre: ModelState,
  post: ModelState,
  model?: Model,
): ReadonlySet<string> {
  const varIds =
    model?.vars.map((decl) => decl.id) ??
    [...new Set([...Object.keys(pre), ...Object.keys(post)])];
  const changed = varIds.filter(
    (id) => JSON.stringify(pre[id]) !== JSON.stringify(post[id]),
  );
  if (changed.length === 0) return EMPTY_CHANGED_VARS;
  return new Set(changed);
}

export function initialChangedVars(model: Model): ReadonlySet<string> {
  return new Set(model.vars.map((decl) => decl.id));
}

export function compareStates(
  model: Model,
): (a: ModelState, b: ModelState) => number {
  return (a, b) =>
    canonicalState(model, a).localeCompare(canonicalState(model, b));
}

export function sortStatesByCanon(
  states: readonly ModelState[],
  canon: (state: ModelState) => string,
): ModelState[] {
  return states
    .map((state) => ({ state, canon: canon(state) }))
    .sort((left, right) => left.canon.localeCompare(right.canon))
    .map(({ state }) => state);
}

export function diff(
  pre: ModelState,
  post: ModelState,
): Record<string, { before: Value | undefined; after: Value | undefined }> {
  const ids = new Set([...Object.keys(pre), ...Object.keys(post)]);
  return Object.fromEntries(
    [...ids]
      .filter((id) => JSON.stringify(pre[id]) !== JSON.stringify(post[id]))
      .map((id) => [id, { before: pre[id], after: post[id] }]),
  );
}

export function uniqueStabilizingStates<T extends { state: ModelState }>(
  model: Model,
  states: readonly T[],
  canon?: (state: ModelState) => string,
): T[] {
  const encode = canon ?? ((state: ModelState) => canonicalState(model, state));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const candidate of states) {
    const key = encode(candidate.state);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(candidate);
    }
  }
  return out;
}
