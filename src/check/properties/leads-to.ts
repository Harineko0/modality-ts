import { canonicalState } from "modality-ts/core";
import type { Model, ModelState, Property, Transition } from "modality-ts/core";
import { enabledTransitions } from "../engine/transitions.js";
import { changedVars } from "../engine/state-utils.js";
import { stabilize } from "../engine/stabilize.js";
import { applyEffect } from "../runtime/effects.js";
import { facts } from "../traces/step-facts.js";
import type { Edge } from "../types.js";
import { checkedState } from "./checked-state.js";

type LeadsToWithin = Extract<Property, { kind: "leadsToWithin" }>;

export function failingSuffixWithin(
  model: Model,
  property: LeadsToWithin,
  start: ModelState,
): Edge[] | undefined {
  const maxSteps = property.budget.steps ?? property.budget.environment ?? 0;
  const memo = new Map<string, Edge[] | null>();
  const visit = (state: ModelState, depth: number): Edge[] | undefined => {
    if (
      property.goal(checkedState(model, property, state, "leadsToWithin goal"))
    )
      return undefined;
    const canon = canonicalState(model, state);
    const key = `${canon}:${depth}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached ?? undefined;
    if (depth >= maxSteps) {
      memo.set(key, []);
      return [];
    }
    const successors = schedulerSuccessors(model, property, state);
    if (successors.length === 0) {
      memo.set(key, []);
      return [];
    }
    for (const edge of successors) {
      const suffix = visit(edge.post, depth + 1);
      if (suffix) {
        const failure = [edge, ...suffix];
        memo.set(key, failure);
        return failure;
      }
    }
    memo.set(key, null);
    return undefined;
  };
  return visit(start, 0);
}

function schedulerSuccessors(
  model: Model,
  property: LeadsToWithin,
  pre: ModelState,
): Edge[] {
  const preCanon = canonicalState(model, pre);
  const out: Edge[] = [];
  for (const transition of enabledTransitions(model, pre).filter((candidate) =>
    schedulerAllows(property, candidate),
  )) {
    for (const rawPost of applyEffect(model, pre, transition.effect)) {
      for (const post of stabilize(model, rawPost, changedVars(pre, rawPost))) {
        out.push({
          preCanon,
          postCanon: canonicalState(model, post),
          pre,
          post,
          transition,
          step: facts(pre, post, transition),
        });
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.transition.id.localeCompare(b.transition.id) ||
      a.postCanon.localeCompare(b.postCanon),
  );
}

function schedulerAllows(
  property: LeadsToWithin,
  transition: Transition,
): boolean {
  if (
    transition.cls === "env" ||
    transition.cls === "library" ||
    transition.cls === "internal"
  )
    return true;
  return (
    property.allowUserEvents === true &&
    (transition.cls === "user" || transition.cls === "nav")
  );
}
