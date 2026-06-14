import type { Model, ModelState, TraceStep } from "modality-ts/core";
import { applyEffect } from "../runtime/effects.js";
import { makeTraceStep } from "../traces/trace.js";
import {
  changedVars,
  compareStates,
  initialChangedVars,
} from "./state-utils.js";
import { enabledTransitions } from "./transitions.js";
import { initialStates } from "./initial-states.js";
import { stabilize } from "./stabilize.js";

export function modelInitialStates(model: Model): ModelState[] {
  return initialStates(model)
    .flatMap((state) => stabilize(model, state, initialChangedVars(model)))
    .sort(compareStates(model));
}

export function modelSuccessors(model: Model, pre: ModelState): TraceStep[] {
  return enabledTransitions(model, pre).flatMap((transition) =>
    applyEffect(model, pre, transition.effect).flatMap((rawPost) =>
      stabilize(model, rawPost, changedVars(pre, rawPost)).map((post) =>
        makeTraceStep(pre, post, transition),
      ),
    ),
  );
}
