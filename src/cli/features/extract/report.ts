import {
  collectTokenDomainPaths,
  domainCardinality,
  type EffectIR,
  type ExtractionCaveat,
  type ExtractionDiagnostics,
  type ExtractionReport,
  exceedsWideCardinalityThreshold,
  exceedsWideNumericThreshold,
  initialValues,
  locationCurrentVar,
  type Model,
  type RouteCoverage,
  type RouteCoverageClassification,
  type RouteCoverageEntry,
  type StateVarDecl,
} from "modality-ts/core";
import type {
  RouteInventory,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";
import { buildStateContributors } from "../../../check/slicing/contributors.js";
import {
  compareCaveats,
  modelSlackCaveat,
  partitionCaveats,
} from "../../../extract/engine/ts/caveats.js";
import type { ExtractionWarning } from "../../../extract/engine/ts/types.js";
import type { RegistrySummary } from "../../registry/index.js";
import type { EffectApiProvenanceEntry } from "./project.js";

export function createExtractionReport(
  sourceFiles: readonly string[],
  model: Model,
  warnings: readonly string[],
  structuredWarnings: readonly ExtractionWarning[],
  ignoredVars: readonly string[],
  now: Date,
  inventory?: RouteInventory,
  effectOperations?: ExtractionReport["effectOperations"],
  diagnostics?: ExtractionDiagnostics,
): ExtractionReport {
  const caveats = model.metadata?.extractionCaveats ?? emptyExtractionCaveats();
  const partitioned = partitionCaveats(caveats.entries);
  const varDomains = new Map(
    model.vars.map((decl) => [decl.id, decl.domain] as const),
  );
  const transitionHandlers = model.transitions.map((transition) => ({
    id: transition.id,
    classification:
      transition.confidence === "manual"
        ? ("overlay" as const)
        : transition.confidence,
    reasons:
      transition.confidence === "over-approx"
        ? overApproxReasons(transition, varDomains)
        : ([] as string[]),
  }));
  const transitionIds = new Set(
    transitionHandlers.map((handler) => handler.id),
  );
  const unextractableHandlers = dedupeUnextractableHandlers(structuredWarnings)
    .filter((handler) => !transitionIds.has(handler.id))
    .map((handler) => ({
      id: handler.id,
      classification: "unextractable" as const,
      reasons: [handler.reason],
    }));
  const handlers = [...transitionHandlers, ...unextractableHandlers];
  const exactOrOverlay = handlers.filter(
    (handler) =>
      handler.classification === "exact" ||
      handler.classification === "overlay",
  ).length;
  const unextractable = handlers.filter(
    (handler) => handler.classification === "unextractable",
  ).length;
  const coarseDomains = model.vars
    .map((decl) => ({
      varId: decl.id,
      paths: collectTokenDomainPaths(decl.domain),
    }))
    .filter((entry) => entry.paths.length > 0)
    .sort((a, b) => a.varId.localeCompare(b.varId));
  const routeCoverage = buildRouteCoverage(inventory, model);
  return {
    schemaVersion: 1,
    kind: "extraction-report",
    generatedAt: now.toISOString(),
    sourceFiles,
    plugins: model.metadata?.plugins ?? [],
    handlers,
    globalTaints: partitioned.globalTaints,
    staleReads: partitioned.staleReads,
    unhandledRejections: partitioned.unhandledRejections,
    modelSlack: partitioned.modelSlack,
    domains: model.vars.map((decl) => ({
      varId: decl.id,
      domainKind: decl.domain.kind,
      provenance:
        model.metadata?.domainProvenance?.[decl.id] ??
        (decl.origin === "system"
          ? "system"
          : decl.origin === "library-template"
            ? "template"
            : decl.domain.kind === "tokens"
              ? "default-token"
              : "type-derived"),
    })),
    ...(coarseDomains.length > 0 ? { coarseDomains } : {}),
    ...(model.metadata?.fieldPruning?.entries.length
      ? { fieldPruning: model.metadata.fieldPruning }
      : {}),
    stateContributors: buildStateContributors(model),
    ...(routeCoverage ? { routeCoverage } : {}),
    coverage: {
      handlersTotal: handlers.length,
      exactOrOverlay,
      unextractable,
      ignoredVars: ignoredVars.length,
      percentExactOrOverlay:
        handlers.length === 0 ? 1 : exactOrOverlay / handlers.length,
    },
    warnings,
    assumptions: [`bound:maxPending=${model.bounds.maxPending}`],
    ...(model.metadata?.numericReductions?.entries
      ? { numericReductions: model.metadata.numericReductions.entries }
      : {}),
    ...(effectOperations && effectOperations.length > 0
      ? { effectOperations }
      : {}),
    ...(diagnostics ? { diagnostics } : {}),
  };
}

export function buildEffectOperations(
  provenance: readonly EffectApiProvenanceEntry[],
  configApis: readonly string[] | undefined,
  optionApis: readonly string[] | undefined,
): ExtractionReport["effectOperations"] {
  const entries: NonNullable<ExtractionReport["effectOperations"]>[number][] =
    provenance.map((entry) => ({
      opId: entry.opId,
      source: entry.source.file,
      line: entry.source.line,
      column: entry.source.column,
      origin: "source" as const,
    }));
  for (const opId of configApis ?? []) {
    entries.push({ opId, origin: "config" });
  }
  for (const opId of optionApis ?? []) {
    entries.push({ opId, origin: "option" });
  }
  return entries.sort(
    (left, right) =>
      left.opId.localeCompare(right.opId) ||
      (left.origin ?? "").localeCompare(right.origin ?? "") ||
      (left.source ?? "").localeCompare(right.source ?? ""),
  );
}

function buildRouteCoverage(
  inventory: RouteInventory | undefined,
  model: Model,
): RouteCoverage | undefined {
  if (!inventory || inventory.routes.length === 0) return undefined;
  const routeVar = locationCurrentVar(model);
  const modeledValues = new Set(
    routeVar?.domain.kind === "enum" ? routeVar.domain.values : [],
  );
  const routes: RouteCoverageEntry[] = inventory.routes
    .map((node) => {
      const modeled = modeledValues.has(node.pattern);
      if (modeled) return { pattern: node.pattern, modeled: true };
      let classification: RouteCoverageClassification;
      let reason: string;
      if (node.kind === "resource") {
        classification = "api";
        reason = "API/resource route excluded from client state";
      } else if (node.redirectTo) {
        classification = "redirect-only";
        reason = "Redirect-only route excluded from client state";
      } else if (node.pattern.includes("*")) {
        classification = "unsupported";
        reason = "Splat/wildcard route pattern not modeled";
      } else {
        classification = "no-client-state";
        reason = "No client-side state modeled for this route";
      }
      return { pattern: node.pattern, modeled: false, classification, reason };
    })
    .sort((left, right) => left.pattern.localeCompare(right.pattern));
  const modeled = routes.filter((entry) => entry.modeled).length;
  return { configured: inventory.routes.length, modeled, routes };
}

export function formatRouteCoverageLine(coverage: RouteCoverage): string {
  const omitted = coverage.configured - coverage.modeled;
  const counts = new Map<RouteCoverageClassification, number>();
  for (const entry of coverage.routes) {
    if (entry.modeled || !entry.classification) continue;
    counts.set(
      entry.classification,
      (counts.get(entry.classification) ?? 0) + 1,
    );
  }
  const parts = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([classification, count]) => `${classification}=${count}`);
  const suffix = parts.length > 0 ? ` [${parts.join(",")}]` : "";
  return `routes configured=${coverage.configured} modeled=${coverage.modeled} omitted=${omitted}${suffix}`;
}

