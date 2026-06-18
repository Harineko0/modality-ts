import { exprReads } from "modality-ts/core";
import type {
  EffectIR,
  ExprIR,
  Model,
  Property,
  StatePredicateIR,
  StepPredicateFlat,
  StepPredicateIR,
  Transition,
} from "modality-ts/core";
import type { MountScopeDependency, PendingQueueDependency } from "../types.js";
import {
  buildModelDependencyGraph,
  computeStateSliceClosure,
  computeTargetedStepSliceClosure,
  enabledTransitionSeedVars,
} from "./dependency-graph.js";

export type PropertySliceMode = "state" | "targetedStep" | "full";

export interface SliceDiagnostics {
  mountScopeDependencies?: readonly MountScopeDependency[];
  pendingQueueDependencies?: readonly PendingQueueDependency[];
}

interface PropertyDependencyRequest {
  stateReads: readonly string[];
  enabledTransitions: readonly string[];
  targetTransitionIds: readonly string[];
  stepFactVars: readonly string[];
  pendingQueueDependencies: readonly PendingQueueDependency[];
  mode: PropertySliceMode;
  unsliceableReason?: string;
}

export function sliceModel(
  model: Model,
  propertyReads: readonly string[],
): Model {
  return sliceModelForProperty(model, { reads: propertyReads }).model;
}

export function targetedAlwaysStepTransitionIds(
  property: Property,
): readonly string[] {
  if (property.kind !== "alwaysStep") return [];
  const predicate = property.predicate;
  if ("step" in predicate) {
    return predicate.step.transitionId ? [predicate.step.transitionId] : [];
  }
  return predicate.transitionId ? [predicate.transitionId] : [];
}

export function propertySliceMode(
  model: Model,
  property: Property,
): PropertySliceMode {
  return collectPropertyDependencyRequest(model, property).mode;
}

export function sliceModelForCheckProperty(
  model: Model,
  property: Property,
): { model: Model; mode: PropertySliceMode; diagnostics?: SliceDiagnostics } {
  const deps = collectPropertyDependencyRequest(model, property);
  switch (deps.mode) {
    case "state": {
      const sliced = sliceModelForProperty(model, dependencySliceInput(deps));
      return {
        model: sliced.model,
        mode: deps.mode,
        diagnostics: mergeSliceDiagnostics(sliced.diagnostics, {
          pendingQueueDependencies: deps.pendingQueueDependencies,
        }),
      };
    }
    case "targetedStep": {
      const sliced = sliceModelForTargetedStepProperty(
        model,
        property as Extract<Property, { kind: "alwaysStep" }>,
        deps,
      );
      return {
        model: sliced.model,
        mode: deps.mode,
        diagnostics: mergeSliceDiagnostics(sliced.diagnostics, {
          pendingQueueDependencies: deps.pendingQueueDependencies,
        }),
      };
    }
    case "full":
      return {
        model,
        mode: deps.mode,
        diagnostics: mergeSliceDiagnostics({
          pendingQueueDependencies: deps.pendingQueueDependencies,
        }),
      };
  }
}

export function sliceModelForProperty(
  model: Model,
  property: Pick<Property, "reads" | "enabledTransitions">,
): { model: Model; diagnostics?: SliceDiagnostics } {
  const graph = buildModelDependencyGraph(model);
  const { neededVars, neededTransitions, mountScopeDependencies } =
    computeStateSliceClosure(graph, {
      propertyReads: property.reads ?? [],
      enabledTransitionIds: property.enabledTransitions ?? [],
    });
  const vars = model.vars.filter((decl) => neededVars.has(decl.id));
  const transitions = finalizeSlicedTransitions(
    model,
    vars,
    model.transitions.filter((transition) =>
      neededTransitions.has(transition.id),
    ),
  );
  return {
    model: { ...model, vars, transitions },
    diagnostics:
      mountScopeDependencies.length > 0
        ? { mountScopeDependencies }
        : undefined,
  };
}

