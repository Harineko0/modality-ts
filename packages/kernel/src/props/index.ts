import type { Model, ModelState, Transition } from "../ir/types.js";

export interface StepFacts {
  transition: Transition;
  enqueued(op: string): boolean;
  resolved(op: string, outcome?: string): boolean;
  navigatedTo(route: string): boolean;
  op?: { id: string; continuation?: string; args: Record<string, unknown> };
}

export type StatePredicate = (state: ModelState) => boolean;
export type StepPredicate = (pre: ModelState, step: StepFacts, post: ModelState) => boolean;

export interface PropertyOptions {
  name?: string;
  reads?: readonly string[];
}

export type Property =
  | { kind: "always"; name: string; predicate: StatePredicate; reads?: readonly string[] }
  | { kind: "alwaysStep"; name: string; predicate: StepPredicate; reads?: readonly string[] }
  | { kind: "reachable"; name: string; predicate: StatePredicate; reads?: readonly string[] }
  | { kind: "leadsToWithin"; name: string; trigger: (step: StepFacts) => boolean; goal: StatePredicate; budget: { steps?: number; environment?: number }; allowUserEvents?: boolean; reads?: readonly string[] }
  | { kind: "reachableFrom"; name: string; when: StatePredicate; goal: StatePredicate; reads?: readonly string[] };

export function always(_model: Model, predicate: StatePredicate, options: PropertyOptions = {}): Property {
  return { kind: "always", name: options.name ?? "always", predicate, reads: options.reads };
}

export function alwaysStep(_model: Model, predicate: StepPredicate, options: PropertyOptions = {}): Property {
  return { kind: "alwaysStep", name: options.name ?? "alwaysStep", predicate, reads: options.reads };
}

export function reachable(_model: Model, predicate: StatePredicate, options: PropertyOptions = {}): Property {
  return { kind: "reachable", name: options.name ?? "reachable", predicate, reads: options.reads };
}

export function leadsToWithin(
  _model: Model,
  trigger: (step: StepFacts) => boolean,
  goal: StatePredicate,
  options: PropertyOptions & { budget: { steps?: number; environment?: number }; allowUserEvents?: boolean }
): Property {
  return { kind: "leadsToWithin", name: options.name ?? "leadsToWithin", trigger, goal, budget: options.budget, allowUserEvents: options.allowUserEvents, reads: options.reads };
}

export function reachableFrom(_model: Model, when: StatePredicate, goal: StatePredicate, options: PropertyOptions = {}): Property {
  return { kind: "reachableFrom", name: options.name ?? "reachableFrom", when, goal, reads: options.reads };
}

export function enabled(model: Model, transitionId: string): StatePredicate {
  const transition = model.transitions.find((candidate) => candidate.id === transitionId);
  if (!transition) throw new Error(`Unknown transition ${transitionId}`);
  return (state) => Boolean((globalThis as unknown as { __modalityEvalGuard?: (transition: Transition, state: ModelState) => boolean }).__modalityEvalGuard?.(transition, state));
}
