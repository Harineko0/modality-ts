import { canonicalState } from "modality-ts/core";
import type { Model, ModelState, Value } from "modality-ts/core";

export function changedVars(pre: ModelState, post: ModelState): ReadonlySet<string> {
  const ids = new Set([...Object.keys(pre), ...Object.keys(post)]);
  return new Set([...ids].filter((id) => JSON.stringify(pre[id]) !== JSON.stringify(post[id])));
}

export function initialChangedVars(model: Model): ReadonlySet<string> {
  return new Set(model.vars.map((decl) => decl.id));
}

export function compareStates(model: Model): (a: ModelState, b: ModelState) => number {
  return (a, b) => canonicalState(model, a).localeCompare(canonicalState(model, b));
}

export function diff(pre: ModelState, post: ModelState): Record<string, { before: Value | undefined; after: Value | undefined }> {
  const ids = new Set([...Object.keys(pre), ...Object.keys(post)]);
  return Object.fromEntries(
    [...ids]
      .filter((id) => JSON.stringify(pre[id]) !== JSON.stringify(post[id]))
      .map((id) => [id, { before: pre[id], after: post[id] }])
  );
}

export function uniqueStabilizingStates<T extends { state: ModelState }>(model: Model, states: readonly T[]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const candidate of states) {
    const canon = canonicalState(model, candidate.state);
    if (!seen.has(canon)) {
      seen.add(canon);
      out.push(candidate);
    }
  }
  return out;
}
