import type { ExprIR } from "modality-ts/core";
import * as ts from "typescript";
import type { EffectSummaryLike } from "../../lang/effect-ir.js";
import { effectFromSummaries, identityEffect } from "../../lang/effect-ir.js";

export function exitsWithoutEffects(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    const meaningful = statement.statements.filter(
      (child) => !ts.isEmptyStatement(child),
    );
    return (
      meaningful.length > 0 &&
      meaningful.every((child) => exitsWithoutEffects(child))
    );
  }
  return false;
}

export interface GuardedRestMatch {
  condition: ts.Expression;
  thenExits: boolean;
  elseExits: boolean;
  restIndex: number;
}

export function findGuardedRest(
  statements: readonly ts.Statement[],
): GuardedRestMatch | undefined {
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (!statement || !ts.isIfStatement(statement)) continue;
    const thenExits = exitsWithoutEffects(statement.thenStatement);
    const elseExits = statement.elseStatement
      ? exitsWithoutEffects(statement.elseStatement)
      : false;
    if (thenExits === elseExits) continue;
    return {
      condition: statement.expression,
      thenExits,
      elseExits,
      restIndex: index + 1,
    };
  }
  return undefined;
}

export function guardedRestEffect(
  condition: ExprIR,
  thenExits: boolean,
  elseExits: boolean,
  restSummaries: readonly EffectSummaryLike[],
): { summaries: EffectSummaryLike[]; terminated: boolean } | undefined {
  const restEffect = effectFromSummaries(restSummaries);
  if (restEffect.kind === "seq" && restEffect.effects.length === 0) {
    return { summaries: [], terminated: thenExits || elseExits };
  }
  return {
    summaries: [
      {
        effect: {
          kind: "if",
          cond: condition,
          // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
          then: thenExits ? identityEffect() : restEffect,
          else: elseExits ? identityEffect() : restEffect,
        },
        reads: restSummaries.flatMap((summary) => summary.reads),
      },
    ],
    terminated: false,
  };
}