export function emptyExtractionCaveats(): NonNullable<
  NonNullable<Model["metadata"]>["extractionCaveats"]
> {
  return { entries: [] };
}

export function createExtractionCaveats(
  warnings: readonly ExtractionWarning[],
): NonNullable<NonNullable<Model["metadata"]>["extractionCaveats"]> {
  return {
    entries: warnings
      .map((warning) => warning.caveat)
      .filter((caveat): caveat is ExtractionCaveat => Boolean(caveat))
      .sort(compareCaveats),
  };
}

export function mergeExtractionCaveats(
  base: NonNullable<NonNullable<Model["metadata"]>["extractionCaveats"]>,
  extra: readonly ExtractionCaveat[],
): NonNullable<NonNullable<Model["metadata"]>["extractionCaveats"]> {
  if (extra.length === 0) return base;
  return {
    entries: [...base.entries, ...extra].sort(compareCaveats),
  };
}

export function pluginProvenance(
  registry: RegistrySummary,
): NonNullable<Model["metadata"]>["plugins"] {
  return registry.plugins;
}

function overApproxReasons(
  transition: Model["transitions"][number],
  varDomains: ReadonlyMap<string, StateVarDecl["domain"]> = new Map(),
): string[] {
  const reasons = new Set<string>();
  if (transition.id.endsWith(".escaped"))
    reasons.add("setter escaped to unanalyzed call");
  for (const variable of havocWrites(transition.effect)) {
    const domain = varDomains.get(variable);
    const prefix =
      domain?.kind === "bool" ? "safe local toggle" : "domain-wide havoc";
    reasons.add(`${prefix}: havoc write to ${variable}`);
  }
  if (reasons.size === 0) reasons.add("transition confidence is over-approx");
  return [...reasons].sort();
}

function havocWrites(effect: EffectIR): string[] {
  if (effect.kind === "havoc") return [effect.var];
  if (effect.kind === "seq") return effect.effects.flatMap(havocWrites);
  if (effect.kind === "if")
    return [...havocWrites(effect.then), ...havocWrites(effect.else)];
  return [];
}

