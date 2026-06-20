import type {
  ExprIR,
  Model,
  Property,
  PropertyOptions,
  StatePredicateIR,
  StepPredicateFlat,
  StepPredicateIR,
  Value,
} from "../ir/types.js";
import { exprReads } from "../ir/validator.js";
import { isVariable, lift, type Operand, type Variable } from "./operand.js";
import {
  always as registerAlways,
  alwaysStep as registerAlwaysStep,
  leadsToWithin as registerLeadsToWithin,
  type PendingSpec,
  reachable as registerReachable,
  reachableFrom as registerReachableFrom,
} from "./registry.js";

export { evalStatePredicate, StatePredicateEvalError } from "../ir/eval.js";
export type {
  Model,
  ModelState,
  Property,
  PropertyArtifact,
  PropertyOptions,
  StatePredicateIR,
  StepPredicateComposite,
  StepPredicateFlat,
  StepPredicateIR,
  Value,
} from "../ir/types.js";

export {
  type Operand,
  type Variable,
  isExprIR,
  isVariable,
  lift,
  variable,
} from "./operand.js";

/** Branded transition id for generated `*.modals.ts` handles. Plain strings remain assignable. */
export type TransitionRef<Id extends string = string> = Id & {
  readonly __transition?: Id;
};
export { s, type ComponentLike } from "./accessor.js";
export {
  group,
  harvest,
  resetRegistry,
  type PendingSpec,
} from "./registry.js";

export interface StepFacts {
  transition: import("../ir/types.js").Transition;
  enqueued(op: string): boolean;
  resolved(op: string, outcome?: string): boolean;
  changed(varId: string): boolean;
  changedTo(varId: string, value: Value): boolean;
  op?: { id: string; continuation?: string; args: Record<string, unknown> };
}

export function readOpArg(key: string): ExprIR {
  return { kind: "readOpArg", key };
}

/**
 * Read the macro-step pre-state snapshot of a variable. Accepts a {@link Variable}
 * (e.g. `s(Component).field` or `variable(id)`) or a `read` expression.
 */
export function pre(operand: Variable | ExprIR): ExprIR {
  if (isVariable(operand)) {
    return {
      kind: "readPre",
      var: operand.varId,
      ...(operand.path ? { path: operand.path } : {}),
    };
  }
  if (operand.kind === "read") {
    return {
      kind: "readPre",
      var: operand.var,
      ...(operand.path ? { path: operand.path } : {}),
    };
  }
  throw new Error("pre() expects a variable handle or a var read expression");
}

export function eq(left: Operand, right: Operand): ExprIR {
  return { kind: "eq", args: [lift(left), lift(right)] };
}

export function neq(left: Operand, right: Operand): ExprIR {
  return { kind: "neq", args: [lift(left), lift(right)] };
}

export function and(...args: Operand[]): ExprIR {
  return { kind: "and", args: args.map(lift) };
}

export function or(...args: Operand[]): ExprIR {
  return { kind: "or", args: args.map(lift) };
}

export function not(arg: Operand): ExprIR {
  return { kind: "not", args: [lift(arg)] };
}

export function lessThan(left: Operand, right: Operand): ExprIR {
  return { kind: "lt", args: [lift(left), lift(right)] };
}

export function lessThanOrEqual(left: Operand, right: Operand): ExprIR {
  return { kind: "lte", args: [lift(left), lift(right)] };
}

export function greaterThan(left: Operand, right: Operand): ExprIR {
  return { kind: "gt", args: [lift(left), lift(right)] };
}

export function greaterThanOrEqual(left: Operand, right: Operand): ExprIR {
  return { kind: "gte", args: [lift(left), lift(right)] };
}

export function add(left: Operand, right: Operand): ExprIR {
  return { kind: "add", args: [lift(left), lift(right)] };
}

export function sub(left: Operand, right: Operand): ExprIR {
  return { kind: "sub", args: [lift(left), lift(right)] };
}

export function mod(left: Operand, right: Operand): ExprIR {
  return { kind: "mod", args: [lift(left), lift(right)] };
}

export function enabled(transitionId: string | TransitionRef<string>): ExprIR {
  return { kind: "transitionEnabled", transitionId: String(transitionId) };
}

export function enabledTransitionPrefix(prefix: string): ExprIR {
  return { kind: "transitionEnabledPrefix", prefix };
}

export function stepEnqueued(op: string): StepPredicateFlat {
  return { enqueued: op };
}

export function stepResolved(op: string, outcome?: string): StepPredicateFlat {
  return { resolved: outcome === undefined ? [op] : [op, outcome] };
}

export function stepTransitionId(
  transitionId: string | TransitionRef<string>,
): StepPredicateFlat {
  return { transitionId: String(transitionId) };
}

