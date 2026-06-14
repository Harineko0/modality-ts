import type { Model, ModelState, Transition } from "../ir/types.js";
import { initialValues } from "../ir/validator.js";
export type { ModelState, Value } from "../ir/types.js";

export interface StepFacts {
  transition: Transition;
  enqueued(op: string): boolean;
  resolved(op: string, outcome?: string): boolean;
  navigated(): boolean;
  navigatedTo(route: string): boolean;
  op?: { id: string; continuation?: string; args: Record<string, unknown> };
}

export type StatePredicate = (state: ModelState) => boolean;
export type StepPredicate = (pre: ModelState, step: StepFacts, post: ModelState) => boolean;

export interface PropertyOptions {
  name?: string;
  reads?: readonly string[];
  enabledTransitions?: readonly string[];
}

export type Property =
  | { kind: "always"; name: string; predicate: StatePredicate; reads?: readonly string[]; enabledTransitions?: readonly string[] }
  | { kind: "alwaysStep"; name: string; predicate: StepPredicate; reads?: readonly string[]; enabledTransitions?: readonly string[] }
  | { kind: "reachable"; name: string; predicate: StatePredicate; reads?: readonly string[]; enabledTransitions?: readonly string[] }
  | { kind: "leadsToWithin"; name: string; trigger: (step: StepFacts) => boolean; goal: StatePredicate; budget: { steps?: number; environment?: number }; allowUserEvents?: boolean; reads?: readonly string[]; enabledTransitions?: readonly string[] }
  | { kind: "reachableFrom"; name: string; when: StatePredicate; goal: StatePredicate; reads?: readonly string[]; enabledTransitions?: readonly string[] };

export function always(_model: Model, predicate: StatePredicate, options: PropertyOptions = {}): Property {
  return { kind: "always", name: options.name ?? "always", predicate, reads: propertyReads(_model, options, predicate), enabledTransitions: propertyEnabledTransitions(options, predicate) };
}

export function alwaysStep(_model: Model, predicate: StepPredicate, options: PropertyOptions = {}): Property {
  return { kind: "alwaysStep", name: options.name ?? "alwaysStep", predicate, reads: propertyReads(_model, options, predicate), enabledTransitions: propertyEnabledTransitions(options, predicate) };
}

export function reachable(_model: Model, predicate: StatePredicate, options: PropertyOptions = {}): Property {
  return { kind: "reachable", name: options.name ?? "reachable", predicate, reads: propertyReads(_model, options, predicate), enabledTransitions: propertyEnabledTransitions(options, predicate) };
}

export function leadsToWithin(
  _model: Model,
  trigger: (step: StepFacts) => boolean,
  goal: StatePredicate,
  options: PropertyOptions & { budget: { steps?: number; environment?: number }; allowUserEvents?: boolean }
): Property {
  return { kind: "leadsToWithin", name: options.name ?? "leadsToWithin", trigger, goal, budget: options.budget, allowUserEvents: options.allowUserEvents, reads: propertyReads(_model, options, goal), enabledTransitions: propertyEnabledTransitions(options, trigger, goal) };
}

export function reachableFrom(_model: Model, when: StatePredicate, goal: StatePredicate, options: PropertyOptions = {}): Property {
  return { kind: "reachableFrom", name: options.name ?? "reachableFrom", when, goal, reads: propertyReads(_model, options, when, goal), enabledTransitions: propertyEnabledTransitions(options, when, goal) };
}

export function enabled(model: Model, transitionId: string): StatePredicate {
  const transition = model.transitions.find((candidate) => candidate.id === transitionId);
  if (!transition) throw new Error(`Unknown transition ${transitionId}`);
  return (state) => Boolean((globalThis as unknown as { __modalityEvalGuard?: (transition: Transition, state: ModelState) => boolean }).__modalityEvalGuard?.(transition, state));
}

function propertyEnabledTransitions(options: PropertyOptions, ...predicates: readonly Function[]): readonly string[] | undefined {
  const ids = new Set(options.enabledTransitions ?? []);
  for (const predicate of predicates) {
    for (const id of inferEnabledTransitions(predicate)) ids.add(id);
  }
  return ids.size > 0 ? [...ids].sort() : undefined;
}

function propertyReads(model: Model, options: PropertyOptions, ...predicates: readonly Function[]): readonly string[] | undefined {
  if (options.reads !== undefined) return options.reads;
  const reads = new Set<string>();
  for (const predicate of predicates) {
    for (const read of inferStateReads(model, predicate)) reads.add(read);
  }
  return [...reads].sort();
}

function inferStateReads(model: Model, predicate: Function): string[] {
  const reads = new Set<string>();
  for (const read of inferSourceReads(model, predicate)) reads.add(read);
  const state = recordingStateProxy(model, reads);
  try {
    predicate(state);
  } catch {
    // Inference is best-effort; runtime read validation catches under-declared reads.
  }
  try {
    predicate(state, recordingStepFacts(), state);
  } catch {
    // Inference is best-effort; runtime read validation catches under-declared reads.
  }
  return [...reads];
}

function inferSourceReads(model: Model, predicate: Function): string[] {
  const varIds = new Set(model.vars.map((decl) => decl.id));
  const source = Function.prototype.toString.call(predicate);
  const reads = new Set<string>();
  const dotPattern = /\.([A-Za-z_$][\w$]*)/g;
  const bracketPattern = /\[\s*(['"`])([^'"`]+)\1\s*\]/g;
  let match: RegExpExecArray | null;
  while ((match = dotPattern.exec(source))) {
    if (varIds.has(match[1]!)) reads.add(match[1]!);
  }
  while ((match = bracketPattern.exec(source))) {
    if (varIds.has(match[2]!)) reads.add(match[2]!);
  }
  return [...reads];
}

function recordingStateProxy(model: Model, reads: Set<string>): ModelState {
  const initials = new Map(model.vars.map((decl) => [decl.id, initialValues(decl.domain, decl.initial)[0]]));
  const nested = new Proxy(
    {},
    {
      get(_target, key) {
        if (key === Symbol.toPrimitive) return () => "";
        if (key === "toString") return () => "";
        if (key === "valueOf") return () => "";
        return nested;
      }
    }
  );
  return new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key === "string" && model.vars.some((decl) => decl.id === key)) reads.add(key);
        if (key === Symbol.toPrimitive) return () => "";
        if (key === "toString") return () => "";
        if (key === "valueOf") return () => "";
        return typeof key === "string" && initials.has(key) ? initials.get(key) : nested;
      }
    }
  ) as ModelState;
}

function recordingStepFacts(): StepFacts {
  return {
    transition: {} as Transition,
    enqueued: () => false,
    resolved: () => false,
    navigated: () => false,
    navigatedTo: () => false
  };
}

function inferEnabledTransitions(predicate: Function): string[] {
  const ids: string[] = [];
  const source = Function.prototype.toString.call(predicate);
  const pattern = /enabled\)?\s*\([^,]+,\s*(['"`])([^'"`]+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    ids.push(match[2]!);
  }
  return ids;
}
