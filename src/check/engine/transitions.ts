import type { Model, ModelState, Transition } from "modality-ts/core";
import { guardHolds } from "../runtime/effects.js";
import { routeLocalMounted } from "./mounts.js";

export function enabledTransitions(model: Model, state: ModelState): Transition[] {
  return [...model.transitions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((transition) => transition.cls !== "internal" && routeLocalMounted(model, transition, state) && guardHolds(model, transition, state));
}

export function installEnabledHook(model: Model): void {
  (globalThis as unknown as { __modalityEvalGuard: (transition: Transition, state: ModelState) => boolean }).__modalityEvalGuard = (transition, state) =>
    model.transitions.includes(transition) && routeLocalMounted(model, transition, state) && guardHolds(model, transition, state);
}
