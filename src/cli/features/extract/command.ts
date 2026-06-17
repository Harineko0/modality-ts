import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  extname,
  join,
  parse,
  relative,
  resolve,
} from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";
import {
  runExtractionPipeline,
  type ExtractionPipelineResult,
} from "modality-ts/extract";
import {
  canonicalJson,
  collectTokenDomainPaths,
  domainCardinality,
  exceedsWideCardinalityThreshold,
  exceedsWideNumericThreshold,
  initialValues,
  parseModelArtifact,
  type EffectIR,
  type ExtractionCaveat,
  type ExtractionReport,
  type Model,
  type OverlaySpec,
  type RouteCoverage,
  type RouteCoverageClassification,
  type RouteCoverageEntry,
  type StateSpaceContributors,
  type StateVarDecl,
  type Transition,
} from "modality-ts/core";
import type { Bounds } from "modality-ts/core";
import type {
  RouterPlugin,
  StateSourcePlugin,
  RouteInventory,
  LocationLowering,
  NavigationAdapter,
  NavIntent,
  DomainRefinementProvider,
} from "modality-ts/extract/engine/spi";
import {
  parseReactRouterRoutes,
  routerSource,
} from "modality-ts/extract/sources/router";
import { discoverNextServerEffectApis } from "../../../extract/sources/next/server-effects.js";
import { discoverNextCacheFromSources } from "../../../extract/sources/next/cache.js";
import {
  configSecurityWarnings,
  expandInventoryForI18n,
  nextConfigCandidates,
  parseNextConfig,
  synthesizeConfigRedirectTransitions,
} from "../../../extract/sources/next/config.js";
import { emitAppModel } from "../../codegen/model.js";
import { loadAndApplyOverlay, loadOverlaySpec } from "../../overlay.js";
import { createBuiltinModalityRegistry } from "../../registry/index.js";
import {
  compareCaveats,
  modelSlackCaveat,
  partitionCaveats,
} from "../../../extract/engine/ts/caveats.js";
import { timerStateVarDecl } from "../../../extract/engine/ts/transition/timers.js";
import { environmentStateVarDecl } from "../../../extract/engine/ts/transition/environment-callbacks.js";
import { confirmStateVarDecl } from "../../../extract/engine/ts/transition/async.js";
import type { EffectOpAliases } from "../../../extract/engine/ts/effect-op-aliases.js";
import type { EnvironmentEventConfig } from "../../../extract/engine/ts/environment-config.js";
import { suspenseStateVarDecl } from "../../../extract/engine/ts/transition/suspense.js";
import type { ExtractionWarning } from "../../../extract/engine/ts/types.js";
import {
  applyInputClassToWideInputVars,
  attachNumericReductions,
} from "../../../extract/engine/ts/numeric/abstraction.js";
import type { ExtractArtifactEntry } from "./output.js";
import {
  type EffectApiProvenanceEntry,
  type TsConfigResolution,
  sourceWithReachableImports,
} from "./project.js";
import {
  createSemanticProject,
  loadSemanticProjectConfig,
  tsConfigResolutionFromSemanticConfig,
  type SemanticProject,
  type SemanticProjectConfig,
} from "../../../extract/engine/ts/semantic-project.js";

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
  routerPlugin?: RouterPlugin | false;
}

export interface ExtractCommandOptions {
  sourcePath?: string;
  sourcePaths?: readonly string[];
  modelPath: string;
  appModelPath?: string;
  reportPath?: string;
  route?: string;
  effectApis?: readonly string[];
  overlayPath?: string;
  expectModelPath?: string;
  packageJsonPath?: string;
  configPath?: string;
  disabledPlugins?: readonly string[];
  sourcePlugins?: readonly StateSourcePlugin[];
  domainRefinements?: readonly DomainRefinementProvider[];
  routerPlugin?: RouterPlugin | false;
  bounds?: Partial<Bounds>;
  explainDrift?: boolean;
  now?: Date;
}

export interface ExtractCommandResult {
  model: Model;
  report: ExtractionReport;
  lines: string[];
  targetLabel: string;
  appModelPath: string;
  varCount: number;
  transitionCount: number;
  pluginLabels: readonly string[];
  stateSpaceLine?: string;
  coarseDomainsLine?: string;
  artifacts: readonly ExtractArtifactEntry[];
}

