import { mountGuardForScope } from "../ir/domains.js";
import type {
  ExprIR,
  Model,
  Property,
  PropertyOptions,
  StatePredicateIR,
  StepPredicateFlat,
  StepPredicateIR,
  TemporalFormula,
  Value,
} from "../ir/types.js";
import { exprReads } from "../ir/validator.js";
import { isVariable, lift, type Operand, type Variable } from "./operand.js";
import {
  type PendingSpec,
  always as registerAlways,
  alwaysStep as registerAlwaysStep,
  inevitably as registerInevitably,
  leadsToWithin as registerLeadsToWithin,
  property as registerProperty,
  reachable as registerReachable,
  reachableFrom as registerReachableFrom,
} from "./registry.js";

export { evalStatePredicate, StatePredicateEvalError } from "../ir/eval.js";
export type {
  FairnessConstraint,
  Model,
  ModelState,
  Property,
  PropertyArtifact,
  PropertyOptions,
  StatePredicateIR,
  StepPredicateComposite,
  StepPredicateFlat,
  StepPredicateIR,
  TemporalFormula,
  Value,
} from "../ir/types.js";
export type { FairnessConstraint as FormulaFairnessConstraint } from "./formula.js";

export { ctl } from "./formula.js";
export {
  isExprIR,
  isVariable,
  lift,
  type Operand,
  type Variable,
  variable,
} from "./operand.js";

