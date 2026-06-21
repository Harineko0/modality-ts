import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { dirname, extname, join, parse } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";
import type {
  ExtractionPhaseTiming,
  ExtractionReport,
  Model,
  OverlaySpec,
} from "modality-ts/core";
import type { Bounds } from "modality-ts/core";
import type {
  DomainRefinementProvider,
  NavigationAdapter,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";
import { reactRouterAdapter } from "modality-ts/extract/sources/router";
import {
  expandInventoryForI18n,
  nextConfigCandidates,
  nextConfigExtractionWarnings,
  parseNextConfig,
  synthesizeConfigRedirectTransitions,
  type NextParsedConfig,
} from "modality-ts/extract/sources/next";
import { buildVarAnchorsFromVars } from "../properties/var-anchors.js";
import { loadAndApplyOverlay, loadOverlaySpec } from "../overlay.js";
import { createBuiltinModalityRegistry } from "../registry/index.js";
import {
  applyInputClassToWideInputVars,
  attachNumericReductions,
} from "../../extract/engine/ts/numeric/abstraction.js";
import type { EnvironmentEventConfig } from "../../extract/engine/ts/environment-config.js";
import type { ExtractionWarning } from "../../extract/engine/ts/types.js";
import {
  attachRouteInventory,
  buildClientProjectSurface,
  discoverCacheStorageFragments,
  loadExtractionProject,
  normalizedSourcePaths,
  registryIncludesNextConfig,
  resolveExtractionRoute,
  runProjectExtractionPipeline,
  uniqueStrings,
} from "../features/extract/extraction-project.js";
import {
  applyMountScopesFromRouter,
  attachFieldPruning,
  refineAssignedLiteralDomains,
} from "../features/extract/model-postprocess.js";
import { buildLocationLowering } from "../features/extract/route-lowering.js";
import {
  buildEffectOperations,
  createExtractionCaveats,
  createExtractionReport,
  formatRouteCoverageLine,
  mergeExtractionCaveats,
  pluginConformanceWarnings,
  pluginProvenance,
  wideNumericReachabilityWarnings,
  wideProductDomainReachabilityWarnings,
} from "../features/extract/report.js";
import { synthesizeSystemVars } from "../features/extract/system-vars.js";
import { buildRouteExecutionTemplate } from "../../extract/sources/shared/route-execution.js";

export interface ModalityConfig {
  navigation?: {
    initialRoute?: string;
    routeBySource?: Record<string, string>;
  };
  effectApis?: readonly string[];
  environment?: EnvironmentEventConfig;
  bounds?: Partial<Bounds>;
  packageJsonPath?: string;
  disabledPlugins?: readonly string[];
  plugins?: readonly StateSourcePlugin[];
  domainRefinements?: readonly DomainRefinementProvider[];
  routerPlugin?: NavigationAdapter | false;
}

export interface BuildExtractionModelOptions {
  sourcePath?: string;
  sourcePaths?: readonly string[];
  modelPath: string;
  appModelPath?: string;
  route?: string;
  effectApis?: readonly string[];
  overlayPath?: string;
  packageJsonPath?: string;
  configPath?: string;
  disabledPlugins?: readonly string[];
  sourcePlugins?: readonly StateSourcePlugin[];
  domainRefinements?: readonly DomainRefinementProvider[];
  routerPlugin?: NavigationAdapter | false;
  bounds?: Partial<Bounds>;
  explainDrift?: boolean;
  now?: Date;
}

export interface ExtractionModelBuild {
  model: Model;
  report: ExtractionReport;
  appModelPath: string;
  route: string;
  varCount: number;
  transitionCount: number;
  pluginLabels: readonly string[];
  stateSpaceLine?: string;
  coarseDomainsLine?: string;
  routeCoverageLine?: string;
  driftLines: readonly string[];
  extractionDiagnosticsBase: {
    surface: NonNullable<ExtractionReport["diagnostics"]>["surface"];
    pipeline?: NonNullable<ExtractionReport["diagnostics"]>["pipeline"];
  };
  targetLabel: string;
}

export async function buildExtractionModel(
  options: BuildExtractionModelOptions,
  diagnosticsClock: ExtractDiagnosticsClock,
): Promise<ExtractionModelBuild> {
  const sourcePaths = normalizedSourcePaths(options);
  const projectBase = await diagnosticsClock.measureAsync(
    "load-project",
    "Load extraction project",
    () => loadExtractionProject(sourcePaths),
  );
  const { config, registry, routerAdapter, dependencies } =
    await diagnosticsClock.measureAsync(
      "load-config-and-registry",
      "Load config and plugin registry",
      async () => {
        const config = await loadModalityConfig(
          options.configPath ??
            (await findNearestConfig(projectBase.configStartDir)),
        );
        const packageJsonPath =
          options.packageJsonPath ??
          config.packageJsonPath ??
          (await findNearestPackageJson(projectBase.configStartDir));
        const dependencies = await readPackageDependencies(packageJsonPath);
        const registry = createBuiltinModalityRegistry({
          dependencies,
          disabledPlugins: [
            ...(config.disabledPlugins ?? []),
            ...(options.disabledPlugins ?? []),
          ],
          extraSourcePlugins: [
            ...(config.plugins ?? []),
            ...(options.sourcePlugins ?? []),
          ],
          extraDomainRefinementProviders: [
            ...(config.domainRefinements ?? []),
            ...(options.domainRefinements ?? []),
          ],
          routerPlugin: options.routerPlugin ?? config.routerPlugin,
        });
        return {
          config,
          registry,
          routerAdapter: registry.routerPlugin ?? reactRouterAdapter(),
          dependencies,
        };
      },
    );
  const appModelPath =
    options.appModelPath ?? `${dirname(options.modelPath)}/app.model.ts`;
  const projectWithInventory = await diagnosticsClock.measureAsync(
    "route-inventory",
    "Discover route inventory",
    () => attachRouteInventory(projectBase, routerAdapter),
  );
  const nextConfig = await diagnosticsClock.measureAsync(
    "next-config",
    "Load Next.js config",
    async () =>
      registryIncludesNextConfig(registry)
        ? loadNextParsedConfig(projectWithInventory.configStartDir)
        : undefined,
  );
  const inventory = nextConfig
    ? expandInventoryForI18n(projectWithInventory.inventory, nextConfig)
    : projectWithInventory.inventory;
  const projectWithNextConfig = {
    ...projectWithInventory,
    inventory,
  };
  const project = await diagnosticsClock.measureAsync(
    "project-surface",
    "Build client project surface",
    () =>
      buildClientProjectSurface(projectWithNextConfig, {
        navigation: routerAdapter,
        moduleRoleAdapters: registry.adapters.moduleRoles,
        effectApiProviders: registry.adapters.effectApis,
        routeExecutionProviders: registry.adapters.routeExecution,
        inventory: projectWithNextConfig.inventory,
      }),
  );
  const {
    route,
    routePatterns,
    effectOpAliases,
    effectApis,
    canonicalEffectApis,
    bounds,
  } = diagnosticsClock.measureSync(
    "route-and-bounds",
    "Resolve route and bounds",
    () => {
      const route = resolveExtractionRoute(
        project,
        config,
        options,
        sourcePaths,
      );
      const routePatterns = project.inventory.routes.map(
        (node) => node.pattern,
      );
      const effectOpAliases = project.effectOpAliases;
      const effectApis = uniqueStrings([
        ...(config.effectApis ?? []),
        ...(options.effectApis ?? []),
        ...project.effectApis,
      ]);
      const canonicalEffectApis = uniqueStrings([
        ...(config.effectApis ?? []),
        ...(options.effectApis ?? []),
        ...project.effectApis,
      ]);
      const bounds = {
        maxDepth: 12,
        maxPending: 3,
        maxInternalSteps: 16,
        ...(config.bounds ?? {}),
        ...(options.bounds ?? {}),
      };
      return {
        route,
        routePatterns,
        effectOpAliases,
        effectApis,
        canonicalEffectApis,
        bounds,
      };
    },
  );
  const { pipeline, pipelineDiagnostics } = diagnosticsClock.measureSync(
    "extraction-pipeline",
    "Run extraction pipeline",
    () =>
      runProjectExtractionPipeline(project, {
        route,
        routePatterns,
        effectApis,
        effectOpAliases,
        environment: config.environment,
        sourcePlugins: registry.sourcePlugins,
        routerPlugin: routerAdapter,
        domainRefinements: registry.domainRefinementProviders,
        inventory: project.inventory,
        bounds: { maxDepth: bounds.maxDepth },
      }),
  );
  const cacheStorageFragments = diagnosticsClock.measureSync(
    "cache-storage",
    "Discover cache and storage fragments",
    () =>
      discoverCacheStorageFragments(registry, project, route, {
        maxHistory: 4,
      }),
  );
  const extractedModel: Model = diagnosticsClock.measureSync(
    "model-assembly",
    "Assemble extracted model",
    () => {
      const configTransitions = nextConfig
        ? synthesizeConfigRedirectTransitions(nextConfig, project.inventory)
        : [];
      const routeExecutionFragment = buildRouteExecutionTemplate(
        project.routeExecution,
      );
      const transitions = [
        ...pipeline.transitions,
        ...routeExecutionFragment.transitions,
        ...cacheStorageFragments.transitions,
        ...configTransitions,
      ];
      const lowering = buildLocationLowering(
        transitions,
        routerAdapter,
        project.inventory,
      );
      const routeVars = [
        ...routerAdapter.locationVars(
          project.inventory,
          { route, bounds: { maxHistory: 4 } },
          lowering,
        ),
        ...(routerAdapter.routeTreeVars?.(project.inventory, {
          route,
          bounds: { maxHistory: 4 },
        }) ?? []),
      ];
      const templateVars = [
        ...pipeline.templateFragments.flatMap((fragment) => fragment.vars),
        ...routeExecutionFragment.vars,
        ...cacheStorageFragments.vars,
      ];
      const stateVars = refineAssignedLiteralDomains(
        [
          ...applyMountScopesFromRouter(
            pipeline.stateVars,
            routerAdapter,
            project.inventory,
          ),
          ...templateVars,
        ],
        transitions,
      );
      return {
        schemaVersion: 1 as const,
        id: "extracted-model",
        bounds,
        metadata: {
          sourceHashes: sourceHashes(project.sources),
          plugins: pluginProvenance(registry),
        },
        vars: [
          ...routeVars,
          ...synthesizeSystemVars(
            transitions,
            canonicalEffectApis,
            effectOpAliases,
            [...routeVars, ...stateVars],
            bounds.maxPending,
          ),
          ...stateVars,
        ],
        transitions,
      };
    },
  );
  const overlay = await diagnosticsClock.measureAsync(
    "overlay",
    "Load and apply overlay",
    async () => {
      const overlaySpec =
        options.explainDrift && options.overlayPath
          ? await readOverlaySpec(extractedModel, options.overlayPath)
          : undefined;
      const driftLines = overlaySpec
        ? explainOverlayDrift(extractedModel, overlaySpec)
        : [];
      const overlay = await loadAndApplyOverlay(
        extractedModel,
        options.overlayPath,
      );
      if (overlay.errors.length > 0) {
        throw new Error(
          [
            `Overlay merge failed: ${overlay.errors.join("; ")}`,
            ...driftLines,
          ].join("\n"),
        );
      }
      return { overlay, driftLines };
    },
  );
  const structuredWarnings: ExtractionWarning[] = [
    ...(nextConfig ? nextConfigExtractionWarnings(nextConfig) : []),
    ...project.surfaceWarnings.map((message) => ({ message })),
    ...cacheStorageFragments.warnings.map((message) => ({ message })),
    ...pipeline.warnings,
    ...wideNumericReachabilityWarnings(overlay.overlay.model),
    ...wideProductDomainReachabilityWarnings(overlay.overlay.model),
    ...overlay.overlay.warnings.map((message) => ({ message })),
    ...pluginConformanceWarnings(registry.sourcePlugins, dependencies).map(
      (message) => ({ message }),
    ),
  ];
  const warnings = structuredWarnings.map((warning) => warning.message);
  const extractionCaveats = createExtractionCaveats(structuredWarnings);
  const withInputClasses = applyInputClassToWideInputVars(
    overlay.overlay.model,
  );
  const model: Model = attachFieldPruning(
    attachNumericReductions(
      {
        ...withInputClasses.model,
        metadata: {
          ...withInputClasses.model.metadata,
          varAnchors: buildVarAnchorsFromVars(withInputClasses.model.vars),
          extractionCaveats: mergeExtractionCaveats(
            extractionCaveats,
            cacheStorageFragments.caveats,
          ),
        },
      },
      [...withInputClasses.reductions, ...cacheStorageFragments.reductions],
    ),
  );
  const extractionDiagnosticsBase = {
    surface: project.surfaceDiagnostics ?? {
      rawEntries: project.rawEntries.length,
      reachableSources: project.sources.length,
      includedSources: project.sources.length,
      interactionSources: project.interactionSources.length,
      reportedSources: project.sourceFiles.length,
    },
    ...(pipelineDiagnostics ? { pipeline: pipelineDiagnostics } : {}),
  };
  const report = diagnosticsClock.measureSync(
    "report",
    "Create extraction report",
    () =>
      createExtractionReport(
        project.sourceFiles,
        model,
        warnings,
        structuredWarnings,
        overlay.overlay.ignoredVars,
        options.now ?? new Date(),
        project.inventory,
        buildEffectOperations(
          project.effectApiProvenance,
          config.effectApis,
          options.effectApis,
        ),
      ),
  );
  const driftLines = overlay.driftLines;
  const stateSpaceLine = (() => {
    const contributors = report.stateContributors;
    if (!contributors) return undefined;
    const { totalBits, topVars } = contributors;
    const top = topVars
      .slice(0, 3)
      .map((v) => `${v.varId}(${v.bits.toFixed(1)})`)
      .join(",");
    return `state-space≈${totalBits.toFixed(1)}bits top:${top}`;
  })();
  const coarseDomainsLine = (() => {
    const entries = report.coarseDomains ?? [];
    if (entries.length === 0) return undefined;
    const count = entries.reduce((sum, entry) => sum + entry.paths.length, 0);
    const first = entries[0];
    if (!first) return undefined;
    const examplePath = first.paths[0];
    return `coarse-domains=${count} e.g. ${first.varId}[${examplePath ?? ""}]`;
  })();
  const routeCoverageLine = (() => {
    const coverage = report.routeCoverage;
    if (!coverage || coverage.configured === 0) return undefined;
    return formatRouteCoverageLine(coverage);
  })();
  const varCount =
    pipeline.stateVars.length +
    pipeline.templateFragments.flatMap((fragment) => fragment.vars).length +
    cacheStorageFragments.vars.length;
  const transitionCount = model.transitions.length;
  const pluginLabels = registry.plugins.map(
    (plugin) => `${plugin.kind}:${plugin.id}@${plugin.version}`,
  );
  const targetLabel = options.sourcePath ?? sourcePaths[0] ?? options.modelPath;
  return {
    model,
    report,
    appModelPath,
    route,
    varCount,
    transitionCount,
    pluginLabels,
    stateSpaceLine,
    coarseDomainsLine,
    routeCoverageLine,
    driftLines,
    extractionDiagnosticsBase,
    targetLabel,
  };
}

function sourceHashes(
  sources: readonly { path: string; text: string }[],
): Record<string, string> {
  return Object.fromEntries(
    sources.map((source) => [source.path, sha256(source.text)]),
  );
}

async function readOverlaySpec(
  model: Model,
  overlayPath: string,
): Promise<OverlaySpec> {
  return loadOverlaySpec(model, overlayPath);
}

async function loadModalityConfig(
  configPath: string | undefined,
): Promise<ModalityConfig> {
  if (!configPath) return {};
  const module = (await importConfigModule(configPath)) as {
    default?: ModalityConfig | (() => ModalityConfig | Promise<ModalityConfig>);
    config?: ModalityConfig | (() => ModalityConfig | Promise<ModalityConfig>);
  };
  const exported = module.default ?? module.config ?? {};
  return typeof exported === "function" ? await exported() : exported;
}

async function importConfigModule(configPath: string): Promise<unknown> {
  if (extname(configPath) === ".ts" || extname(configPath) === ".mts") {
    const source = await readFile(configPath, "utf8");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
    }).outputText;
    const encoded = Buffer.from(transpiled).toString("base64");
    const url = `data:text/javascript;base64,${encoded}`;
    return import(url);
  }
  return import(`${pathToFileURL(configPath).href}?t=${Date.now()}`);
}

