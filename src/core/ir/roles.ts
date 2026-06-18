import type { Model, StateVarDecl } from "./types.js";

export const DEFAULT_LOCATION_GROUP = "default";

export function effectiveRoleGroup(group: string | undefined): string {
  return group ?? DEFAULT_LOCATION_GROUP;
}

export function locationCurrentVars(model: Model): StateVarDecl[] {
  return model.vars.filter((decl) => decl.role?.kind === "location-current");
}

export function locationCurrentVar(model: Model): StateVarDecl | undefined {
  const currents = locationCurrentVars(model);
  if (currents.length === 0) return undefined;
  const preferred = currents.find(
    (decl) => effectiveRoleGroup(decl.role?.group) === DEFAULT_LOCATION_GROUP,
  );
  return preferred ?? currents[0];
}

export function locationHistoryVar(model: Model): StateVarDecl | undefined {
  const current = locationCurrentVar(model);
  const group = current
    ? effectiveRoleGroup(current.role?.group)
    : DEFAULT_LOCATION_GROUP;
  return model.vars.find(
    (decl) =>
      decl.role?.kind === "location-history" &&
      effectiveRoleGroup(decl.role.group) === group,
  );
}
