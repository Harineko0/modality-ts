import type { Model, ModelState, TraceStep } from "modality-ts/core";
import { applyEffect } from "../runtime/effects.js";
import { makeTraceStep } from "../traces/trace.js";
import {
  changedVars,
  compareStates,
  initialChangedVars,
} from "./state-utils.js";
import { buildTransitionIndex, enabledTransitions } from "./transitions.js";
import { initialStates } from "./initial-states.js";
import { stabilize } from "./stabilize.js";

export function modelInitialStates(model: Model): ModelState[] {
  const index = buildTransitionIndex(model);
  return initialStates(model)
    .flatMap((state) =>
      stabilize(model, state, initialChangedVars(model), index),
    )
    .sort(compareStates(model));
}

export function modelSuccessors(model: Model, pre: ModelState): TraceStep[] {
  const index = buildTransitionIndex(model);
  return enabledTransitions(model, pre, index).flatMap((transition) =>
    applyEffect(model, pre, transition.effect).flatMap((rawPost) =>
      stabilize(model, rawPost, changedVars(pre, rawPost, model), index).map(
        (post) => makeTraceStep(pre, post, transition),
      ),
    ),
  );
}
