import type { Model, ModelState, Transition } from "modality-ts/core";
import { guardHolds } from "../runtime/effects.js";
import { routeLocalMounted } from "./mounts.js";

export interface TransitionIndex {
  nonInternalTransitions: readonly Transition[];
  internalTransitions: readonly Transition[];
  transitionsById: ReadonlyMap<string, Transition>;
  internalByTriggeredVar: ReadonlyMap<string, readonly Transition[]>;
  alwaysTriggeredInternal: readonly Transition[];
}

export function buildTransitionIndex(model: Model): TransitionIndex {
  const sorted = [...model.transitions].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const nonInternalTransitions = sorted.filter(
    (transition) => transition.cls !== "internal",
  );
  const internalTransitions = sorted.filter(
    (transition) => transition.cls === "internal",
  );
  const transitionsById = new Map(
    sorted.map((transition) => [transition.id, transition]),
  );
  const internalByTriggeredVar = new Map<string, Transition[]>();
  const alwaysTriggeredInternal: Transition[] = [];
  for (const transition of internalTransitions) {
    if (!transition.triggeredBy || transition.triggeredBy.length === 0) {
      alwaysTriggeredInternal.push(transition);
      continue;
    }
    for (const varId of transition.triggeredBy) {
      const list = internalByTriggeredVar.get(varId) ?? [];
      list.push(transition);
      internalByTriggeredVar.set(varId, list);
    }
  }
  return {
    nonInternalTransitions,
    internalTransitions,
    transitionsById,
    internalByTriggeredVar,
    alwaysTriggeredInternal,
  };
}

export function enabledTransitions(
  model: Model,
  state: ModelState,
  index?: TransitionIndex,
): Transition[] {
  const candidates =
    index?.nonInternalTransitions ??
    [...model.transitions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .filter((transition) => transition.cls !== "internal");
  return candidates.filter(
    (transition) =>
      routeLocalMounted(model, transition, state) &&
      guardHolds(model, transition, state),
  );
}

export function installEnabledHook(model: Model): void {
  (
    globalThis as unknown as {
      __modalityEvalGuard: (
        transition: Transition,
        state: ModelState,
      ) => boolean;
    }
  ).__modalityEvalGuard = (transition, state) =>
    model.transitions.includes(transition) &&
    routeLocalMounted(model, transition, state) &&
    guardHolds(model, transition, state);
}