export function sliceModelForTargetedStepProperty(
  model: Model,
  property: Extract<Property, { kind: "alwaysStep" }>,
  deps: Pick<
    PropertyDependencyRequest,
    "stateReads" | "enabledTransitions" | "stepFactVars"
  > = collectPropertyDependencyRequest(model, property),
): { model: Model; diagnostics?: SliceDiagnostics } {
  const graph = buildModelDependencyGraph(model);
  const targetIds = targetedAlwaysStepTransitionIds(property);
  const { executionVars, neededTransitions, mountScopeDependencies } =
    computeTargetedStepSliceClosure(graph, {
      stateReads: deps.stateReads,
      stepFactVars: deps.stepFactVars,
      enabledTransitionIds: deps.enabledTransitions,
      targetTransitionIds: targetIds,
    });
  const vars = model.vars.filter((decl) => executionVars.has(decl.id));
  const transitions = finalizeSlicedTransitions(
    model,
    vars,
    model.transitions.filter((transition) =>
      neededTransitions.has(transition.id),
    ),
  );
  return {
    model: { ...model, vars, transitions },
    diagnostics:
      mountScopeDependencies.length > 0
        ? { mountScopeDependencies }
        : undefined,
  };
}

function collectPropertyDependencyRequest(
  model: Model,
  property: Property,
): PropertyDependencyRequest {
  const opaqueReason = opaquePropertyReason(property);
  if (opaqueReason) {
    return {
      stateReads: [],
      enabledTransitions: [],
      targetTransitionIds: [],
      stepFactVars: [],
      pendingQueueDependencies: [],
      mode: "full",
      unsliceableReason: opaqueReason,
    };
  }

  switch (property.kind) {
    case "always":
    case "reachable":
      return finalizePropertyDependencyRequest(model, property, {
        stateReads: collectStatePredicateReads(
          property.reads,
          property.predicate,
        ),
        enabledTransitions: collectEnabledTransitions(
          model,
          property.enabledTransitions,
          property.predicate,
        ),
        targetTransitionIds: [],
        stepFactVars: [],
        pendingQueueDependencies: [],
      });
    case "reachableFrom":
      return finalizePropertyDependencyRequest(model, property, {
        stateReads: unionSorted(
          property.reads,
          collectExprStateReads(property.when),
          collectExprStateReads(property.goal),
        ),
        enabledTransitions: collectEnabledTransitions(
          model,
          property.enabledTransitions,
          property.when,
          property.goal,
        ),
        targetTransitionIds: [],
        stepFactVars: [],
        pendingQueueDependencies: [],
      });
    case "leadsToWithin":
      return finalizePropertyDependencyRequest(model, property, {
        stateReads: unionSorted(
          property.reads,
          collectExprStateReads(property.goal),
        ),
        enabledTransitions: collectEnabledTransitions(
          model,
          property.enabledTransitions,
          property.goal,
        ),
        targetTransitionIds: stepPredicateFlatTransitionIds(property.trigger),
        stepFactVars: stepFactVars(model, property.trigger),
        pendingQueueDependencies: collectPendingQueueDependencies(
          model,
          property.trigger,
        ),
      });
    case "alwaysStep":
      return collectAlwaysStepDependencyRequest(model, property);
  }
}

function collectAlwaysStepDependencyRequest(
  model: Model,
  property: Extract<Property, { kind: "alwaysStep" }>,
): PropertyDependencyRequest {
  const predicate = property.predicate;
  const flat = "step" in predicate ? predicate.step : predicate;
  const stateReads = unionSorted(
    property.reads,
    "step" in predicate && predicate.pre
      ? collectExprStateReads(predicate.pre)
      : undefined,
    "step" in predicate && predicate.post
      ? collectExprStateReads(predicate.post)
      : undefined,
  );
  const enabledTransitions = unionSorted(
    property.enabledTransitions,
    collectPredicateEnabledTransitions(model, predicate),
    stepPredicateFlatTransitionIds(flat),
  );
  const stepFacts = stepFactVars(model, predicate);
  const targetTransitionIds = stepPredicateFlatTransitionIds(flat);
  const base = {
    stateReads,
    enabledTransitions,
    targetTransitionIds,
    stepFactVars: stepFacts,
    pendingQueueDependencies: collectPendingQueueDependencies(model, predicate),
  };

  if (isPositiveTargetedAlwaysStep(property)) {
    return { ...base, mode: "full" };
  }
  if (canUseTargetedStepSlice(property)) {
    return { ...base, mode: "targetedStep" };
  }
  if (!hasKnownAlwaysStepDependencies(base)) {
    return { ...base, mode: "full" };
  }
  return { ...base, mode: "state" };
}

