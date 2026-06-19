import type { EffectIR } from "modality-ts/core";

export const EMPTY_EFFECT: EffectIR = { kind: "seq", effects: [] };

export function isEmptyEffect(effect: EffectIR): boolean {
  return effect.kind === "seq" && effect.effects.length === 0;
}

/**
 * Project an effect onto a set of retained variables (cone-of-influence
 * assignment projection).
 *
 * Separable single-variable writes (`assign`, `havoc`, `choose`) targeting a
 * variable outside `retained` are dropped. Atomic multi-writes (`opaque`) are
 * kept whole whenever any of their declared writes is retained, so the slice
 * closure must also retain their co-written variables. `enqueue`/`dequeue`
 * pending-queue effects are left untouched here; pending-queue stripping is
 * handled separately by the slice finalizer.
 *
 * Soundness: dropping assignments to variables that no retained guard, effect,
 * mount condition, or property predicate reads yields a property-equivalent
 * reduced model. The slice closure is responsible for ensuring every variable
 * read by a kept statement is itself retained, so projection never references a
 * pruned variable.
 */
export function projectEffectToVars(
  effect: EffectIR,
  retained: ReadonlySet<string>,
): EffectIR {
  switch (effect.kind) {
    case "assign":
    case "havoc":
    case "choose":
      return retained.has(effect.var) ? effect : EMPTY_EFFECT;
    case "opaque":
      return effect.ref.declaredWrites.some((write) => retained.has(write))
        ? effect
        : EMPTY_EFFECT;
    case "seq": {
      const kept = effect.effects
        .map((child) => projectEffectToVars(child, retained))
        .filter((child) => !isEmptyEffect(child));
      if (kept.length === 0) return EMPTY_EFFECT;
      if (kept.length === 1) return kept[0]!;
      return { kind: "seq", effects: kept };
    }
    case "if": {
      const thenBranch = projectEffectToVars(effect.then, retained);
      const elseBranch = projectEffectToVars(effect.else, retained);
      if (isEmptyEffect(thenBranch) && isEmptyEffect(elseBranch)) {
        return EMPTY_EFFECT;
      }
      return {
        kind: "if",
        cond: effect.cond,
        // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
        then: thenBranch,
        else: elseBranch,
      };
    }
    case "enqueue":
    case "dequeue":
      return effect;
  }
}
