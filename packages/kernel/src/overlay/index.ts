import type { Model, Transition } from "../ir/types.js";

export interface OverlaySpec {
  transitions?: readonly Transition[];
  ignoreVars?: readonly string[];
}

export interface OverlayMergeResult {
  model: Model;
  warnings: string[];
  errors: string[];
}

export function applyOverlay(model: Model, overlay: OverlaySpec): OverlayMergeResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const transitionIds = new Set(model.transitions.map((transition) => transition.id));
  const varIds = new Set(model.vars.map((decl) => decl.id));
  const replacements = new Map<string, Transition>();

  for (const transition of overlay.transitions ?? []) {
    if (!transitionIds.has(transition.id)) {
      errors.push(`Overlay transition ${transition.id} does not match an extracted transition`);
      continue;
    }
    const existing = model.transitions.find((candidate) => candidate.id === transition.id);
    if (existing?.confidence === "exact") {
      warnings.push(`Overlay overrides exact transition ${transition.id}`);
    }
    replacements.set(transition.id, { ...transition, confidence: "manual" });
  }

  for (const varId of overlay.ignoreVars ?? []) {
    if (!varIds.has(varId)) errors.push(`Overlay ignoreVar ${varId} does not match a state variable`);
  }

  if (errors.length > 0) return { model, warnings, errors };

  const ignored = new Set(overlay.ignoreVars ?? []);
  return {
    model: {
      ...model,
      vars: model.vars.filter((decl) => !ignored.has(decl.id)),
      transitions: model.transitions
        .filter((transition) => !transition.reads.some((read) => ignored.has(read)) && !transition.writes.some((write) => ignored.has(write)))
        .map((transition) => replacements.get(transition.id) ?? transition)
    },
    warnings,
    errors
  };
}
