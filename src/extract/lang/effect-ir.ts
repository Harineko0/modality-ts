import type { EffectIR } from "modality-ts/core";

export interface EffectSummaryLike {
  effect: EffectIR;
  reads: string[];
}

export function identityEffect(): Extract<EffectIR, { kind: "seq" }> {
  return { kind: "seq", effects: [] };
}

export function effectFromSummaries(
  summaries: readonly EffectSummaryLike[],
): EffectIR {
  const effects = summaries.map((summary) => summary.effect);
  if (effects.length === 0) return identityEffect();
  const effect = effects[0];
  return effects.length === 1 && effect ? effect : { kind: "seq", effects };
}
