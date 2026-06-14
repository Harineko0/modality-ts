import type {
  AbstractDomain,
  Locator,
  Model,
  Transition,
  Value,
} from "../ir/types.js";

export interface OverlaySpec {
  transitions?: readonly Transition[];
  domains?: readonly {
    var: string;
    domain: AbstractDomain;
    initial?: Value | readonly Value[];
  }[];
  locators?: readonly {
    transition: string;
    locator: Locator;
  }[];
  ignoreVars?: readonly string[];
}

export interface OverlayMergeResult {
  model: Model;
  warnings: string[];
  errors: string[];
  ignoredVars: readonly string[];
}

export function applyOverlay(
  model: Model,
  overlay: OverlaySpec,
): OverlayMergeResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const transitionIds = new Set(
    model.transitions.map((transition) => transition.id),
  );
  const varIds = new Set(model.vars.map((decl) => decl.id));
  const replacements = new Map<string, Transition>();
  const domainReplacements = new Map<
    string,
    { domain: AbstractDomain; initial?: Value | readonly Value[] }
  >();
  const locatorReplacements = new Map<string, Locator>();

  for (const transition of overlay.transitions ?? []) {
    if (!transitionIds.has(transition.id)) {
      errors.push(
        `Overlay transition ${transition.id} does not match an extracted transition`,
      );
      continue;
    }
    const existing = model.transitions.find(
      (candidate) => candidate.id === transition.id,
    );
    if (existing?.confidence === "exact") {
      warnings.push(`Overlay overrides exact transition ${transition.id}`);
    }
    replacements.set(transition.id, { ...transition, confidence: "manual" });
  }

  for (const refinement of overlay.domains ?? []) {
    if (!varIds.has(refinement.var)) {
      errors.push(
        `Overlay domain ${refinement.var} does not match a state variable`,
      );
      continue;
    }
    domainReplacements.set(refinement.var, {
      domain: refinement.domain,
      initial: refinement.initial,
    });
  }

  for (const entry of overlay.locators ?? []) {
    if (!transitionIds.has(entry.transition)) {
      errors.push(
        `Overlay locator ${entry.transition} does not match an extracted transition`,
      );
      continue;
    }
    locatorReplacements.set(entry.transition, entry.locator);
  }

  for (const varId of overlay.ignoreVars ?? []) {
    if (!varIds.has(varId))
      errors.push(`Overlay ignoreVar ${varId} does not match a state variable`);
  }

  if (errors.length > 0) return { model, warnings, errors, ignoredVars: [] };

  const ignored = new Set(overlay.ignoreVars ?? []);
  const refinedProvenance = Object.fromEntries(
    [...domainReplacements.keys()].map((id) => [
      id,
      "overlay-refined" as const,
    ]),
  );
  return {
    model: {
      ...model,
      vars: model.vars
        .filter((decl) => !ignored.has(decl.id))
        .map((decl) => {
          const replacement = domainReplacements.get(decl.id);
          return replacement
            ? {
                ...decl,
                domain: replacement.domain,
                initial: replacement.initial ?? decl.initial,
              }
            : decl;
        }),
      transitions: model.transitions
        .filter(
          (transition) =>
            !transition.reads.some((read) => ignored.has(read)) &&
            !transition.writes.some((write) => ignored.has(write)),
        )
        .map((transition) =>
          withOverlayLocator(
            replacements.get(transition.id) ?? transition,
            locatorReplacements.get(transition.id),
          ),
        ),
      metadata: {
        ...model.metadata,
        domainProvenance: {
          ...model.metadata?.domainProvenance,
          ...refinedProvenance,
        },
      },
    },
    warnings,
    errors,
    ignoredVars: [...ignored].sort(),
  };
}

function withOverlayLocator(
  transition: Transition,
  locator: Locator | undefined,
): Transition {
  if (!locator) return transition;
  const label = transition.label;
  if (
    label.kind !== "click" &&
    label.kind !== "submit" &&
    label.kind !== "input"
  )
    return transition;
  return { ...transition, label: { ...label, locator } };
}

export interface OverlayBuilder {
  transition(
    id: string,
    transition: Omit<Transition, "id"> | Transition,
  ): OverlayBuilder;
  refineDomain(
    varId: string,
    domain: AbstractDomain,
    options?: { initial?: Value | readonly Value[] },
  ): OverlayBuilder;
  locator(transitionId: string, locator: Locator): OverlayBuilder;
  ignoreVar(varId: string): OverlayBuilder;
  toJSON(): OverlaySpec;
}

export function overlay(_model?: Model): OverlayBuilder {
  const spec: {
    transitions: Transition[];
    domains: {
      var: string;
      domain: AbstractDomain;
      initial?: Value | readonly Value[];
    }[];
    locators: { transition: string; locator: Locator }[];
    ignoreVars: string[];
  } = { transitions: [], domains: [], locators: [], ignoreVars: [] };
  const builder: OverlayBuilder = {
    transition(id, transition) {
      spec.transitions.push({ ...transition, id } as Transition);
      return builder;
    },
    refineDomain(varId, domain, options = {}) {
      spec.domains.push({
        var: varId,
        domain,
        ...(options.initial !== undefined ? { initial: options.initial } : {}),
      });
      return builder;
    },
    locator(transitionId, locator) {
      spec.locators.push({ transition: transitionId, locator });
      return builder;
    },
    ignoreVar(varId) {
      spec.ignoreVars.push(varId);
      return builder;
    },
    toJSON() {
      return defineOverlay({
        ...(spec.transitions.length > 0
          ? { transitions: spec.transitions }
          : {}),
        ...(spec.domains.length > 0 ? { domains: spec.domains } : {}),
        ...(spec.locators.length > 0 ? { locators: spec.locators } : {}),
        ...(spec.ignoreVars.length > 0 ? { ignoreVars: spec.ignoreVars } : {}),
      });
    },
  };
  return builder;
}

export function defineOverlay(
  specOrBuilder: OverlaySpec | OverlayBuilder,
): OverlaySpec {
  const spec =
    "toJSON" in specOrBuilder ? specOrBuilder.toJSON() : specOrBuilder;
  return {
    ...(spec.transitions ? { transitions: spec.transitions } : {}),
    ...(spec.domains ? { domains: spec.domains } : {}),
    ...(spec.locators ? { locators: spec.locators } : {}),
    ...(spec.ignoreVars ? { ignoreVars: spec.ignoreVars } : {}),
  };
}