function finalizePropertyDependencyRequest(
  _model: Model,
  _property: Property,
  request: Omit<PropertyDependencyRequest, "mode" | "unsliceableReason">,
): PropertyDependencyRequest {
  return { ...request, mode: "state" };
}

function dependencySliceInput(
  deps: PropertyDependencyRequest,
): Pick<Property, "reads" | "enabledTransitions"> {
  return {
    reads: unionSorted(deps.stateReads, deps.stepFactVars),
    enabledTransitions: unionSorted(
      deps.enabledTransitions,
      deps.targetTransitionIds,
    ),
  };
}

function mergeSliceDiagnostics(
  ...groups: readonly (SliceDiagnostics | undefined)[]
): SliceDiagnostics | undefined {
  const mountScopeDependencies = mergeMountScopeDependencies(
    ...groups.map((group) => group?.mountScopeDependencies),
  );
  const pendingQueueDependencies = mergePendingQueueDependencies(
    ...groups.map((group) => group?.pendingQueueDependencies),
  );
  if (
    mountScopeDependencies.length === 0 &&
    pendingQueueDependencies.length === 0
  ) {
    return undefined;
  }
  return {
    ...(mountScopeDependencies.length > 0 ? { mountScopeDependencies } : {}),
    ...(pendingQueueDependencies.length > 0
      ? { pendingQueueDependencies }
      : {}),
  };
}

function hasKnownAlwaysStepDependencies(
  request: Pick<
    PropertyDependencyRequest,
    "stateReads" | "enabledTransitions" | "stepFactVars"
  >,
): boolean {
  return (
    request.stateReads.length > 0 ||
    request.enabledTransitions.length > 0 ||
    request.stepFactVars.length > 0
  );
}

function isPositiveTargetedAlwaysStep(
  property: Extract<Property, { kind: "alwaysStep" }>,
): boolean {
  const predicate = property.predicate;
  if ("step" in predicate) {
    return (
      predicate.negate !== true && predicate.step.transitionId !== undefined
    );
  }
  return predicate.transitionId !== undefined;
}

function opaquePropertyReason(property: Property): string | undefined {
  switch (property.kind) {
    case "always":
    case "reachable":
      return statePredicateOpaqueReason(property.predicate);
    case "reachableFrom":
      return (
        statePredicateOpaqueReason(property.when) ??
        statePredicateOpaqueReason(property.goal)
      );
    case "leadsToWithin":
      return (
        statePredicateOpaqueReason(property.goal) ??
        stepPredicateOpaqueReason(property.trigger)
      );
    case "alwaysStep":
      return stepPredicateOpaqueReason(property.predicate);
  }
}

function statePredicateOpaqueReason(
  predicate: StatePredicateIR,
): string | undefined {
  if (!isExprIR(predicate)) {
    return "property predicate is not serializable IR";
  }
  return exprOpaqueReason(predicate);
}

function stepPredicateOpaqueReason(
  predicate: StepPredicateIR,
): string | undefined {
  if ("step" in predicate) {
    const preReason = predicate.pre
      ? exprOpaqueReason(predicate.pre)
      : undefined;
    const postReason = predicate.post
      ? exprOpaqueReason(predicate.post)
      : undefined;
    return preReason ?? postReason;
  }
  return undefined;
}

function isExprIR(value: unknown): value is ExprIR {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as { kind: unknown }).kind === "string"
  );
}

