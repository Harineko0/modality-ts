import type {
  FairnessConstraint,
  PropertyOptions,
  StepPredicateFlat,
  StepPredicateIR,
  TemporalFormula,
} from "../ir/types.js";
import type { Operand } from "./operand.js";
import { always as ctlAlways, canReach, holds, implies } from "./formula.js";

// ---------------------------------------------------------------------------
// Pending spec shapes (pre-finalization)
// ---------------------------------------------------------------------------

export interface PendingTemporalSpec {
  kind: "temporal";
  name: string;
  formula: TemporalFormula;
  options: PropertyOptions & { fairness?: readonly FairnessConstraint[] };
}

export interface PendingAlwaysStepSpec {
  kind: "alwaysStep";
  name: string;
  predicate: StepPredicateIR;
  options: PropertyOptions;
}

export interface PendingLeadsToWithinSpec {
  kind: "leadsToWithin";
  name: string;
  trigger: StepPredicateFlat;
  goal: Operand;
  options: PropertyOptions & {
    budget: { steps?: number; environment?: number };
    allowUserEvents?: boolean;
  };
}

export type PendingSpec =
  | PendingTemporalSpec
  | PendingAlwaysStepSpec
  | PendingLeadsToWithinSpec;

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

let specs: PendingSpec[] = [];
let prefix: string[] = [];

function qualifiedName(name: string): string {
  return prefix.length > 0 ? [...prefix, name].join(" > ") : name;
}

export function resetRegistry(): void {
  specs = [];
  prefix = [];
}

export function harvest(): PendingSpec[] {
  const collected = specs;
  specs = [];
  prefix = [];
  return collected;
}

export function group(name: string, fn: () => void): void {
  prefix.push(name);
  try {
    fn();
  } finally {
    prefix.pop();
  }
}

// ---------------------------------------------------------------------------
// General registration verb
// ---------------------------------------------------------------------------

export function property(
  name: string,
  formula: TemporalFormula,
  options: PropertyOptions & { fairness?: readonly FairnessConstraint[] } = {},
): void {
  specs.push({ kind: "temporal", name: qualifiedName(name), formula, options });
}

// ---------------------------------------------------------------------------
// Convenience wrappers (preserve old call-shapes, lower to CTL)
// ---------------------------------------------------------------------------

/** Register AG p — p holds in every reachable state. */
export function always(
  name: string,
  predicate: Operand,
  options: PropertyOptions = {},
): void {
  property(name, ctlAlways(holds(predicate)), options);
}

/** Register EF p — p is reachable from the initial state. */
export function reachable(
  name: string,
  predicate: Operand,
  options: PropertyOptions = {},
): void {
  property(name, canReach(holds(predicate)), options);
}

/** Register AG(when → EF goal) — from every when-state, some path reaches goal. */
export function reachableFrom(
  name: string,
  when: Operand,
  goal: Operand,
  options: PropertyOptions = {},
): void {
  property(
    name,
    ctlAlways(implies(holds(when), canReach(holds(goal)))),
    options,
  );
}

/** Register an AG p using a pre-built TemporalFormula (advanced usage). */
export function inevitably(
  name: string,
  formula: TemporalFormula,
  options: PropertyOptions = {},
): void {
  property(name, formula, options);
}

// ---------------------------------------------------------------------------
// Non-CTL verbs (unchanged)
// ---------------------------------------------------------------------------

export function alwaysStep(
  name: string,
  predicate: StepPredicateIR,
  options: PropertyOptions = {},
): void {
  specs.push({
    kind: "alwaysStep",
    name: qualifiedName(name),
    predicate,
    options,
  });
}

export function leadsToWithin(
  name: string,
  trigger: StepPredicateFlat,
  goal: Operand,
  options: PropertyOptions & {
    budget: { steps?: number; environment?: number };
    allowUserEvents?: boolean;
  },
): void {
  specs.push({
    kind: "leadsToWithin",
    name: qualifiedName(name),
    trigger,
    goal,
    options,
  });
}