export async function runExtractCommand(
  options: ExtractCommandOptions,
): Promise<ExtractCommandResult> {
  const sourcePaths = normalizedSourcePaths(options);
  const projectBase = await loadExtractionProject(sourcePaths);
  const config = await loadModalityConfig(
    options.configPath ?? (await findNearestConfig(projectBase.configStartDir)),
  );
  const appModelPath =
    options.appModelPath ?? `${dirname(options.modelPath)}/app.model.ts`;
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
  const routerAdapter = registry.routerPlugin ?? routerSource();
  const projectWithInventory = await attachRouteInventory(
    projectBase,
    routerAdapter,
  );
  const nextConfig =
    routerAdapter.id === "next"
      ? await loadNextParsedConfig(projectWithInventory.configStartDir)
      : undefined;
  const inventory = nextConfig
    ? expandInventoryForI18n(projectWithInventory.inventory, nextConfig)
    : projectWithInventory.inventory;
  const projectWithNextConfig = {
    ...projectWithInventory,
    inventory,
    ...(nextConfig
      ? {
          surfaceWarnings: [
            ...projectWithInventory.surfaceWarnings,
            ...configSecurityWarnings(nextConfig),
          ],
        }
      : {}),
  };
  const project = await buildClientProjectSurface(
    projectWithNextConfig,
    routerAdapter,
  );
  const route = resolveExtractionRoute(project, config, options, sourcePaths);
  const routePatterns = project.inventory.routes.map((node) => node.pattern);
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
  const pipeline = runProjectExtractionPipeline(project, {
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
  });
  const nextCacheFragments =
    routerAdapter.id === "next"
      ? discoverNextCacheFromSources(
          project.rawEntries.map((entry) => ({
            fileName: entry.path,
            sourceText: entry.text,
          })),
          project.inventory,
        )
      : { vars: [], transitions: [], warnings: [] };
  const configTransitions =
    nextConfig && routerAdapter.id === "next"
      ? synthesizeConfigRedirectTransitions(nextConfig, project.inventory)
      : [];
  const transitions = [
    ...pipeline.transitions,
    ...nextCacheFragments.transitions,
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
    ...nextCacheFragments.vars,
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
  const extractedModel: Model = {
    schemaVersion: 1,
    id: "extracted-model",
    bounds,
    metadata: {
      sourceHashes: sourceHashes(project.sources),
      plugins: pluginProvenance(pipeline.plugins),
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
  const structuredWarnings: ExtractionWarning[] = [
    ...project.surfaceWarnings.map((message) => ({ message })),
    ...nextCacheFragments.warnings.map((message) => ({ message })),
    ...pipeline.warnings,
    ...wideNumericReachabilityWarnings(overlay.model),
    ...wideProductDomainReachabilityWarnings(overlay.model),
    ...overlay.warnings.map((message) => ({ message })),
    ...pluginConformanceWarnings(registry.sourcePlugins, dependencies).map(
      (message) => ({ message }),
    ),
  ];
  const warnings = structuredWarnings.map((warning) => warning.message);
  const extractionCaveats = createExtractionCaveats(structuredWarnings);
  const withInputClasses = applyInputClassToWideInputVars(overlay.model);
  const model: Model = attachNumericReductions(
    {
      ...withInputClasses.model,
      metadata: {
        ...withInputClasses.model.metadata,
        extractionCaveats,
      },
    },
    withInputClasses.reductions,
  );
  const report = createExtractionReport(
    project.sourceFiles,
    model,
    warnings,
    structuredWarnings,
    overlay.ignoredVars,
    options.now ?? new Date(),
    project.inventory,
    buildEffectOperations(
      project.effectApiProvenance,
      config.effectApis,
      options.effectApis,
    ),
  );
  await mkdir(dirname(options.modelPath), { recursive: true });
  await writeFile(options.modelPath, `${canonicalJson(model)}\n`, "utf8");
  await mkdir(dirname(appModelPath), { recursive: true });
  await writeFile(appModelPath, emitAppModel(model), "utf8");
  if (options.reportPath) {
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, `${canonicalJson(report)}\n`, "utf8");
  }
  if (options.expectModelPath) {
    await assertMatchesExpectedModel(model, options.expectModelPath);
  }
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
    nextCacheFragments.vars.length;
  const pluginLabels = registry.plugins.map(
    (plugin) => `${plugin.kind}:${plugin.id}@${plugin.version}`,
  );
  const targetLabel = options.sourcePath ?? sourcePaths[0] ?? options.modelPath;
  const artifacts: ExtractArtifactEntry[] = [
    { kind: "model", path: options.modelPath },
    { kind: "appModel", path: appModelPath },
  ];
  if (options.reportPath) {
    artifacts.push({ kind: "report", path: options.reportPath });
  }
  return {
    model,
    report,
    targetLabel,
    appModelPath,
    varCount,
    transitionCount: transitions.length,
    pluginLabels,
    stateSpaceLine,
    coarseDomainsLine,
    artifacts,
    lines: [
      `extracted vars=${varCount} transitions=${transitions.length}`,
      `route=${route}`,
      ...(stateSpaceLine ? [stateSpaceLine] : []),
      ...(routeCoverageLine ? [routeCoverageLine] : []),
      ...(coarseDomainsLine ? [coarseDomainsLine] : []),
      `plugins=${registry.plugins.map((plugin) => `${plugin.kind}:${plugin.id}@${plugin.version}`).join(",") || "none"}`,
      `model=${options.modelPath}`,
      `appModel=${appModelPath}`,
      ...(options.overlayPath ? [`overlay=${options.overlayPath}`] : []),
      ...(options.explainDrift
        ? driftLines.length > 0
          ? driftLines
          : ["overlay-drift=none"]
        : []),
      ...(options.configPath ? [`config=${options.configPath}`] : []),
      ...(options.expectModelPath
        ? [`expectedModel=${options.expectModelPath}`]
        : []),
      ...(options.reportPath ? [`report=${options.reportPath}`] : []),
    ],
  };
}

interface ExtractionProject {
  entryFile: string;
  sourceText: string;
  interactionSources: Array<{ path: string; text: string }>;
  sourceFiles: string[];
  sources: Array<{ path: string; text: string }>;
  inventory: RouteInventory;
  effectApis: string[];
  effectOpAliases: EffectOpAliases;
  effectApiProvenance: EffectApiProvenanceEntry[];
  surfaceWarnings: string[];
  configStartDir: string;
  rawEntries: Array<{ path: string; text: string }>;
  semanticConfig: SemanticProjectConfig;
  /** Transitional reduced path shape for project-surface reachability. */
  tsconfig: TsConfigResolution;
  semanticProject?: SemanticProject;
}

function normalizedSourcePaths(options: ExtractCommandOptions): string[] {
  const sourcePaths = options.sourcePaths ?? [];
  const paths = [
    ...sourcePaths,
    ...(options.sourcePath ? [options.sourcePath] : []),
  ];
  if (paths.length === 0) throw new Error("Missing source.tsx path");
  return uniqueStrings(paths.map((path) => resolve(path)));
}

async function loadExtractionProject(
  sourcePaths: readonly string[],
): Promise<ExtractionProject> {
  if (sourcePaths.length > 1)
    return loadMultiFileExtractionProject(sourcePaths);
  const resolved = sourcePaths[0];
  if (!resolved) throw new Error("extract requires at least one source path");
  const info = await stat(resolved);
  const configStartDir = info.isDirectory() ? resolved : dirname(resolved);
  const semanticConfig = loadSemanticProjectConfig(configStartDir);
  const tsconfig = tsConfigResolutionFromSemanticConfig(semanticConfig);
  if (!info.isDirectory()) {
    const source = await readFile(resolved, "utf8");
    const rawEntries = [{ path: resolved, text: source }];
    return emptySurfaceProject({
      entryFile: resolved,
      rawEntries,
      semanticConfig,
      tsconfig,
      configStartDir: dirname(resolved),
    });
  }
  const routesPath = join(resolved, "app", "routes.ts");
  const routeEntries = parseReactRouterRoutes(
    await readFile(routesPath, "utf8"),
  );
  const rootPath = join(resolved, "app", "root.tsx");
  const roots = await existingFiles([rootPath]);
  const rawEntries = [
    { path: routesPath, text: await readFile(routesPath, "utf8") },
    ...(await Promise.all(
      roots.map(async (path) => ({ path, text: await readFile(path, "utf8") })),
    )),
    ...(await Promise.all(
      routeEntries.map(async (entry) => ({
        path: resolve(dirname(routesPath), entry.file),
        text: await readFile(resolve(dirname(routesPath), entry.file), "utf8"),
      })),
    )),
  ];
  return emptySurfaceProject({
    entryFile: routesPath,
    rawEntries,
    semanticConfig,
    tsconfig,
    configStartDir: resolved,
  });
}

function emptySurfaceProject(input: {
  entryFile: string;
  rawEntries: Array<{ path: string; text: string }>;
  semanticConfig: SemanticProjectConfig;
  tsconfig: TsConfigResolution;
  configStartDir: string;
}): ExtractionProject {
  return {
    entryFile: input.entryFile,
    sourceText: "",
    interactionSources: [],
    sourceFiles: [],
    sources: [],
    inventory: { routes: [] },
    effectApis: [],
    effectOpAliases: new Map(),
    effectApiProvenance: [],
    surfaceWarnings: [],
    configStartDir: input.configStartDir,
    rawEntries: input.rawEntries,
    semanticConfig: input.semanticConfig,
    tsconfig: input.tsconfig,
  };
}

function withServerEffectDiscovery(
  adapter: NavigationAdapter,
): NavigationAdapter {
  if (adapter.discoverEffectApis || adapter.id !== "next") return adapter;
  return { ...adapter, discoverEffectApis: discoverNextServerEffectApis };
}

async function buildClientProjectSurface(
  project: ExtractionProject,
  adapter: NavigationAdapter,
): Promise<ExtractionProject> {
  const resolvedAdapter = withServerEffectDiscovery(adapter);
  const reachable = await sourceWithReachableImports(
    project.rawEntries,
    project.tsconfig,
    resolvedAdapter,
    project.inventory,
  );
  const includedSources = reachable.sources.filter((entry) => entry.included);
  const interactionSources = includedSources
    .filter((entry) => entry.interactionText.trim().length > 0)
    .map((entry) => ({ path: entry.path, text: entry.interactionText }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const interactionSourcePaths = new Set(
    interactionSources.map((entry) => entry.path),
  );
  const reportSources = includedSources.filter(
    (entry) =>
      interactionSourcePaths.has(entry.path) ||
      entry.path.endsWith("routes.ts"),
  );
  const semanticProject = createSemanticProject(
    includedSources.map((entry) => ({ path: entry.path, text: entry.text })),
    project.semanticConfig,
  );
  return {
    ...project,
    semanticProject,
    sourceText: interactionSources.map((entry) => entry.text).join("\n"),
    interactionSources,
    sourceFiles: reportSources
      .map((entry) => entry.path)
      .sort((left, right) => left.localeCompare(right)),
    sources: reportSources.map((entry) => ({
      path: entry.path,
      text: entry.text,
    })),
    effectApis: reachable.effectApis,
    effectOpAliases: reachable.effectOpAliases,
    effectApiProvenance: reachable.effectApiProvenance,
    surfaceWarnings: reachable.warnings,
  };
}

function runProjectExtractionPipeline(
  project: ExtractionProject,
  options: {
    route: string;
    routePatterns: readonly string[];
    effectApis: readonly string[];
    effectOpAliases?: EffectOpAliases;
    environment?: EnvironmentEventConfig;
    sourcePlugins: readonly StateSourcePlugin[];
    routerPlugin?: RouterPlugin;
    domainRefinements?: readonly DomainRefinementProvider[];
    inventory: RouteInventory;
    bounds?: Pick<Bounds, "maxDepth">;
  },
): ExtractionPipelineResult {
  const fragments =
    project.interactionSources.length > 0
      ? project.interactionSources
      : project.sourceText.trim().length > 0
        ? [{ path: project.entryFile, text: project.sourceText }]
        : [];
  if (fragments.length === 0) {
    return runExtractionPipeline({
      sourceText: "",
      fileName: project.entryFile,
      semanticProject: project.semanticProject,
      ...options,
    });
  }
  const discoverFragments = fragments.map((entry) => ({
    sourceText: entry.text,
    fileName: entry.path,
  }));
  if (fragments.length === 1) {
    const fragment = fragments[0]!;
    return runExtractionPipeline({
      sourceText: fragment.text,
      fileName: fragment.path,
      discoverFragments,
      semanticProject: project.semanticProject,
      ...options,
    });
  }
  return mergeExtractionPipelineResults(
    fragments.map((fragment) =>
      runExtractionPipeline({
        sourceText: fragment.text,
        fileName: fragment.path,
        discoverFragments,
        semanticProject: project.semanticProject,
        ...options,
      }),
    ),
    runExtractionPipeline({
      sourceText: "",
      fileName: project.entryFile,
      semanticProject: project.semanticProject,
      ...options,
    }),
  );
}

function mergeExtractionPipelineResults(
  fragmentResults: readonly ExtractionPipelineResult[],
  inventoryResult: ExtractionPipelineResult,
): ExtractionPipelineResult {
  const transitionIds = new Set<string>();
  const transitions = [];
  for (const result of fragmentResults) {
    for (const transition of result.transitions) {
      if (transitionIds.has(transition.id)) continue;
      transitionIds.add(transition.id);
      transitions.push(transition);
    }
  }
  for (const transition of inventoryResult.transitions) {
    if (transitionIds.has(transition.id)) continue;
    transitionIds.add(transition.id);
    transitions.push(transition);
  }
  const varIds = new Set<string>();
  const stateVars = [];
  for (const result of fragmentResults) {
    for (const decl of result.stateVars) {
      if (varIds.has(decl.id)) continue;
      varIds.add(decl.id);
      stateVars.push(decl);
    }
  }
  const writeChannelIds = new Set<string>();
  const writeChannels = [];
  for (const result of fragmentResults) {
    for (const channel of result.writeChannels) {
      if (writeChannelIds.has(channel.id)) continue;
      writeChannelIds.add(channel.id);
      writeChannels.push(channel);
    }
  }
  const templateFragments = fragmentResults.flatMap(
    (result) => result.templateFragments,
  );
  const warnings: ExtractionWarning[] = fragmentResults.flatMap((result) => [
    ...result.warnings,
  ]);
  return {
    transitions,
    warnings,
    stateVars,
    templateFragments,
    routeVars: inventoryResult.routeVars,
    writeChannels,
    plugins: inventoryResult.plugins,
  };
}

async function loadMultiFileExtractionProject(
  sourcePaths: readonly string[],
): Promise<ExtractionProject> {
  const projects = await Promise.all(
    sourcePaths.map((sourcePath) => loadExtractionProject([sourcePath])),
  );
  const rawEntriesByPath = new Map<string, { path: string; text: string }>();
  for (const project of projects) {
    for (const entry of project.rawEntries) {
      rawEntriesByPath.set(resolve(entry.path), entry);
    }
  }
  return emptySurfaceProject({
    entryFile: projects.map((project) => project.entryFile).join(","),
    rawEntries: [...rawEntriesByPath.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    semanticConfig:
      projects[0]?.semanticConfig ??
      loadSemanticProjectConfig(
        commonAncestor(projects.map((project) => project.configStartDir)),
      ),
    tsconfig: projects[0]?.tsconfig ?? { paths: [] },
    configStartDir: commonAncestor(
      projects.map((project) => project.configStartDir),
    ),
  });
}

async function attachRouteInventory(
  project: ExtractionProject,
  adapter: NavigationAdapter,
): Promise<ExtractionProject> {
  const files = [...project.rawEntries];
  const manifestPath =
    files.find((file) => file.path.endsWith("routes.ts"))?.path ??
    (await findNearestRoutesManifest(project.configStartDir));
  if (
    manifestPath &&
    !files.some((file) => resolve(file.path) === resolve(manifestPath))
  ) {
    files.push({
      path: manifestPath,
      text: await readFile(manifestPath, "utf8"),
    });
  }
  const inventory = await adapter.discoverRoutes({
    rootDir: resolveRouterDiscoveryRoot(project) ?? project.configStartDir,
    files,
    readFile: (path) => readFile(path, "utf8"),
  });
  return { ...project, rawEntries: files, inventory };
}

function resolveRouterDiscoveryRoot(
  project: ExtractionProject,
): string | undefined {
  for (const entry of project.rawEntries) {
    const normalized = entry.path.replace(/\\/g, "/");
    const match =
      normalized.match(/^(.*)\/(?:src\/)?app(?:\/|$)/) ??
      normalized.match(/^(.*)\/(?:src\/)?pages(?:\/|$)/);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function findManifestPath(project: ExtractionProject): string | undefined {
  return project.rawEntries.find((file) => file.path.endsWith("routes.ts"))
    ?.path;
}

function resolveProjectRoot(
  manifestPath: string | undefined,
  fallback: string,
): string {
  if (!manifestPath) return fallback;
  const appDir = dirname(manifestPath);
  if (basename(appDir) === "app") return dirname(appDir);
  return fallback;
}

function projectRelativeSourcePath(
  sourcePath: string,
  project: ExtractionProject,
): string {
  const manifestPath = findManifestPath(project);
  const projectRoot = resolveProjectRoot(manifestPath, project.configStartDir);
  return relative(projectRoot, resolve(sourcePath)).split("\\").join("/");
}

function routesForSourceFile(
  sourcePath: string,
  project: ExtractionProject,
): string[] {
  const manifestPath = findManifestPath(project);
  if (!manifestPath) return [];
  const manifestDir = dirname(manifestPath);
  const resolvedSource = resolve(sourcePath);
  return project.inventory.routes
    .filter(
      (node) =>
        (node.kind === "page" || node.kind === "index") &&
        node.file !== undefined &&
        resolve(manifestDir, node.file) === resolvedSource,
    )
    .map((node) => node.pattern)
    .sort((left, right) => left.localeCompare(right));
}

function manifestRouteFiles(project: ExtractionProject): string[] {
  const manifestPath = findManifestPath(project);
  if (!manifestPath) return [];
  const manifest = project.rawEntries.find(
    (file) => resolve(file.path) === resolve(manifestPath),
  );
  if (!manifest) return [];
  const manifestDir = dirname(manifestPath);
  return parseReactRouterRoutes(manifest.text)
    .map((entry) => resolve(manifestDir, entry.file))
    .sort((left, right) => left.localeCompare(right));
}

function isManifestRouteSource(
  sourcePath: string,
  project: ExtractionProject,
): boolean {
  const resolvedSource = resolve(sourcePath);
  return manifestRouteFiles(project).some(
    (filePath) => resolve(filePath) === resolvedSource,
  );
}

function resolveExtractionRoute(
  project: ExtractionProject,
  config: ModalityConfig,
  options: ExtractCommandOptions,
  sourcePaths: readonly string[],
): string {
  if (options.route) return options.route;

  const manifestPath = findManifestPath(project);
  const hasRouteInventory = project.inventory.routes.length > 0;

  if (sourcePaths.length === 1) {
    const sourcePath = resolve(sourcePaths[0] ?? "");
    const relativeSource = projectRelativeSourcePath(sourcePath, project);
    const configuredRoute = config.navigation?.routeBySource?.[relativeSource];
    if (configuredRoute) return configuredRoute;

    const matchedRoutes = routesForSourceFile(sourcePath, project);
    if (matchedRoutes.length === 1) return matchedRoutes[0] ?? "/";
    if (matchedRoutes.length > 1) {
      throw new Error(
        `Source ${relativeSource} maps to multiple routes (${matchedRoutes.join(", ")}). Configure navigation.routeBySource to disambiguate.`,
      );
    }

    if (isManifestRouteSource(sourcePath, project)) {
      if (!manifestPath || !hasRouteInventory) {
        throw new Error(
          `Cannot resolve route for ${relativeSource}: route inventory is unavailable.`,
        );
      }
      throw new Error(
        `Cannot resolve route for ${relativeSource}: source is not mapped in the route inventory.`,
      );
    }

    return config.navigation?.initialRoute ?? "/";
  }

  const matchedRoutes = new Set<string>();
  for (const sourcePath of sourcePaths) {
    for (const pattern of routesForSourceFile(resolve(sourcePath), project)) {
      matchedRoutes.add(pattern);
    }
  }
  if (matchedRoutes.size > 1 && !config.navigation?.initialRoute) {
    throw new Error(
      `Multi-source extraction spans routes ${[...matchedRoutes].sort().join(", ")}. Configure navigation.initialRoute.`,
    );
  }
  return config.navigation?.initialRoute ?? "/";
}

async function findNearestRoutesManifest(
  startDir: string,
): Promise<string | undefined> {
  let current = resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = join(current, "app", "routes.ts");
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // keep walking upward
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

async function readTsConfigResolution(
  startDir: string,
): Promise<TsConfigResolution> {
  return tsConfigResolutionFromSemanticConfig(
    loadSemanticProjectConfig(startDir),
  );
}

async function existingFiles(paths: readonly string[]): Promise<string[]> {
  const found: string[] = [];
  for (const path of paths) {
    try {
      const info = await stat(path);
      if (info.isFile()) found.push(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return found;
}

function sourceHashes(
  sources: readonly { path: string; text: string }[],
): Record<string, string> {
  return Object.fromEntries(
    sources.map((source) => [source.path, sha256(source.text)]),
  );
}

function literalString(
  expression: import("typescript").Expression,
): string | undefined {
  return ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text
    : undefined;
}

function propertyName(
  name: import("typescript").PropertyName,
): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  )
    return name.text;
  return undefined;
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
): Promise<
  import("../../../extract/sources/next/config.js").NextParsedConfig | undefined
> {
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

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function commonAncestor(paths: readonly string[]): string {
  if (paths.length === 0) return process.cwd();
  const [first, ...rest] = paths.map((path) => resolve(path).split(/[\\/]+/));
  if (!first) return process.cwd();
  let length = first.length;
  for (const parts of rest) {
    length = Math.min(length, parts.length);
    for (let index = 0; index < length; index += 1) {
      if (first[index] !== parts[index]) {
        length = index;
        break;
      }
    }
  }
  const prefix = first.slice(0, length).join("/");
  if (prefix === "") {
    const firstPath = paths[0];
    return firstPath ? parse(firstPath).root : process.cwd();
  }
  return prefix;
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

async function assertMatchesExpectedModel(
  model: Model,
  expectedModelPath: string,
): Promise<void> {
  const expected = parseModelArtifact(
    await readFile(expectedModelPath, "utf8"),
  );
  const actualText = canonicalJson(model);
  const expectedText = canonicalJson(expected);
  if (actualText !== expectedText) {
    throw new Error(
      `Extracted model differs from expected snapshot ${expectedModelPath}`,
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildStateContributors(
  model: Model,
  limit = 20,
): StateSpaceContributors {
  const contributors = model.vars.map((decl) => {
    const cardinality = domainCardinality(decl.domain);
    const bits = cardinality < 1 ? 0 : round2(Math.log2(cardinality));
    const scope =
      decl.scope.kind === "global"
        ? "global"
        : decl.scope.kind === "route-local"
          ? decl.scope.route
          : `mount:${decl.scope.id}`;
    const origin =
      typeof decl.origin === "string" ? decl.origin : decl.origin.file;
    return {
      varId: decl.id,
      domainKind: decl.domain.kind,
      bits,
      scope,
      origin,
    };
  });
  const totalBits = round2(contributors.reduce((sum, c) => sum + c.bits, 0));
  const topVars = [...contributors]
    .sort((a, b) => b.bits - a.bits || a.varId.localeCompare(b.varId))
    .slice(0, limit);
  const bySourceMap = new Map<string, number>();
  for (const c of contributors) {
    bySourceMap.set(
      c.origin,
      round2((bySourceMap.get(c.origin) ?? 0) + c.bits),
    );
  }
  const bySource = [...bySourceMap.entries()]
    .map(([source, bits]) => ({ source, bits }))
    .sort((a, b) => b.bits - a.bits || a.source.localeCompare(b.source));
  return { totalBits, topVars, bySource };
}

function createExtractionReport(
  sourceFiles: readonly string[],
  model: Model,
  warnings: readonly string[],
  structuredWarnings: readonly ExtractionWarning[],
  ignoredVars: readonly string[],
  now: Date,
  inventory?: RouteInventory,
  effectOperations?: ExtractionReport["effectOperations"],
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
    ...(model.metadata?.numericReductions?.entries
      ? { numericReductions: model.metadata.numericReductions.entries }
      : {}),
    ...(effectOperations && effectOperations.length > 0
      ? { effectOperations }
      : {}),
  };
}

function buildEffectOperations(
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
  const routeVar = model.vars.find((decl) => decl.id === "sys:route");
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

function formatRouteCoverageLine(coverage: RouteCoverage): string {
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

function buildLocationLowering(
  transitions: readonly Transition[],
  adapter: NavigationAdapter,
  inventory: RouteInventory,
): LocationLowering {
  const pushTargets = new Set<string>();
  const pushOrigins = new Set<string>();
  let hasUnboundPush = false;
  const routePatterns = inventory.routes.map((node) => node.pattern);

  for (const transition of transitions) {
    if (transition.id.startsWith("route:")) continue;
    const navigations = collectPushReplaceNavigations(transition.effect);
    if (navigations.length === 0) continue;

    const component = transition.id.split(".")[0] ?? "";
    const origin = adapter.routeForComponent?.(component, inventory);

    for (const navigation of navigations) {
      if (navigation.to) pushTargets.add(navigation.to);
      if (!origin) hasUnboundPush = true;
      else pushOrigins.add(origin);

      if (adapter.lowerNavigation) {
        const intent: NavIntent = {
          mode: navigation.mode,
          ...(navigation.to !== undefined ? { to: navigation.to } : {}),
        };
        for (const loweredNavigation of collectPushReplaceNavigations(
          adapter.lowerNavigation(intent, { inventory, routePatterns }).effect,
        )) {
          if (loweredNavigation.to) pushTargets.add(loweredNavigation.to);
        }
      }
    }
  }

  return {
    pushTargets: [...pushTargets].sort(),
    pushOrigins: [...pushOrigins].sort(),
    hasUnboundPush,
  };
}

function collectPushReplaceNavigations(
  effect: EffectIR,
): Array<{ mode: "push" | "replace"; to?: string }> {
  const navigations: Array<{ mode: "push" | "replace"; to?: string }> = [];
  const visit = (current: EffectIR): void => {
    if (
      current.kind === "navigate" &&
      (current.mode === "push" || current.mode === "replace")
    ) {
      const to =
        current.to?.kind === "lit" && typeof current.to.value === "string"
          ? current.to.value
          : undefined;
      navigations.push({
        mode: current.mode,
        ...(to !== undefined ? { to } : {}),
      });
    }
    if (current.kind === "seq") {
      for (const child of current.effects) visit(child);
    }
    if (current.kind === "if") {
      visit(current.then);
      visit(current.else);
    }
  };
  visit(effect);
  return navigations;
}

function emptyExtractionCaveats(): NonNullable<
  NonNullable<Model["metadata"]>["extractionCaveats"]
> {
  return { entries: [] };
}

function createExtractionCaveats(
  warnings: readonly ExtractionWarning[],
): NonNullable<NonNullable<Model["metadata"]>["extractionCaveats"]> {
  return {
    entries: warnings
      .map((warning) => warning.caveat)
      .filter((caveat): caveat is ExtractionCaveat => Boolean(caveat))
      .sort(compareCaveats),
  };
}

function synthesizeSystemVars(
  transitions: readonly Model["transitions"][number][],
  effectApis: readonly string[],
  effectOpAliases: EffectOpAliases,
  vars: readonly StateVarDecl[],
  maxPending: number,
): StateVarDecl[] {
  const timerIds = collectSystemVarIds(transitions, "sys:timer:");
  const suspenseIds = collectSystemVarIds(transitions, "sys:suspense:");
  const webSocketIds = collectSystemVarIds(transitions, "sys:websocket:");
  const confirmIds = collectSystemVarIds(transitions, "sys:confirm:");
  return [
    ...pendingVars(effectApis, transitions, vars, maxPending, effectOpAliases),
    ...timerIds.sort().map((id) => timerStateVarDecl(id)),
    ...suspenseIds
      .sort()
      .map((id) => suspenseStateVarDecl(id.replace(/^sys:suspense:/, ""))),
    ...webSocketIds.sort().map((id) => environmentStateVarDecl(id)),
    ...confirmIds.sort().map((id) => confirmStateVarDecl(id)),
  ];
}

function collectSystemVarIds(
  transitions: readonly Model["transitions"][number][],
  prefix: string,
): string[] {
  const ids = new Set<string>();
  const visit = (effect: EffectIR): void => {
    if (effect.kind === "assign" && effect.var.startsWith(prefix))
      ids.add(effect.var);
    if (effect.kind === "havoc" && effect.var.startsWith(prefix))
      ids.add(effect.var);
    if (effect.kind === "seq") effect.effects.forEach(visit);
    if (effect.kind === "if") {
      visit(effect.then);
      visit(effect.else);
    }
  };
  for (const transition of transitions) {
    visit(transition.effect);
    for (const varId of [...transition.reads, ...transition.writes]) {
      if (varId.startsWith(prefix)) ids.add(varId);
    }
  }
  return [...ids];
}

function pluginConformanceWarnings(
  sourcePlugins: readonly StateSourcePlugin[],
  dependencies: Record<string, string> | undefined,
): string[] {
  if (!dependencies) return [];
  const warnings: string[] = [];
  for (const plugin of sourcePlugins) {
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

function pluginProvenance(
  plugins: ReturnType<typeof runExtractionPipeline>["plugins"],
): NonNullable<Model["metadata"]>["plugins"] {
  return [
    ...plugins.sources,
    ...(plugins.router ? [plugins.router] : []),
    ...(plugins.domainRefinements ?? []),
  ].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
  );
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

function havocWrites(effect: EffectIR): string[] {
  if (effect.kind === "havoc") return [effect.var];
  if (effect.kind === "seq") return effect.effects.flatMap(havocWrites);
  if (effect.kind === "if")
    return [...havocWrites(effect.then), ...havocWrites(effect.else)];
  return [];
}

function wideProductDomainReachabilityWarnings(
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

function wideNumericReachabilityWarnings(model: Model): ExtractionWarning[] {
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

function unextractableHandlerFromWarning(
  warning: string,
):
  | { id: string; reason: string; source?: string; category: string }
  | undefined {
  const rich = /^Unextractable handler (\S+) \[([^\]]+)\] \((.+)\)$/.exec(
    warning,
  );
  if (rich) {
    const id = rich[1];
    const category = rich[2];
    const source = rich[3];
    if (!id || !category || !source) return undefined;
    return {
      id,
      category,
      reason: `${category} at ${source}`,
      source,
    };
  }
  const bare = /^Unextractable handler (\S+)$/.exec(warning);
  return bare?.[1]
    ? { id: bare[1], category: "unextractable", reason: bare[0] }
    : undefined;
}

function pendingVars(
  effectApis: readonly string[],
  transitions: readonly Model["transitions"][number][] = [],
  vars: readonly StateVarDecl[] = [],
  maxPending = 3,
  effectOpAliases: EffectOpAliases = new Map(),
): StateVarDecl[] {
  const canonicalOp = (op: string): string => {
    for (const perFile of effectOpAliases.values()) {
      const canonical = perFile.get(op);
      if (canonical) return canonical;
    }
    return op;
  };
  const enqueues = transitions.flatMap((transition) =>
    enqueueOps(transition.effect),
  );
  const opValues = new Set(effectApis.map(canonicalOp));
  const continuationValues = new Set<string>();
  const argFields: Record<string, StateVarDecl["domain"]> = {};
  const varsById = new Map(vars.map((decl) => [decl.id, decl]));
  for (const op of effectApis) {
    const canonical = canonicalOp(op);
    continuationValues.add(`App.onClick.${canonical}.cont`);
    continuationValues.add(`App.onSubmit.${canonical}.cont`);
    continuationValues.add(`App.onChange.${canonical}.cont`);
  }
  for (const enqueue of enqueues) {
    const op = canonicalOp(enqueue.op);
    opValues.add(op);
    continuationValues.add(enqueue.continuation);
    for (const [name, expr] of Object.entries(enqueue.args)) {
      const domain = pendingArgDomain(expr, varsById);
      if (domain) argFields[name] = mergeArgDomains(argFields[name], domain);
    }
  }
  if (opValues.size === 0) opValues.add("noop");
  if (continuationValues.size === 0) continuationValues.add("noop");
  const ops = [...opValues].sort();
  const continuations = [...continuationValues].sort();
  return [
    {
      id: "sys:pending",
      domain: {
        kind: "boundedList",
        inner: {
          kind: "record",
          fields: {
            opId: { kind: "enum", values: ops },
            continuation: { kind: "enum", values: continuations },
            args: { kind: "record", fields: argFields },
          },
        },
        maxLen: maxPending,
      },
      origin: "system",
      scope: { kind: "global" },
      initial: [],
    },
  ];
}

function enqueueOps(effect: EffectIR): {
  op: string;
  continuation: string;
  args: Extract<EffectIR, { kind: "enqueue" }>["args"];
}[] {
  if (effect.kind === "enqueue")
    return [
      { op: effect.op, continuation: effect.continuation, args: effect.args },
    ];
  if (effect.kind === "seq") return effect.effects.flatMap(enqueueOps);
  if (effect.kind === "if")
    return [...enqueueOps(effect.then), ...enqueueOps(effect.else)];
  return [];
}

function pendingArgDomain(
  expr: Extract<EffectIR, { kind: "enqueue" }>["args"][string],
  varsById: ReadonlyMap<string, StateVarDecl>,
): StateVarDecl["domain"] | undefined {
  if (expr.kind === "lit") return domainForLiteral(expr.value);
  if (expr.kind !== "read" && expr.kind !== "readPre")
    return { kind: "tokens", count: 1 };
  const domain = varsById.get(expr.var)?.domain;
  if (!domain) return { kind: "tokens", count: 1 };
  return expr.path?.length ? { kind: "tokens", count: 1 } : domain;
}

function applyMountScopesFromRouter(
  vars: readonly StateVarDecl[],
  adapter: NavigationAdapter,
  inventory: RouteInventory,
): StateVarDecl[] {
  if (!adapter.mountScopeForComponent) return [...vars];
  return vars.map((decl) => {
    if (!decl.id.startsWith("local:")) return decl;
    const component = decl.id.slice("local:".length).split(".")[0];
    if (!component) return decl;
    const scope = adapter.mountScopeForComponent?.(component, inventory);
    return scope ? { ...decl, scope } : decl;
  });
}

function refineAssignedLiteralDomains(
  vars: readonly StateVarDecl[],
  transitions: readonly Model["transitions"][number][],
): StateVarDecl[] {
  const refinements = new Map<string, StateVarDecl["domain"]>();
  for (const transition of transitions) {
    for (const [varId, domain] of assignedLiteralDomains(transition.effect)) {
      refinements.set(varId, mergeArgDomains(refinements.get(varId), domain));
    }
  }
  return vars.map((decl) => {
    if (decl.origin === "library-template") return decl;
    const refinement = refinements.get(decl.id);
    return refinement
      ? { ...decl, domain: mergeAssignedDomain(decl.domain, refinement) }
      : decl;
  });
}

function mergeAssignedDomain(
  left: StateVarDecl["domain"],
  right: StateVarDecl["domain"],
): StateVarDecl["domain"] {
  if (left.kind === "enum" && right.kind === "enum")
    return mergeArgDomains(left, right);
  if (left.kind === "boundedInt" && right.kind === "boundedInt")
    return mergeArgDomains(left, right);
  if (left.kind === "tokens") return right;
  return left;
}

function assignedLiteralDomains(
  effect: EffectIR,
): Array<[string, StateVarDecl["domain"]]> {
  if (effect.kind === "assign" && effect.expr.kind === "lit")
    return [[effect.var, domainForLiteral(effect.expr.value)]];
  if (effect.kind === "choose") {
    return effect.among
      .filter(
        (expr): expr is Extract<typeof expr, { kind: "lit" }> =>
          expr.kind === "lit",
      )
      .map((expr) => [effect.var, domainForLiteral(expr.value)]);
  }
  if (effect.kind === "seq")
    return effect.effects.flatMap(assignedLiteralDomains);
  if (effect.kind === "if")
    return [
      ...assignedLiteralDomains(effect.then),
      ...assignedLiteralDomains(effect.else),
    ];
  return [];
}

function domainForLiteral(value: unknown): StateVarDecl["domain"] {
  if (typeof value === "boolean") return { kind: "bool" };
  if (typeof value === "number")
    return { kind: "boundedInt", min: value, max: value };
  if (typeof value === "string") return { kind: "enum", values: [value] };
  if (value === null)
    return { kind: "option", inner: { kind: "tokens", count: 1 } };
  return { kind: "tokens", count: 1 };
}

function mergeArgDomains(
  left: StateVarDecl["domain"] | undefined,
  right: StateVarDecl["domain"],
): StateVarDecl["domain"] {
  if (!left) return right;
  if (left.kind === "enum" && right.kind === "enum")
    return {
      kind: "enum",
      values: [...new Set([...left.values, ...right.values])].sort(),
    };
  if (left.kind === "boundedInt" && right.kind === "boundedInt")
    return {
      kind: "boundedInt",
      min: Math.min(left.min, right.min),
      max: Math.max(left.max, right.max),
    };
  if (left.kind === right.kind) return left;
  return { kind: "tokens", count: 1 };
}