function exprOpaqueReason(expr: ExprIR): string | undefined {
  switch (expr.kind) {
    case "lit":
    case "read":
    case "readPre":
    case "readOpArg":
    case "transitionEnabled":
    case "transitionEnabledPrefix":
    case "freshToken":
      return undefined;
    case "eq":
    case "neq":
    case "and":
    case "or":
      for (const arg of expr.args) {
        const reason = exprOpaqueReason(arg);
        if (reason) return reason;
      }
      return undefined;
    case "not":
      return exprOpaqueReason(expr.args[0]);
    case "cond":
      for (const arg of expr.args) {
        const reason = exprOpaqueReason(arg);
        if (reason) return reason;
      }
      return undefined;
    case "updateField":
      return exprOpaqueReason(expr.target) ?? exprOpaqueReason(expr.value);
    case "tagIs":
      return exprOpaqueReason(expr.arg);
    case "lenCat":
      return exprOpaqueReason(expr.arg);
    case "lt":
    case "lte":
    case "gt":
    case "gte":
    case "add":
    case "sub":
    case "mod":
      return exprOpaqueReason(expr.args[0]) ?? exprOpaqueReason(expr.args[1]);
  }
}

function collectStatePredicateReads(
  explicitReads: readonly string[] | undefined,
  predicate: StatePredicateIR,
): readonly string[] {
  return unionSorted(explicitReads, collectExprStateReads(predicate));
}

function collectExprStateReads(expr: ExprIR): readonly string[] {
  const reads = new Set(exprReads(expr));
  collectSupplementalExprStateReads(expr, reads);
  return [...reads].sort();
}

function collectSupplementalExprStateReads(
  expr: ExprIR,
  reads: Set<string>,
): void {
  switch (expr.kind) {
    case "readPre":
      reads.add(expr.var);
      return;
    case "freshToken":
      reads.add(expr.domainOf);
      return;
    case "eq":
    case "neq":
    case "and":
    case "or":
      for (const arg of expr.args)
        collectSupplementalExprStateReads(arg, reads);
      return;
    case "not":
      collectSupplementalExprStateReads(expr.args[0], reads);
      return;
    case "cond":
      for (const arg of expr.args)
        collectSupplementalExprStateReads(arg, reads);
      return;
    case "updateField":
      collectSupplementalExprStateReads(expr.target, reads);
      collectSupplementalExprStateReads(expr.value, reads);
      return;
    case "tagIs":
      collectSupplementalExprStateReads(expr.arg, reads);
      return;
    case "lenCat":
      collectSupplementalExprStateReads(expr.arg, reads);
      return;
    case "lt":
    case "lte":
    case "gt":
    case "gte":
    case "add":
    case "sub":
    case "mod":
      collectSupplementalExprStateReads(expr.args[0], reads);
      collectSupplementalExprStateReads(expr.args[1], reads);
      return;
    case "lit":
    case "read":
    case "readOpArg":
    case "transitionEnabled":
    case "transitionEnabledPrefix":
      return;
  }
}

function collectEnabledTransitions(
  model: Model,
  explicitTransitions: readonly string[] | undefined,
  ...predicates: readonly (StatePredicateIR | StepPredicateIR)[]
): readonly string[] {
  const ids = new Set(explicitTransitions ?? []);
  for (const predicate of predicates) {
    for (const id of collectPredicateEnabledTransitions(model, predicate)) {
      ids.add(id);
    }
  }
  return [...ids].sort();
}

function collectPredicateEnabledTransitions(
  model: Model,
  predicate: StatePredicateIR | StepPredicateIR,
): readonly string[] {
  if ("kind" in predicate) {
    return collectExprEnabledTransitions(model, predicate);
  }
  const ids = new Set<string>();
  if ("step" in predicate) {
    if (predicate.pre) {
      for (const id of collectExprEnabledTransitions(model, predicate.pre)) {
        ids.add(id);
      }
    }
    if (predicate.post) {
      for (const id of collectExprEnabledTransitions(model, predicate.post)) {
        ids.add(id);
      }
    }
    for (const id of stepPredicateFlatTransitionIds(predicate.step))
      ids.add(id);
    return [...ids].sort();
  }
  return stepPredicateFlatTransitionIds(predicate);
}