export function wideProductDomainReachabilityWarnings(
  model: Model,
): ExtractionWarning[] {
  const warnings: ExtractionWarning[] = [];
  for (const decl of model.vars) {
    if (!isProductDomain(decl.domain)) continue;
    if (!exceedsWideCardinalityThreshold(decl.domain)) continue;
    const caveat = modelSlackCaveat(
      decl.id,
      `Wide product domain (${domainCardinality(decl.domain)} values) may enlarge search`,
    );
    warnings.push({ message: caveat.reason, caveat });
  }
  return warnings;
}

function isProductDomain(domain: StateVarDecl["domain"]): boolean {
  return (
    domain.kind === "record" ||
    domain.kind === "tagged" ||
    domain.kind === "option"
  );
}

export function wideNumericReachabilityWarnings(
  model: Model,
): ExtractionWarning[] {
  const warnings: ExtractionWarning[] = [];
  const varsById = new Map(model.vars.map((decl) => [decl.id, decl]));
  for (const decl of model.vars) {
    if (!exceedsWideNumericThreshold(decl.domain)) continue;
    const initials = initialValues(decl.domain, decl.initial);
    if (initials.length <= 1) continue;
    const caveat = modelSlackCaveat(
      decl.id,
      `Wide numeric domain (${domainCardinality(decl.domain)} values) with multiple initials`,
    );
    warnings.push({ message: caveat.reason, caveat });
  }
  for (const transition of model.transitions) {
    for (const varId of havocWrites(transition.effect)) {
      const decl = varsById.get(varId);
      if (!decl || !exceedsWideNumericThreshold(decl.domain)) continue;
      const caveat = modelSlackCaveat(
        varId,
        `Wide numeric domain (${domainCardinality(decl.domain)} values) reachable via havoc in ${transition.id}`,
      );
      warnings.push({ message: caveat.reason, caveat });
    }
  }
  return warnings;
}

const GENERIC_UNEXTRACTABLE_CATEGORIES = new Set([
  "no-extractable-effect",
  "unextractable",
]);

function dedupeUnextractableHandlers(
  warnings: readonly ExtractionWarning[],
): ExtractionCaveat[] {
  const parsed = warnings
    .filter((warning) => warning.caveat?.kind === "unextractable")
    .map((warning) => warning.caveat as ExtractionCaveat);
  const byId = new Map<string, ExtractionCaveat>();
  for (const handler of parsed) {
    const existing = byId.get(handler.id);
    if (!existing) {
      byId.set(handler.id, handler);
      continue;
    }
    const existingIsGeneric = GENERIC_UNEXTRACTABLE_CATEGORIES.has(
      existing.reason,
    );
    const incomingIsGeneric = GENERIC_UNEXTRACTABLE_CATEGORIES.has(
      handler.reason,
    );
    if (existingIsGeneric && !incomingIsGeneric) byId.set(handler.id, handler);
  }
  return [...byId.values()].sort(compareCaveats);
}

export function pluginConformanceWarnings(
  statePlugins: readonly StateSourcePlugin[],
  dependencies: Record<string, string> | undefined,
): string[] {
  if (!dependencies) return [];
  const warnings: string[] = [];
  for (const plugin of statePlugins) {
    const testedVersions = plugin.conformance?.testedVersions;
    if (!testedVersions) continue;
    const requirement = parseTestedVersionRange(testedVersions);
    if (!requirement) {
      warnings.push(
        `Plugin ${plugin.id} has unsupported testedVersions range ${testedVersions}`,
      );
      continue;
    }
    const packageName =
      plugin.packageNames.find(
        (candidate) => candidate === requirement.packageName,
      ) ?? plugin.packageNames[0];
    const actual = packageName ? dependencies[packageName] : undefined;
    if (!packageName || actual === undefined) {
      warnings.push(
        `Plugin ${plugin.id} tested against ${testedVersions}, but no matching app dependency was found`,
      );
      continue;
    }
    const actualMajor = firstSemverMajor(actual);
    if (actualMajor === undefined) {
      warnings.push(
        `Plugin ${plugin.id} tested against ${testedVersions}, but app dependency ${packageName}@${actual} could not be parsed`,
      );
      continue;
    }
    if (actualMajor < requirement.minimumMajor) {
      warnings.push(
        `Plugin ${plugin.id} tested against ${testedVersions}, but app uses ${packageName}@${actual}`,
      );
    }
  }
  return warnings.sort();
}

function parseTestedVersionRange(
  range: string,
): { packageName: string; minimumMajor: number } | undefined {
  const match = /^([a-zA-Z0-9@/_-]+)>=([0-9]+)/.exec(range.trim());
  if (!match?.[1] || !match[2]) return undefined;
  return { packageName: match[1], minimumMajor: Number(match[2]) };
}

function firstSemverMajor(range: string): number | undefined {
  const match = /[0-9]+/.exec(range);
  return match ? Number(match[0]) : undefined;
}
