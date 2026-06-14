import { enumerateDomain } from "modality-ts/core";
import type { EffectIR, Model, ModelState } from "modality-ts/core";
import type { EvalOptions } from "./expr.js";
import { evalExpr } from "./expr.js";
import { navigate } from "./navigation.js";
import { applyOpaqueEffect } from "./opaque.js";
import type { PendingOp } from "./pending.js";
import { readPending } from "./pending.js";
import { TokenExhausted } from "./tokens.js";

export type { EvalOptions, PendingOp };
export { evalExpr, guardHolds } from "./expr.js";
export { normalizeInitialRouteLocals } from "./navigation.js";
export { readPending } from "./pending.js";

export function applyEffect(
  model: Model,
  state: ModelState,
  effect: EffectIR,
  options: EvalOptions = {},
): ModelState[] {
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

function applyEffectUnsafe(
  model: Model,
  state: ModelState,
  effect: EffectIR,
  options: EvalOptions,
): ModelState[] {
  switch (effect.kind) {
    case "assign":
      return [
        {
          ...state,
          [effect.var]: evalExpr(model, state, effect.expr, options),
        },
      ];
    case "havoc": {
      const decl = mustVar(model, effect.var);
      return enumerateDomain(decl.domain).map((value) => ({
        ...state,
        [effect.var]: value,
      }));
    }
    case "choose":
      return effect.among.map((expr) => ({
        ...state,
        [effect.var]: evalExpr(model, state, expr, options),
      }));
    case "if":
      return applyEffect(
        model,
        state,
        evalExpr(model, state, effect.cond, options)
          ? effect.then
          : effect.else,
        options,
      );
    case "seq":
      return effect.effects.reduce<ModelState[]>(
        (states, next) =>
          states.flatMap((candidate) =>
            applyEffect(model, candidate, next, options),
          ),
        [state],
      );
    case "enqueue": {
      const pending = readPending(state);
      if (pending.length >= model.bounds.maxPending) return [];
      const op: PendingOp = {
        opId: effect.op,
        continuation: effect.continuation,
        args: Object.fromEntries(
          Object.entries(effect.args).map(([key, expr]) => [
            key,
            evalExpr(model, state, expr, options),
          ]),
        ),
      };
      return [{ ...state, "sys:pending": [...pending, op] }];
    }
    case "dequeue": {
      const pending = readPending(state);
      if (effect.index < 0 || effect.index >= pending.length) return [state];
      return [
        {
          ...state,
          "sys:pending": pending.filter((_, index) => index !== effect.index),
        },
      ];
    }
    case "navigate":
      return navigate(model, state, effect, options);
    case "opaque":
      return applyOpaqueEffect(model, state, effect.ref);
  }
}

function mustVar(model: Model, id: string) {
  const decl = model.vars.find((candidate) => candidate.id === id);
  if (!decl) throw new Error(`Unknown var ${id}`);
  return decl;
}
