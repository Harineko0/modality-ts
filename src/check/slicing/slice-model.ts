import type { Model, Property } from "modality-ts/core";

export function sliceModel(model: Model, propertyReads: readonly string[]): Model {
  return sliceModelForProperty(model, { reads: propertyReads });
}

export function sliceModelForProperty(model: Model, property: Pick<Property, "reads" | "enabledTransitions">): Model {
  const systemVars = new Set(model.vars.filter((decl) => decl.id.startsWith("sys:")).map((decl) => decl.id));
  const forcedTransitions = new Set(property.enabledTransitions ?? []);
  const needed = new Set([...systemVars, ...(property.reads ?? []), ...enabledTransitionVars(model, forcedTransitions)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const transition of model.transitions) {
      if (!transition.writes.some((write) => needed.has(write))) continue;
      for (const id of [...transition.reads, ...transition.writes]) {
        if (!needed.has(id)) {
          needed.add(id);
          changed = true;
        }
      }
    }
  }
  const vars = model.vars.filter((decl) => needed.has(decl.id));
  const transitions = model.transitions.filter(
    (transition) =>
      forcedTransitions.has(transition.id) ||
      transition.writes.some((write) => needed.has(write)) ||
      transition.reads.some((read) => needed.has(read))
  );
  return { ...model, vars, transitions };
}

export function enabledTransitionVars(model: Model, transitionIds: Set<string>): string[] {
  const vars = new Set<string>();
  for (const id of transitionIds) {
    const transition = model.transitions.find((candidate) => candidate.id === id);
    if (!transition) continue;
    vars.add("sys:route");
    for (const read of transition.reads) vars.add(read);
    for (const write of transition.writes) vars.add(write);
  }
  return [...vars].sort();
}
