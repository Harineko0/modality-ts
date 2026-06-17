import { exprReads } from "modality-ts/core";
import type { Model, Property, StepPredicateIR } from "modality-ts/core";

export type PropertySliceMode = "state" | "targetedStep" | "full";

export function sliceModel(
  model: Model,
  propertyReads: readonly string[],
): Model {
  return sliceModelForProperty(model, { reads: propertyReads });
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

export function propertySliceMode(property: Property): PropertySliceMode {
  if (property.kind === "alwaysStep") {
    return canUseTargetedStepSlice(property) ? "targetedStep" : "full";
  }
  if (property.kind === "leadsToWithin") return "full";
  return "state";
}

export function sliceModelForCheckProperty(
  model: Model,
  property: Property,
): { model: Model; mode: PropertySliceMode } {
  const mode = propertySliceMode(property);
  switch (mode) {
    case "state":
      return { model: sliceModelForProperty(model, property), mode };
    case "targetedStep":
      return {
        model: sliceModelForTargetedStepProperty(
          model,
          property as Extract<Property, { kind: "alwaysStep" }>,
        ),
        mode,
      };
    case "full":
      return { model, mode };
  }
}

export function sliceModelForProperty(
  model: Model,
  property: Pick<Property, "reads" | "enabledTransitions">,
): Model {
  const forcedTransitions = new Set(property.enabledTransitions ?? []);
  const neededVars = new Set([
    ...(property.reads ?? []),
    ...enabledTransitionVars(model, forcedTransitions),
  ]);
  const neededTransitions = new Set<string>();

  let changed = true;
  while (changed) {
    changed = false;
    if (addRouteVarsForNeededRouteLocals(model, neededVars)) {
      changed = true;
    }
    for (const transition of model.transitions) {
      if (!transition.writes.some((write) => neededVars.has(write))) continue;
      if (!neededTransitions.has(transition.id)) {
        neededTransitions.add(transition.id);
        changed = true;
      }
      for (const id of [...transition.reads, ...transition.writes]) {
        if (!neededVars.has(id)) {
          neededVars.add(id);
          changed = true;
        }
      }
    }
  }

  for (const id of forcedTransitions) {
    neededTransitions.add(id);
    const transition = model.transitions.find(
      (candidate) => candidate.id === id,
    );
    if (!transition) continue;
    for (const varId of [...transition.reads, ...transition.writes]) {
      neededVars.add(varId);
    }
  }

  const vars = model.vars.filter((decl) => neededVars.has(decl.id));
  const transitions = model.transitions.filter((transition) =>
    neededTransitions.has(transition.id),
  );
  return { ...model, vars, transitions };
}

export function sliceModelForTargetedStepProperty(
  model: Model,
  property: Extract<Property, { kind: "alwaysStep" }>,
): Model {
  const targetIds = targetedAlwaysStepTransitionIds(property);
  const targetIdSet = new Set(targetIds);
  const dependencyVars = new Set(property.reads ?? []);
  const neededTransitions = new Set<string>();

  for (const id of targetIds) {
    const transition = model.transitions.find(
      (candidate) => candidate.id === id,
    );
    if (!transition) continue;
    for (const read of transition.reads) dependencyVars.add(read);
  }

  let changed = true;
  while (changed) {
    changed = false;
    if (addRouteVarsForNeededRouteLocals(model, dependencyVars)) {
      changed = true;
    }
    for (const transition of model.transitions) {
      if (!transition.writes.some((write) => dependencyVars.has(write))) {
        continue;
      }
      if (!neededTransitions.has(transition.id)) {
        neededTransitions.add(transition.id);
        changed = true;
      }
      for (const id of transition.reads) {
        if (!dependencyVars.has(id)) {
          dependencyVars.add(id);
          changed = true;
        }
      }
    }
  }

  const executionVars = new Set(dependencyVars);
  for (const varId of stepFactVars(property.predicate)) {
    executionVars.add(varId);
  }
  for (const id of targetIds) {
    neededTransitions.add(id);
    const transition = model.transitions.find(
      (candidate) => candidate.id === id,
    );
    if (!transition) continue;
    for (const varId of [...transition.reads, ...transition.writes]) {
      executionVars.add(varId);
    }
  }
  for (const id of property.enabledTransitions ?? []) {
    if (!targetIdSet.has(id)) neededTransitions.add(id);
    const transition = model.transitions.find(
      (candidate) => candidate.id === id,
    );
    if (!transition) continue;
    for (const varId of [...transition.reads, ...transition.writes]) {
      executionVars.add(varId);
    }
  }

  for (const transition of model.transitions) {
    if (transition.cls !== "internal") continue;
    if (!transition.triggeredBy?.some((varId) => executionVars.has(varId))) {
      continue;
    }
    if (!transition.writes.some((write) => executionVars.has(write))) continue;
    neededTransitions.add(transition.id);
    for (const varId of [...transition.reads, ...transition.writes]) {
      executionVars.add(varId);
    }
  }

  const vars = model.vars.filter((decl) => executionVars.has(decl.id));
  const transitions = model.transitions.filter((transition) =>
    neededTransitions.has(transition.id),
  );
  return { ...model, vars, transitions };
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

function stepFactVars(predicate: StepPredicateIR): string[] {
  const flat = "step" in predicate ? predicate.step : predicate;
  const vars: string[] = [];
  if (
    flat.enqueued !== undefined ||
    flat.resolved !== undefined ||
    flat.opId !== undefined ||
    flat.continuation !== undefined
  ) {
    vars.push("sys:pending");
  }
  if (flat.navigated !== undefined || flat.navigatedTo !== undefined) {
    vars.push("sys:route");
  }
  return vars;
}

function addRouteVarsForNeededRouteLocals(
  model: Model,
  neededVars: Set<string>,
): boolean {
  let changed = false;
  for (const decl of model.vars) {
    if (!neededVars.has(decl.id)) continue;
    if (decl.scope.kind === "route-local") {
      if (!neededVars.has("sys:route")) {
        neededVars.add("sys:route");
        changed = true;
      }
    }
    if (decl.scope.kind === "mount-local") {
      for (const read of exprReads(decl.scope.when)) {
        if (!neededVars.has(read)) {
          neededVars.add(read);
          changed = true;
        }
      }
    }
  }
  return changed;
}

export function enabledTransitionVars(
  model: Model,
  transitionIds: Set<string>,
): string[] {
  const vars = new Set<string>();
  for (const id of transitionIds) {
    const transition = model.transitions.find(
      (candidate) => candidate.id === id,
    );
    if (!transition) continue;
    vars.add("sys:route");
    for (const read of transition.reads) vars.add(read);
    for (const write of transition.writes) vars.add(write);
  }
  return [...vars].sort();
}

export function canSliceProperty(property: Property): boolean {
  return propertySliceMode(property) !== "full";
}