function collectExprEnabledTransitions(
  model: Model,
  expr: ExprIR,
): readonly string[] {
  const ids: string[] = [];
  const walkExpr = (node: ExprIR): void => {
    switch (node.kind) {
      case "transitionEnabled":
        ids.push(node.transitionId);
        break;
      case "transitionEnabledPrefix":
        for (const transition of model.transitions) {
          if (transition.id.startsWith(node.prefix)) ids.push(transition.id);
        }
        break;
      case "eq":
      case "neq":
      case "and":
      case "or":
        for (const arg of node.args) walkExpr(arg);
        break;
      case "not":
        walkExpr(node.args[0]);
        break;
      case "cond":
        for (const arg of node.args) walkExpr(arg);
        break;
      case "updateField":
        walkExpr(node.target);
        walkExpr(node.value);
        break;
      case "tagIs":
        walkExpr(node.arg);
        break;
      case "lenCat":
        walkExpr(node.arg);
        break;
      case "lt":
      case "lte":
      case "gt":
      case "gte":
      case "add":
      case "sub":
      case "mod":
        walkExpr(node.args[0]);
        walkExpr(node.args[1]);
        break;
      case "read":
      case "readPre":
      case "readOpArg":
      case "lit":
      case "freshToken":
        break;
    }
  };
  walkExpr(expr);
  return [...new Set(ids)].sort();
}

function stepPredicateFlatTransitionIds(
  flat: StepPredicateFlat,
): readonly string[] {
  return flat.transitionId ? [flat.transitionId] : [];
}

function unionSorted(
  ...groups: readonly (readonly string[] | undefined)[]
): readonly string[] {
  const ids = new Set<string>();
  for (const group of groups) {
    if (!group) continue;
    for (const id of group) ids.add(id);
  }
  return [...ids].sort();
}

function canUseTargetedStepSlice(
  property: Extract<Property, { kind: "alwaysStep" }>,
): boolean {
  const predicate = property.predicate;
  return (
    "step" in predicate &&
    predicate.negate === true &&
    predicate.step.transitionId !== undefined
  );
}

function stepFactVars(model: Model, predicate: StepPredicateIR): string[] {
  const flat = "step" in predicate ? predicate.step : predicate;
  const vars: string[] = [];
  if (hasPendingStepFacts(flat)) {
    const queueId = solePendingQueueVarId(model);
    if (queueId) vars.push(queueId);
  }
  if (flat.changed !== undefined) {
    vars.push(flat.changed);
  }
  if (flat.changedTo !== undefined) {
    vars.push(flat.changedTo.var);
  }
  return vars;
}

function hasPendingStepFacts(flat: StepPredicateFlat): boolean {
  return (
    flat.enqueued !== undefined ||
    flat.resolved !== undefined ||
    flat.opId !== undefined ||
    flat.continuation !== undefined ||
    flat.opArgs !== undefined
  );
}

function collectPendingQueueDependencies(
  model: Model,
  predicate: StepPredicateIR,
): PendingQueueDependency[] {
  const flat = "step" in predicate ? predicate.step : predicate;
  const queueId = solePendingQueueVarId(model);
  if (!queueId || !hasPendingStepFacts(flat)) return [];

  const reasons: string[] = [];
  const opIds = new Set<string>();
  const continuations = new Set<string>();

  if (flat.enqueued !== undefined) {
    reasons.push("enqueued");
    opIds.add(flat.enqueued);
  }
  if (flat.resolved !== undefined) {
    reasons.push("resolved");
    opIds.add(flat.resolved[0]);
  }
  if (flat.opId !== undefined) {
    reasons.push("opId");
    opIds.add(flat.opId);
  }
  if (flat.continuation !== undefined) {
    reasons.push("continuation");
    continuations.add(flat.continuation);
  }
  if (flat.opArgs !== undefined) {
    reasons.push("opArgs");
  }

  return [
    {
      varId: queueId,
      reasons: [...reasons].sort(),
      ...(opIds.size > 0 ? { opIds: [...opIds].sort() } : {}),
      ...(continuations.size > 0
        ? { continuations: [...continuations].sort() }
        : {}),
    },
  ];
}

