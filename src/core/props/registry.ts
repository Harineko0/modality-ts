import type {
  PropertyOptions,
  StepPredicateFlat,
  StepPredicateIR,
} from "../ir/types.js";
import type { Operand } from "./operand.js";

export interface PendingAlwaysSpec {
  kind: "always";
  name: string;
  predicate: Operand;
  options: PropertyOptions;
}

export interface PendingAlwaysStepSpec {
  kind: "alwaysStep";
  name: string;
  predicate: StepPredicateIR;
  options: PropertyOptions;
}

export interface PendingReachableSpec {
  kind: "reachable";
  name: string;
  predicate: Operand;
  options: PropertyOptions;
}

export interface PendingReachableFromSpec {
  kind: "reachableFrom";
  name: string;
  when: Operand;
  goal: Operand;
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
  | PendingAlwaysSpec
  | PendingAlwaysStepSpec
  | PendingReachableSpec
  | PendingReachableFromSpec
  | PendingLeadsToWithinSpec;

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

export function reachable(
  name: string,
  predicate: Operand,
  options: PropertyOptions = {},
): void {
  specs.push({
    kind: "reachable",
    name: qualifiedName(name),
    predicate,
    options,
  });
}

export function always(
  name: string,
  predicate: Operand,
  options: PropertyOptions = {},
): void {
  specs.push({
    kind: "always",
    name: qualifiedName(name),
    predicate,
    options,
  });
}

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

export function reachableFrom(
  name: string,
  when: Operand,
  goal: Operand,
  options: PropertyOptions = {},
): void {
  specs.push({
    kind: "reachableFrom",
    name: qualifiedName(name),
    when,
    goal,
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
