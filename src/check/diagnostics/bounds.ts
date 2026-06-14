import type { Model, ModelState, Transition } from "modality-ts/core";
import { enabledTransitions } from "../engine/transitions.js";

export function recordMaxDepthBoundHits(
  model: Model,
  frontier: readonly ModelState[],
  enabledTransitionIds: Set<string>,
  boundHits: Set<string>,
): void {
  if (frontier.length === 0) return;
  const blockedTransitions = new Set<string>();
  for (const state of frontier) {
    for (const transition of enabledTransitions(model, state)) {
      enabledTransitionIds.add(transition.id);
      blockedTransitions.add(transition.id);
    }
  }
  for (const id of [...blockedTransitions].sort()) {
    boundHits.add(`maxDepth reached before ${id}`);
  }
}

export function effectContainsEnqueue(effect: Transition["effect"]): boolean {
  if (effect.kind === "enqueue") return true;
  if (effect.kind === "seq") return effect.effects.some(effectContainsEnqueue);
  if (effect.kind === "if")
    return (
      effectContainsEnqueue(effect.then) || effectContainsEnqueue(effect.else)
    );
  return false;
}
