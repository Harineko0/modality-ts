import type { Model, ModelState } from "modality-ts/core";

export function vacuityWarnings(
  model: Model,
  states: Map<string, ModelState>,
  enabledTransitionIds: Set<string>,
): string[] {
  const warnings: string[] = [];
  for (const transition of model.transitions) {
    if (
      transition.cls !== "internal" &&
      !enabledTransitionIds.has(transition.id)
    ) {
      warnings.push(`transition never enabled: ${transition.id}`);
    }
  }
  for (const decl of model.vars) {
    if (decl.domain.kind !== "enum") continue;
    const inhabited = new Set(
      [...states.values()]
        .map((state) => state[decl.id])
        .filter((value): value is string => typeof value === "string"),
    );
    for (const value of decl.domain.values) {
      if (!inhabited.has(value))
        warnings.push(`enum value never inhabited: ${decl.id}=${value}`);
    }
  }
  return warnings.sort();
}
