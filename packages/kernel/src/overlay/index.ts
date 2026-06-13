import type { AbstractDomain, Model, Transition, Value } from "../ir/types.js";

export interface OverlaySpec {
  transitions?: readonly Transition[];
  domains?: readonly {
    var: string;
    domain: AbstractDomain;
    initial?: Value | readonly Value[];
  }[];
  ignoreVars?: readonly string[];
}

export interface OverlayMergeResult {
  model: Model;
  warnings: string[];
  errors: string[];
  ignoredVars: readonly string[];
}

export function applyOverlay(model: Model, overlay: OverlaySpec): OverlayMergeResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const transitionIds = new Set(model.transitions.map((transition) => transition.id));
  const varIds = new Set(model.vars.map((decl) => decl.id));
  const replacements = new Map<string, Transition>();
  const domainReplacements = new Map<string, { domain: AbstractDomain; initial?: Value | readonly Value[] }>();

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

  for (const refinement of overlay.domains ?? []) {
    if (!varIds.has(refinement.var)) {
      errors.push(`Overlay domain ${refinement.var} does not match a state variable`);
      continue;
    }
    domainReplacements.set(refinement.var, { domain: refinement.domain, initial: refinement.initial });
  }

  for (const varId of overlay.ignoreVars ?? []) {
    if (!varIds.has(varId)) errors.push(`Overlay ignoreVar ${varId} does not match a state variable`);
  }

  if (errors.length > 0) return { model, warnings, errors, ignoredVars: [] };

  const ignored = new Set(overlay.ignoreVars ?? []);
  const refinedProvenance = Object.fromEntries([...domainReplacements.keys()].map((id) => [id, "overlay-refined" as const]));
  return {
    model: {
      ...model,
      vars: model.vars
        .filter((decl) => !ignored.has(decl.id))
        .map((decl) => {
          const replacement = domainReplacements.get(decl.id);
          return replacement ? { ...decl, domain: replacement.domain, initial: replacement.initial ?? decl.initial } : decl;
        }),
      transitions: model.transitions
        .filter((transition) => !transition.reads.some((read) => ignored.has(read)) && !transition.writes.some((write) => ignored.has(write)))
        .map((transition) => replacements.get(transition.id) ?? transition),
      metadata: {
        ...model.metadata,
        domainProvenance: {
          ...model.metadata?.domainProvenance,
          ...refinedProvenance
        }
      }
    },
    warnings,
    errors,
    ignoredVars: [...ignored].sort()
  };
}
