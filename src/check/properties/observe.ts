import { canonicalState } from "modality-ts/core";
import type { Model, ModelState, Property, StepFacts, Transition } from "modality-ts/core";
import type { Parent, PropertyVerdict } from "../types.js";
import { checkedState } from "./checked-state.js";
import { makeTraceStep, replayCheckedVerdict, traceTo } from "../traces/trace.js";

export function observeStates(
  model: Model,
  properties: readonly Property[],
  candidates: readonly ModelState[],
  parents: Map<string, Parent>,
  verdicts: Map<string, PropertyVerdict>
): void {
  for (const state of candidates) {
    const canon = canonicalState(model, state);
    for (const property of properties) {
      if (verdicts.has(property.name)) continue;
      try {
        if (property.kind === "always" && !property.predicate(checkedState(model, property, state, "state predicate"))) {
          verdicts.set(property.name, replayCheckedVerdict("violated", property.name, traceTo(parents, canon)));
        }
        if (property.kind === "reachable" && property.predicate(checkedState(model, property, state, "state predicate"))) {
          verdicts.set(property.name, replayCheckedVerdict("reachable", property.name, traceTo(parents, canon)));
        }
      } catch (error) {
        verdicts.set(property.name, { status: "error", property: property.name, message: (error as Error).message });
      }
    }
  }
}

export function observeEdge(
  model: Model,
  properties: readonly Property[],
  pre: ModelState,
  post: ModelState,
  transition: Transition,
  step: StepFacts,
  parents: Map<string, Parent>,
  verdicts: Map<string, PropertyVerdict>
): void {
  for (const property of properties) {
    if (verdicts.has(property.name)) continue;
    if (property.kind !== "alwaysStep") continue;
    try {
      if (!property.predicate(checkedState(model, property, pre, "step pre-state"), step, checkedState(model, property, post, "step post-state"))) {
        const preCanon = canonicalState(model, pre);
        verdicts.set(property.name, replayCheckedVerdict("violated", property.name, { steps: [...traceTo(parents, preCanon).steps, makeTraceStep(pre, post, transition)] }));
      }
    } catch (error) {
      verdicts.set(property.name, { status: "error", property: property.name, message: (error as Error).message });
    }
  }
}