export function stepAny(): StepPredicateFlat {
  return {};
}

export function stepChanged(varId: string): StepPredicateFlat {
  return { changed: varId };
}

export function stepChangedTo(varId: string, value: Value): StepPredicateFlat {
  return { changedTo: { var: varId, value } };
}

export const reachable = registerReachable;
export const always = registerAlways;
export const alwaysStep = registerAlwaysStep;
export const reachableFrom = registerReachableFrom;
export const leadsToWithin = registerLeadsToWithin;

function liftStatePredicate(predicate: Operand): StatePredicateIR {
  return lift(predicate);
}

function liftStepPredicate(predicate: StepPredicateIR): StepPredicateIR {
  if ("step" in predicate) {
    return {
      ...predicate,
      ...(predicate.pre !== undefined ? { pre: lift(predicate.pre) } : {}),
      ...(predicate.post !== undefined ? { post: lift(predicate.post) } : {}),
    };
  }
  return predicate;
}

export function finalizeProperties(
  model: Model,
  pending: readonly PendingSpec[],
): Property[] {
  return pending.map((spec) => finalizeSpec(model, spec));
}

function finalizeSpec(model: Model, spec: PendingSpec): Property {
  switch (spec.kind) {
    case "always":
      return finalizeAlways(model, spec);
    case "alwaysStep":
      return finalizeAlwaysStep(model, spec);
    case "reachable":
      return finalizeReachable(model, spec);
    case "reachableFrom":
      return finalizeReachableFrom(model, spec);
    case "leadsToWithin":
      return finalizeLeadsToWithin(model, spec);
  }
}

function finalizeAlways(
  model: Model,
  spec: Extract<PendingSpec, { kind: "always" }>,
): Property {
  const predicate = liftStatePredicate(spec.predicate);
  return {
    kind: "always",
    name: spec.name,
    predicate,
    reads: propertyReads(model, spec.options, predicate),
    enabledTransitions: propertyEnabledTransitions(
      model,
      spec.options,
      predicate,
    ),
    includeUnmounted: spec.options.includeUnmounted,
  };
}

function finalizeAlwaysStep(
  model: Model,
  spec: Extract<PendingSpec, { kind: "alwaysStep" }>,
): Property {
  const predicate = liftStepPredicate(spec.predicate);
  return {
    kind: "alwaysStep",
    name: spec.name,
    predicate,
    reads: propertyReads(model, spec.options, predicate),
    enabledTransitions: propertyEnabledTransitions(
      model,
      spec.options,
      predicate,
    ),
    includeUnmounted: spec.options.includeUnmounted,
  };
}

function finalizeReachable(
  model: Model,
  spec: Extract<PendingSpec, { kind: "reachable" }>,
): Property {
  const predicate = liftStatePredicate(spec.predicate);
  return {
    kind: "reachable",
    name: spec.name,
    predicate,
    reads: propertyReads(model, spec.options, predicate),
    enabledTransitions: propertyEnabledTransitions(
      model,
      spec.options,
      predicate,
    ),
    includeUnmounted: spec.options.includeUnmounted,
  };
}

function finalizeReachableFrom(
  model: Model,
  spec: Extract<PendingSpec, { kind: "reachableFrom" }>,
): Property {
  const when = liftStatePredicate(spec.when);
  const goal = liftStatePredicate(spec.goal);
  return {
    kind: "reachableFrom",
    name: spec.name,
    when,
    goal,
    reads: propertyReads(model, spec.options, when, goal),
    enabledTransitions: propertyEnabledTransitions(
      model,
      spec.options,
      when,
      goal,
    ),
    includeUnmounted: spec.options.includeUnmounted,
  };
}

function finalizeLeadsToWithin(
  model: Model,
  spec: Extract<PendingSpec, { kind: "leadsToWithin" }>,
): Property {
  const goal = liftStatePredicate(spec.goal);
  return {
    kind: "leadsToWithin",
    name: spec.name,
    trigger: spec.trigger,
    goal,
    budget: spec.options.budget,
    allowUserEvents: spec.options.allowUserEvents,
    reads: propertyReads(model, spec.options, goal),
    enabledTransitions: propertyEnabledTransitions(model, spec.options, goal),
    includeUnmounted: spec.options.includeUnmounted,
  };
}

function propertyReads(
  model: Model,
  options: PropertyOptions,
  ...predicates: readonly (StatePredicateIR | StepPredicateIR)[]
): readonly string[] | undefined {
  if (options.reads !== undefined) return options.reads;
  const reads = new Set<string>();
  for (const predicate of predicates) {
    for (const read of inferReads(model, predicate)) reads.add(read);
  }
  return [...reads].sort();
}

