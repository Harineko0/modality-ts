import type { EffectIR, ExprIR, Value } from "modality-ts/core";

export interface EffectSummaryLike {
  effect: EffectIR;
  reads: string[];
}

export const PENDING_QUEUE_VAR = "sys:pending";

export function identityEffect(): Extract<EffectIR, { kind: "seq" }> {
  return { kind: "seq", effects: [] };
}

function literalValueFromExpr(expr: ExprIR): Value | undefined {
  return expr.kind === "lit" ? expr.value : undefined;
}

function simplifyBooleanExpr(expr: ExprIR): ExprIR {
  if (expr.kind === "eq" || expr.kind === "neq") {
    const left = literalValueFromExpr(expr.args[0]);
    const right = literalValueFromExpr(expr.args[1]);
    if (left !== undefined && right !== undefined) {
      const result = expr.kind === "eq" ? left === right : left !== right;
      return { kind: "lit", value: result };
    }
  }
  return expr;
}

export function simplifyEffect(effect: EffectIR): EffectIR {
  if (effect.kind === "if") {
    const cond = simplifyBooleanExpr(effect.cond);
    if (cond.kind === "lit" && typeof cond.value === "boolean") {
      return simplifyEffect(cond.value ? effect.then : effect.else);
    }
    return {
      kind: "if",
      cond,
      // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
      then: simplifyEffect(effect.then),
      else: simplifyEffect(effect.else),
    };
  }
  if (effect.kind === "seq") {
    const effects = effect.effects
      .map((child) => simplifyEffect(child))
      .filter((child) => !(child.kind === "seq" && child.effects.length === 0));
    if (effects.length === 0) return identityEffect();
    const first = effects[0];
    if (effects.length === 1 && first) return first;
    return { kind: "seq", effects };
  }
  return effect;
}

export function effectFromSummaries(
  summaries: readonly EffectSummaryLike[],
): EffectIR {
  const effects = summaries.map((summary) => summary.effect);
  if (effects.length === 0) return identityEffect();
  const effect = effects[0];
  return effects.length === 1 && effect ? effect : { kind: "seq", effects };
}

export function uniqueSummariesByEffect<T extends EffectSummaryLike>(
  summaries: readonly T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const summary of summaries) {
    const key = JSON.stringify(summary.effect);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(summary);
  }
  return out;
}

export function effectWriteVars(effect: EffectIR): string[] {
  if (
    effect.kind === "assign" ||
    effect.kind === "havoc" ||
    effect.kind === "choose"
  )
    return [effect.var];
  if (effect.kind === "seq") return effect.effects.flatMap(effectWriteVars);
  if (effect.kind === "if")
    return [...effectWriteVars(effect.then), ...effectWriteVars(effect.else)];
  if (effect.kind === "enqueue" || effect.kind === "dequeue")
    return [effect.queue ?? PENDING_QUEUE_VAR];
  return [...effect.ref.declaredWrites];
}
