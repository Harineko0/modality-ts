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

export { evalStatePredicate, StatePredicateEvalError } from "../ir/eval.js";
export type {
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

export interface StepFacts {
  transition: import("../ir/types.js").Transition;
  enqueued(op: string): boolean;
  resolved(op: string, outcome?: string): boolean;
  navigated(): boolean;
  navigatedTo(route: string): boolean;
  op?: { id: string; continuation?: string; args: Record<string, unknown> };
}

export function readVar(varId: string, path?: readonly string[]): ExprIR {
  return { kind: "read", var: varId, path };
}

export function readPreVar(varId: string, path?: readonly string[]): ExprIR {
  return { kind: "readPre", var: varId, path };
}

export function readOpArg(key: string): ExprIR {
  return { kind: "readOpArg", key };
}

export function lit(value: Value): ExprIR {
  return { kind: "lit", value };
}

export function eq(left: ExprIR, right: ExprIR): ExprIR {
  return { kind: "eq", args: [left, right] };
}

export function neq(left: ExprIR, right: ExprIR): ExprIR {
  return { kind: "neq", args: [left, right] };
}

export function andExpr(...args: readonly ExprIR[]): ExprIR {
  return { kind: "and", args };
}

export function orExpr(...args: readonly ExprIR[]): ExprIR {
  return { kind: "or", args };
}

export function notExpr(arg: ExprIR): ExprIR {
  return { kind: "not", args: [arg] };
}

export function enabled(_model: Model, transitionId: string): ExprIR {
  return { kind: "transitionEnabled", transitionId };
}

export function enabledTransitionPrefix(_model: Model, prefix: string): ExprIR {
  return { kind: "transitionEnabledPrefix", prefix };
}

export function stepEnqueued(op: string): StepPredicateFlat {
  return { enqueued: op };
}

export function stepResolved(op: string, outcome?: string): StepPredicateFlat {
  return { resolved: outcome === undefined ? [op] : [op, outcome] };
}

export function stepTransitionId(transitionId: string): StepPredicateFlat {
  return { transitionId };
}

export function stepAny(): StepPredicateFlat {
  return {};
}

export function always(
  model: Model,
  predicate: StatePredicateIR,
  options: PropertyOptions = {},
): Property {
  return {
    kind: "always",
    name: options.name ?? "always",
    predicate,
    reads: propertyReads(model, options, predicate),
    enabledTransitions: propertyEnabledTransitions(model, options, predicate),
    includeUnmounted: options.includeUnmounted,
  };
}

export function alwaysStep(
  model: Model,
  predicate: StepPredicateIR,
  options: PropertyOptions = {},
): Property {
  return {
    kind: "alwaysStep",
    name: options.name ?? "alwaysStep",
    predicate,
    reads: propertyReads(model, options, predicate),
    enabledTransitions: propertyEnabledTransitions(model, options, predicate),
    includeUnmounted: options.includeUnmounted,
  };
}

export function reachable(
  model: Model,
  predicate: StatePredicateIR,
  options: PropertyOptions = {},
): Property {
  return {
    kind: "reachable",
    name: options.name ?? "reachable",
    predicate,
    reads: propertyReads(model, options, predicate),
    enabledTransitions: propertyEnabledTransitions(model, options, predicate),
    includeUnmounted: options.includeUnmounted,
  };
}

export function leadsToWithin(
  model: Model,
  trigger: StepPredicateFlat,
  goal: StatePredicateIR,
  options: PropertyOptions & {
    budget: { steps?: number; environment?: number };
    allowUserEvents?: boolean;
  },
): Property {
  return {
    kind: "leadsToWithin",
    name: options.name ?? "leadsToWithin",
    trigger,
    goal,
    budget: options.budget,
    allowUserEvents: options.allowUserEvents,
    reads: propertyReads(model, options, goal),
    enabledTransitions: propertyEnabledTransitions(model, options, goal),
    includeUnmounted: options.includeUnmounted,
  };
}

export function reachableFrom(
  model: Model,
  when: StatePredicateIR,
  goal: StatePredicateIR,
  options: PropertyOptions = {},
): Property {
  return {
    kind: "reachableFrom",
    name: options.name ?? "reachableFrom",
    when,
    goal,
    reads: propertyReads(model, options, when, goal),
    enabledTransitions: propertyEnabledTransitions(model, options, when, goal),
    includeUnmounted: options.includeUnmounted,
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
        reads.add("sys:route");
        const transition = model.transitions.find(
          (candidate) => candidate.id === expr.transitionId,
        );
        if (transition) {
          for (const id of transition.reads) reads.add(id);
          for (const id of transition.writes) reads.add(id);
        }
        break;
      }
      case "transitionEnabledPrefix": {
        reads.add("sys:route");
        for (const transition of model.transitions) {
          if (!transition.id.startsWith(expr.prefix)) continue;
          for (const id of transition.reads) reads.add(id);
          for (const id of transition.writes) reads.add(id);
        }
        break;
      }
      case "readOpArg":
      case "lit":
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
    return [...reads];
  }
  return [...reads];
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