function inferReads(
  model: Model,
  predicate: StatePredicateIR | StepPredicateIR,
): string[] {
  const varIds = new Set(model.vars.map((decl) => decl.id));
  const reads = new Set<string>();
  const walkExpr = (expr: ExprIR): void => {
    switch (expr.kind) {
      case "read":
      case "readPre":
        if (varIds.has(expr.var)) reads.add(expr.var);
        break;
      case "eq":
      case "neq":
      case "and":
      case "or":
        for (const arg of expr.args) walkExpr(arg);
        break;
      case "not":
        walkExpr(expr.args[0]);
        break;
      case "cond":
        for (const arg of expr.args) walkExpr(arg);
        break;
      case "updateField":
        walkExpr(expr.target);
        walkExpr(expr.value);
        break;
      case "tagIs":
        walkExpr(expr.arg);
        break;
      case "lenCat":
        walkExpr(expr.arg);
        break;
      case "freshToken":
        if (varIds.has(expr.domainOf)) reads.add(expr.domainOf);
        break;
      case "transitionEnabled": {
        const transition = model.transitions.find(
          (candidate) => candidate.id === expr.transitionId,
        );
        if (transition) {
          for (const id of exprReads(transition.guard)) reads.add(id);
        }
        break;
      }
      case "transitionEnabledPrefix": {
        for (const transition of model.transitions) {
          if (!transition.id.startsWith(expr.prefix)) continue;
          for (const id of exprReads(transition.guard)) reads.add(id);
        }
        break;
      }
      case "readOpArg":
      case "lit":
        break;
      case "lt":
      case "lte":
      case "gt":
      case "gte":
      case "add":
      case "sub":
      case "mod":
        walkExpr(expr.args[0]);
        walkExpr(expr.args[1]);
        break;
    }
  };
  if ("kind" in predicate) {
    walkExpr(predicate);
    return [...reads];
  }
  if ("step" in predicate) {
    if (predicate.pre) walkExpr(predicate.pre);
    if (predicate.post) walkExpr(predicate.post);
    for (const id of inferStepFactReads(predicate.step)) reads.add(id);
    return [...reads];
  }
  for (const id of inferStepFactReads(predicate)) reads.add(id);
  return [...reads];
}

function inferStepFactReads(flat: StepPredicateFlat): string[] {
  const reads: string[] = [];
  if (flat.changed) reads.push(flat.changed);
  if (flat.changedTo) reads.push(flat.changedTo.var);
  return reads;
}

function propertyEnabledTransitions(
  model: Model,
  options: PropertyOptions,
  ...predicates: readonly (StatePredicateIR | StepPredicateIR)[]
): readonly string[] | undefined {
  const ids = new Set(options.enabledTransitions ?? []);
  for (const predicate of predicates) {
    for (const id of inferEnabledTransitions(model, predicate)) ids.add(id);
  }
  return ids.size > 0 ? [...ids].sort() : undefined;
}

function inferEnabledTransitions(
  model: Model,
  predicate: StatePredicateIR | StepPredicateIR,
): string[] {
  const ids: string[] = [];
  const walkExpr = (expr: ExprIR): void => {
    switch (expr.kind) {
      case "transitionEnabled":
        ids.push(expr.transitionId);
        break;
      case "transitionEnabledPrefix":
        for (const transition of model.transitions) {
          if (transition.id.startsWith(expr.prefix)) ids.push(transition.id);
        }
        break;
      case "eq":
      case "neq":
      case "and":
      case "or":
        for (const arg of expr.args) walkExpr(arg);
        break;
      case "not":
        walkExpr(expr.args[0]);
        break;
      case "cond":
        for (const arg of expr.args) walkExpr(arg);
        break;
      case "updateField":
        walkExpr(expr.target);
        walkExpr(expr.value);
        break;
      case "tagIs":
        walkExpr(expr.arg);
        break;
      case "lenCat":
        walkExpr(expr.arg);
        break;
      case "read":
      case "readPre":
      case "readOpArg":
      case "lit":
      case "freshToken":
        break;
      case "lt":
      case "lte":
      case "gt":
      case "gte":
      case "add":
      case "sub":
      case "mod":
        walkExpr(expr.args[0]);
        walkExpr(expr.args[1]);
        break;
    }
  };
  if ("kind" in predicate) {
    walkExpr(predicate);
    return ids;
  }
  if ("step" in predicate) {
    if (predicate.pre) walkExpr(predicate.pre);
    if (predicate.post) walkExpr(predicate.post);
    if (predicate.step.transitionId) ids.push(predicate.step.transitionId);
    return ids;
  }
  return ids;
}
