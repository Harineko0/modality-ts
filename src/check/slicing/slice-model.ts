import { exprReads } from "modality-ts/core";
import type { Model, Property } from "modality-ts/core";

export function sliceModel(
  model: Model,
  propertyReads: readonly string[],
): Model {
  return sliceModelForProperty(model, { reads: propertyReads });
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

export function canSliceProperty(property: Pick<Property, "kind">): boolean {
  return property.kind !== "alwaysStep" && property.kind !== "leadsToWithin";
}