function mergePendingQueueDependencies(
  ...groups: readonly (readonly PendingQueueDependency[] | undefined)[]
): readonly PendingQueueDependency[] {
  const merged = new Map<string, PendingQueueDependency>();
  for (const dependencies of groups) {
    if (!dependencies) continue;
    for (const entry of dependencies) {
      const existing = merged.get(entry.varId);
      if (!existing) {
        merged.set(entry.varId, entry);
        continue;
      }
      merged.set(entry.varId, {
        varId: entry.varId,
        reasons: [...new Set([...existing.reasons, ...entry.reasons])].sort(),
        opIds:
          existing.opIds || entry.opIds
            ? [
                ...new Set([...(existing.opIds ?? []), ...(entry.opIds ?? [])]),
              ].sort()
            : undefined,
        continuations:
          existing.continuations || entry.continuations
            ? [
                ...new Set([
                  ...(existing.continuations ?? []),
                  ...(entry.continuations ?? []),
                ]),
              ].sort()
            : undefined,
      });
    }
  }
  return [...merged.values()].sort((left, right) =>
    left.varId.localeCompare(right.varId),
  );
}

function pendingQueueVarIds(model: Model): Set<string> {
  return new Set(
    model.vars
      .filter((decl) => decl.role?.kind === "pending-queue")
      .map((decl) => decl.id),
  );
}

function finalizeSlicedTransitions(
  model: Model,
  vars: readonly Model["vars"][number][],
  transitions: readonly Transition[],
): Transition[] {
  const pendingQueues = pendingQueueVarIds(model);
  const retainsPending = vars.some((decl) => pendingQueues.has(decl.id));
  if (retainsPending) return [...transitions];
  return transitions.map((transition) => ({
    ...transition,
    effect: stripEnqueueDequeueEffects(transition.effect),
    reads: transition.reads.filter((id) => !pendingQueues.has(id)),
    writes: transition.writes.filter((id) => !pendingQueues.has(id)),
  }));
}

function stripEnqueueDequeueEffects(effect: EffectIR): EffectIR {
  switch (effect.kind) {
    case "enqueue":
    case "dequeue":
      return { kind: "seq", effects: [] };
    case "seq": {
      const effects = effect.effects
        .map(stripEnqueueDequeueEffects)
        .filter((child) => child.kind !== "seq" || child.effects.length > 0);
      if (effects.length === 0) return { kind: "seq", effects: [] };
      if (effects.length === 1) return effects[0]!;
      return { kind: "seq", effects };
    }
    case "if": {
      return {
        kind: "if",
        cond: effect.cond,
        // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
        then: stripEnqueueDequeueEffects(effect.then),
        else: stripEnqueueDequeueEffects(effect.else),
      };
    }
    default:
      return effect;
  }
}

function solePendingQueueVarId(model: Model): string | undefined {
  const graph = buildModelDependencyGraph(model);
  return graph.solePendingQueueVarId;
}

export function enabledTransitionVars(
  model: Model,
  transitionIds: Set<string>,
): string[] {
  return enabledTransitionSeedVars(
    buildModelDependencyGraph(model),
    transitionIds,
  );
}

export function mergeMountScopeDependencies(
  ...groups: readonly (readonly MountScopeDependency[] | undefined)[]
): readonly MountScopeDependency[] {
  const merged = new Map<
    string,
    { guardReads: readonly string[]; retainedBecause: Set<string> }
  >();
  for (const deps of groups) {
    if (!deps) continue;
    for (const dep of deps) {
      let entry = merged.get(dep.varId);
      if (!entry) {
        entry = { guardReads: dep.guardReads, retainedBecause: new Set() };
        merged.set(dep.varId, entry);
      }
      for (const reason of dep.retainedBecause) {
        entry.retainedBecause.add(reason);
      }
    }
  }
  return [...merged.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([varId, entry]) => ({
      varId,
      guardReads: entry.guardReads,
      retainedBecause: [...entry.retainedBecause].sort(),
    }));
}

export function canSliceProperty(model: Model, property: Property): boolean {
  return (
    collectPropertyDependencyRequest(model, property).unsliceableReason ===
    undefined
  );
}

export function propertySlicingSkipReason(
  model: Model,
  property: Property,
): string | undefined {
  return collectPropertyDependencyRequest(model, property).unsliceableReason;
}

export function canSliceAllProperties(
  model: Model,
  properties: readonly Property[],
): boolean {
  return (
    properties.length > 0 &&
    properties.every((property) => canSliceProperty(model, property))
  );
}
