import type { Model, ModelState, Property } from "modality-ts/core";
import type { Edge } from "../types.js";
import { checkedState } from "./checked-state.js";

type ReachableFrom = Extract<Property, { kind: "reachableFrom" }>;

export function unreachableWitness(
  model: Model,
  property: ReachableFrom,
  states: Map<string, ModelState>,
  reverseEdges: readonly { preCanon: string; postCanon: string }[],
): [string, ModelState] | undefined {
  const goalCanons = [...states]
    .filter(([, state]) =>
      property.goal(checkedState(model, property, state, "reachableFrom goal")),
    )
    .map(([canon]) => canon);
  const backward = new Set(goalCanons);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of reverseEdges) {
      if (backward.has(edge.postCanon) && !backward.has(edge.preCanon)) {
        backward.add(edge.preCanon);
        changed = true;
      }
    }
  }
  return [...states].find(
    ([canon, state]) =>
      property.when(
        checkedState(model, property, state, "reachableFrom when"),
      ) && !backward.has(canon),
  );
}