/** Branded transition id for generated `*.modals.ts` handles. Plain strings remain assignable. */
export type TransitionRef<Id extends string = string> = Id & {
  readonly __transition?: Id;
};
export { type ComponentLike, s } from "./accessor.js";
export {
  group,
  harvest,
  type PendingSpec,
  resetRegistry,
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
export const property = registerProperty;
export const inevitably = registerInevitably;

// ---------------------------------------------------------------------------
// Finalization: PendingSpec → Property
// ---------------------------------------------------------------------------

export function finalizeProperties(
  model: Model,
  pending: readonly PendingSpec[],
): Property[] {
  return pending.map((spec) => finalizeSpec(model, spec));
}

function finalizeSpec(model: Model, spec: PendingSpec): Property {
  switch (spec.kind) {
    case "temporal":
      return finalizeTemporal(model, spec);
    case "alwaysStep":
      return finalizeAlwaysStep(model, spec);
    case "leadsToWithin":
      return finalizeLeadsToWithin(model, spec);
  }
}

function finalizeTemporal(
  model: Model,
  spec: Extract<PendingSpec, { kind: "temporal" }>,
): Property {
  const formula =
    spec.options.includeUnmounted === true
      ? spec.formula
      : injectMountGuards(model, spec.formula, "witness");
  const reads = temporalPropertyReads(
    model,
    spec.options,
    spec.formula,
    formula,
  );
  const enabledTransitions = propertyEnabledTransitions(
    model,
    spec.options,
    formula,
  );
  return {
    kind: "temporal",
    name: spec.name,
    formula,
    reads,
    enabledTransitions,
    includeUnmounted: spec.options.includeUnmounted,
    ...(spec.options.fairness ? { fairness: spec.options.fairness } : {}),
  };
}

type FormulaMountMode = "safety" | "witness";

function injectMountGuards(
  model: Model,
  formula: TemporalFormula,
  mode: FormulaMountMode,
): TemporalFormula {
  switch (formula.kind) {
    case "atom":
      return guardAtom(model, formula, mode);
    case "fnot":
      return {
        kind: "fnot",
        arg: injectMountGuards(model, formula.arg, oppositeMountMode(mode)),
      };
    case "fand":
    case "for":
      return {
        kind: formula.kind,
        args: formula.args.map((arg) => injectMountGuards(model, arg, mode)),
      };
    case "AG":
    case "AX":
      return {
        kind: formula.kind,
        arg: injectMountGuards(model, formula.arg, "safety"),
      };
    case "EX":
    case "EF":
    case "AF":
    case "EG":
      return {
        kind: formula.kind,
        arg: injectMountGuards(model, formula.arg, "witness"),
      };
    case "EU":
      return {
        kind: "EU",
        left: injectMountGuards(model, formula.left, "safety"),
        right: injectMountGuards(model, formula.right, "witness"),
      };
    case "AU":
      return {
        kind: "AU",
        left: injectMountGuards(model, formula.left, "safety"),
        right: injectMountGuards(model, formula.right, "witness"),
      };
  }
}

function oppositeMountMode(mode: FormulaMountMode): FormulaMountMode {
  return mode === "safety" ? "witness" : "safety";
}

function guardAtom(
  model: Model,
  formula: Extract<TemporalFormula, { kind: "atom" }>,
  mode: FormulaMountMode,
): TemporalFormula {
  const guards = mountGuardsForPredicateReads(model, formula.predicate);
  if (guards.length === 0) return formula;
  const mountGuard = andExprs(guards);
  return {
    kind: "atom",
    predicate:
      mode === "safety"
        ? or(not(mountGuard), formula.predicate)
        : and(mountGuard, formula.predicate),
  };
}

function mountGuardsForPredicateReads(
  model: Model,
  predicate: StatePredicateIR,
): ExprIR[] {
  const varsById = new Map((model.vars ?? []).map((decl) => [decl.id, decl]));
  const guards = new Map<string, ExprIR>();
  for (const id of exprReads(predicate)) {
    const decl = varsById.get(id);
    if (!decl) continue;
    const guard = mountGuardForScope(decl.scope);
    if (guard) guards.set(JSON.stringify(guard), guard);
  }
  return [...guards.values()];
}

function andExprs(args: readonly ExprIR[]): ExprIR {
  if (args.length === 0) return { kind: "lit", value: true };
  if (args.length === 1) return args[0]!;
  return { kind: "and", args };
}

function temporalPropertyReads(
  model: Model,
  options: PropertyOptions,
  originalFormula: TemporalFormula,
  formula: TemporalFormula,
): readonly string[] | undefined {
  if (options.reads === undefined) return inferReads(model, formula).sort();
  return [
    ...new Set([
      ...options.reads,
      ...mountGuardReadsForFormula(model, originalFormula),
    ]),
  ].sort();
}

function mountGuardReadsForFormula(
  model: Model,
  formula: TemporalFormula,
): readonly string[] {
  const reads = new Set<string>();
  const walk = (f: TemporalFormula): void => {
    switch (f.kind) {
      case "atom":
        for (const guard of mountGuardsForPredicateReads(model, f.predicate)) {
          for (const read of exprReads(guard)) reads.add(read);
        }
        break;
      case "fnot":
        walk(f.arg);
        break;
      case "fand":
      case "for":
        for (const arg of f.args) walk(arg);
        break;
      case "EX":
      case "AX":
      case "EF":
      case "AF":
      case "EG":
      case "AG":
        walk(f.arg);
        break;
      case "EU":
      case "AU":
        walk(f.left);
        walk(f.right);
        break;
    }
  };
  walk(formula);
  return [...reads].sort();
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

function finalizeLeadsToWithin(
  model: Model,
  spec: Extract<PendingSpec, { kind: "leadsToWithin" }>,
): Property {
  const goal = lift(spec.goal);
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

function propertyReads(
  model: Model,
  options: PropertyOptions,
  ...subjects: readonly (StatePredicateIR | StepPredicateIR | TemporalFormula)[]
): readonly string[] | undefined {
  if (options.reads !== undefined) return options.reads;
  const reads = new Set<string>();
  for (const subject of subjects) {
    for (const read of inferReads(model, subject)) reads.add(read);
  }
  return [...reads].sort();
}

function inferReads(
  model: Model,
  subject: StatePredicateIR | StepPredicateIR | TemporalFormula,
): string[] {
  // TemporalFormula (has a `kind` but not an ExprIR kind) — recurse into atoms
  if (isTemporalFormula(subject)) {
    return inferTemporalReads(model, subject);
  }
  // ExprIR (state predicate)
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
  if ("kind" in subject && isExprKind(subject.kind)) {
    walkExpr(subject as ExprIR);
    return [...reads];
  }
  if ("step" in subject) {
    if (subject.pre) walkExpr(subject.pre);
    if (subject.post) walkExpr(subject.post);
    for (const id of inferStepFactReads(subject.step)) reads.add(id);
    return [...reads];
  }
  for (const id of inferStepFactReads(subject as StepPredicateFlat))
    reads.add(id);
  return [...reads];
}

function inferTemporalReads(model: Model, formula: TemporalFormula): string[] {
  const reads = new Set<string>();
  const walk = (f: TemporalFormula): void => {
    switch (f.kind) {
      case "atom":
        for (const id of inferReads(model, f.predicate)) reads.add(id);
        break;
      case "fnot":
        walk(f.arg);
        break;
      case "fand":
      case "for":
        for (const arg of f.args) walk(arg);
        break;
      case "EX":
      case "AX":
      case "EF":
      case "AF":
      case "EG":
      case "AG":
        walk(f.arg);
        break;
      case "EU":
      case "AU":
        walk(f.left);
        walk(f.right);
        break;
    }
  };
  walk(formula);
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
  ...subjects: readonly (StatePredicateIR | StepPredicateIR | TemporalFormula)[]
): readonly string[] | undefined {
  const ids = new Set(options.enabledTransitions ?? []);
  for (const subject of subjects) {
    for (const id of inferEnabledTransitions(model, subject)) ids.add(id);
  }
  return ids.size > 0 ? [...ids].sort() : undefined;
}

function inferEnabledTransitions(
  model: Model,
  subject: StatePredicateIR | StepPredicateIR | TemporalFormula,
): string[] {
  if (isTemporalFormula(subject)) {
    return inferTemporalEnabledTransitions(model, subject);
  }
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
  if ("kind" in subject && isExprKind(subject.kind)) {
    walkExpr(subject as ExprIR);
    return ids;
  }
  if ("step" in subject) {
    if (subject.pre) walkExpr(subject.pre);
    if (subject.post) walkExpr(subject.post);
    if (subject.step.transitionId) ids.push(subject.step.transitionId);
    return ids;
  }
  return ids;
}

function inferTemporalEnabledTransitions(
  model: Model,
  formula: TemporalFormula,
): string[] {
  const ids = new Set<string>();
  const walk = (f: TemporalFormula): void => {
    switch (f.kind) {
      case "atom":
        for (const id of inferEnabledTransitions(model, f.predicate))
          ids.add(id);
        break;
      case "fnot":
        walk(f.arg);
        break;
      case "fand":
      case "for":
        for (const arg of f.args) walk(arg);
        break;
      case "EX":
      case "AX":
      case "EF":
      case "AF":
      case "EG":
      case "AG":
        walk(f.arg);
        break;
      case "EU":
      case "AU":
        walk(f.left);
        walk(f.right);
        break;
    }
  };
  walk(formula);
  return [...ids];
}

// ---------------------------------------------------------------------------
// Type narrowing helpers
// ---------------------------------------------------------------------------

const TEMPORAL_FORMULA_KINDS = new Set([
  "atom",
  "fnot",
  "fand",
  "for",
  "EX",
  "AX",
  "EF",
  "AF",
  "EG",
  "AG",
  "EU",
  "AU",
]);

function isTemporalFormula(
  subject: StatePredicateIR | StepPredicateIR | TemporalFormula,
): subject is TemporalFormula {
  return "kind" in subject && TEMPORAL_FORMULA_KINDS.has(subject.kind);
}

const EXPR_IR_KINDS = new Set([
  "lit",
  "read",
  "eq",
  "neq",
  "and",
  "or",
  "not",
  "cond",
  "updateField",
  "tagIs",
  "lenCat",
  "freshToken",
  "transitionEnabled",
  "transitionEnabledPrefix",
  "readPre",
  "readOpArg",
  "lt",
  "lte",
  "gt",
  "gte",
  "add",
  "sub",
  "mod",
]);

function isExprKind(kind: string): boolean {
  return EXPR_IR_KINDS.has(kind);
}