async function loadNextParsedConfig(
  startDir: string,
): Promise<NextParsedConfig | undefined> {
  let dir = startDir;
  while (true) {
    for (const candidate of nextConfigCandidates(dir)) {
      try {
        const text = await readFile(candidate, "utf8");
        return parseNextConfig(text, candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const parent = dirname(dir);
    if (parent === dir || dir === parse(dir).root) return undefined;
    dir = parent;
  }
}

async function findNearestConfig(
  startDir: string,
): Promise<string | undefined> {
  const names = [
    "modality.config.ts",
    "modality.config.mts",
    "modality.config.js",
    "modality.config.mjs",
  ];
  let dir = startDir;
  while (true) {
    for (const name of names) {
      const candidate = join(dir, name);
      try {
        await readFile(candidate, "utf8");
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const parent = dirname(dir);
    if (parent === dir || dir === parse(dir).root) return undefined;
    dir = parent;
  }
}

async function findNearestPackageJson(
  startDir: string,
): Promise<string | undefined> {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, "package.json");
    try {
      await readFile(candidate, "utf8");
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(dir);
    if (parent === dir || dir === parse(dir).root) return undefined;
    dir = parent;
  }
}

async function readPackageDependencies(
  packageJsonPath: string | undefined,
): Promise<Record<string, string> | undefined> {
  if (!packageJsonPath) return undefined;
  const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  return {
    ...(manifest.peerDependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.dependencies ?? {}),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface ExtractDiagnosticsClock {
  measureSync<T>(id: string, label: string, fn: () => T): T;
  measureAsync<T>(id: string, label: string, fn: () => Promise<T>): Promise<T>;
  finish(): readonly ExtractionPhaseTiming[];
}

export function createExtractDiagnosticsClock(): ExtractDiagnosticsClock {
  const timings: ExtractionPhaseTiming[] = [];
  const record = (id: string, label: string, elapsedMs: number): void => {
    timings.push({ id, label, elapsedMs });
  };
  return {
    measureSync(id, label, fn) {
      const start = performance.now();
      try {
        return fn();
      } finally {
        record(id, label, performance.now() - start);
      }
    },
    async measureAsync(id, label, fn) {
      const start = performance.now();
      try {
        return await fn();
      } finally {
        record(id, label, performance.now() - start);
      }
    },
    finish() {
      return [...timings].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
    },
  };
}

function explainOverlayDrift(model: Model, overlay: OverlaySpec): string[] {
  const transitionIds = model.transitions
    .map((transition) => transition.id)
    .sort();
  const varIds = model.vars.map((decl) => decl.id).sort();
  const lines: string[] = [];
  for (const transition of overlay.transitions ?? []) {
    if (transitionIds.includes(transition.id)) continue;
    lines.push(formatDrift("transition", transition.id, transitionIds));
  }
  for (const refinement of overlay.domains ?? []) {
    if (varIds.includes(refinement.var)) continue;
    lines.push(formatDrift("domain", refinement.var, varIds));
  }
  for (const varId of overlay.ignoreVars ?? []) {
    if (varIds.includes(varId)) continue;
    lines.push(formatDrift("ignoreVar", varId, varIds));
  }
  return lines.sort();
}

function formatDrift(
  kind: string,
  id: string,
  candidates: readonly string[],
): string {
  const suggestions = nearestCandidates(id, candidates);
  return suggestions.length > 0
    ? `overlay-drift: ${kind} ${id} has no match; nearest=${suggestions.join(",")}`
    : `overlay-drift: ${kind} ${id} has no match; nearest=none`;
}

function nearestCandidates(
  id: string,
  candidates: readonly string[],
): string[] {
  return candidates
    .map((candidate) => ({
      candidate,
      distance: editDistance(normalizeId(id), normalizeId(candidate)),
    }))
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.candidate.localeCompare(right.candidate),
    )
    .slice(0, 3)
    .map(({ candidate, distance }) => `${candidate}(${distance})`);
}

function normalizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from(
    { length: right.length + 1 },
    (_, index) => index,
  );
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const startDiagonal = previous[0];
    if (startDiagonal === undefined) break;
    let diagonal = startDiagonal;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const upCell = previous[rightIndex];
      const leftCell = previous[rightIndex - 1];
      if (upCell === undefined || leftCell === undefined) break;
      const up = upCell + 1;
      const leftCost = leftCell + 1;
      const subst =
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      const corner = previous[rightIndex];
      if (corner === undefined) break;
      diagonal = corner;
      previous[rightIndex] = Math.min(up, leftCost, subst);
    }
  }
  const distance = previous[right.length];
  return distance ?? 0;
}
