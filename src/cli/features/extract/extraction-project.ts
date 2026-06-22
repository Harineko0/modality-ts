import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join, parse, relative, resolve } from "node:path";
import type {
  Bounds,
  ExtractionCaveat,
  ExtractionPipelineDiagnostics,
  ExtractionSurfaceDiagnostics,
  NumericReduction,
  StateVarDecl,
  Transition,
} from "modality-ts/core";
import {
  discoveryRelatedFragments,
  type ExtractionPipelineResult,
  runExtractionPipeline,
  runPluginDiscoveryPhase,
  semanticTypeContextForFile,
} from "modality-ts/extract";
import type {
  CacheStorageFragment,
  DomainRefinementProvider,
  EffectApiProvider,
  FrameworkPlugin,
  HandlerWrapperProvider,
  ModuleRoleAdapter,
  NavigationAdapter,
  RouteExecutionDescriptor,
  RouteExecutionProvider,
  RouteInventory,
  RouteNode,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";
import { parseReactRouterRoutes } from "modality-ts/extract/sources/router";
import type { EffectOpAliases } from "../../../extract/engine/ts/effect-op-aliases.js";
import type { EnvironmentEventConfig } from "../../../extract/engine/ts/environment-config.js";
import { buildReactExtractionProjectSummary } from "../../../extract/engine/ts/react-extraction-project-summary.js";
import {
  createSemanticProject,
  loadSemanticProjectConfig,
  type SemanticProject,
  type SemanticProjectConfig,
  tsConfigResolutionFromSemanticConfig,
} from "../../../extract/engine/ts/semantic-project.js";
import {
  bindEngineFrameworkFromPlugin,
  withEngineFramework,
} from "../../../extract/engine/ts/ast.js";
import { resolveFrameworkPlugin } from "modality-ts/extract/engine/spi";
import type { ExtractionWarning } from "../../../extract/engine/ts/types.js";
import type { RegistrySummary } from "../../registry/index.js";
import type { ExtractCommandOptions, ModalityConfig } from "./command.js";
import {
  type EffectApiProvenanceEntry,
  sourceWithReachableImports,
  type TsConfigResolution,
} from "./project.js";

export interface ExtractionProject {
  entryFile: string;
  sourceText: string;
  interactionSources: Array<{ path: string; text: string }>;
  sourceFiles: string[];
  sources: Array<{ path: string; text: string }>;
  inventory: RouteInventory;
  effectApis: string[];
  effectOpAliases: EffectOpAliases;
  effectApiProvenance: EffectApiProvenanceEntry[];
  routeExecution?: RouteExecutionDescriptor;
  surfaceWarnings: string[];
  configStartDir: string;
  rawEntries: Array<{ path: string; text: string }>;
  semanticConfig: SemanticProjectConfig;
  /** Transitional reduced path shape for project-surface reachability. */
  tsconfig: TsConfigResolution;
  semanticProject?: SemanticProject;
  surfaceDiagnostics?: ExtractionSurfaceDiagnostics;
}

export interface ProjectExtractionPipelineOutput {
  pipeline: ExtractionPipelineResult;
  pipelineDiagnostics?: ExtractionPipelineDiagnostics;
}

export function normalizedSourcePaths(
  options: ExtractCommandOptions,
): string[] {
  const sourcePaths = options.sourcePaths ?? [];
  const paths = [
    ...sourcePaths,
    ...(options.sourcePath ? [options.sourcePath] : []),
  ];
  if (paths.length === 0) throw new Error("Missing source.tsx path");
  return uniqueStrings(paths.map((path) => resolve(path)));
}

export async function loadExtractionProject(
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
    routeExecution: undefined,
    surfaceWarnings: [],
    configStartDir: input.configStartDir,
    rawEntries: input.rawEntries,
    semanticConfig: input.semanticConfig,
    tsconfig: input.tsconfig,
  };
}

export async function buildClientProjectSurface(
  project: ExtractionProject,
  options: {
    navigation: NavigationAdapter;
    moduleRoleAdapters: readonly ModuleRoleAdapter[];
    effectApiProviders: readonly EffectApiProvider[];
    routeExecutionProviders?: readonly RouteExecutionProvider[];
    inventory: RouteInventory;
  },
): Promise<ExtractionProject> {
  const moduleResolver = createSemanticProject(
    project.rawEntries,
    project.semanticConfig,
  );
  const reachable = await sourceWithReachableImports(
    project.rawEntries,
    moduleResolver,
    {
      navigation: options.navigation,
      moduleRoleAdapters: options.moduleRoleAdapters,
      effectApiProviders: options.effectApiProviders,
      inventory: options.inventory,
    },
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
  const expandedSourceFiles =
    includedSources.length > project.rawEntries.length
      ? includedSources
          .map((entry) => entry.path)
          .sort((left, right) => left.localeCompare(right))
      : undefined;
  const surfaceDiagnostics: ExtractionSurfaceDiagnostics = {
    rawEntries: project.rawEntries.length,
    reachableSources: reachable.sources.length,
    includedSources: includedSources.length,
    interactionSources: interactionSources.length,
    reportedSources: reportSources.length,
    ...(expandedSourceFiles ? { expandedSourceFiles } : {}),
  };
  const semanticProject = createSemanticProject(
    includedSources.map((entry) => ({ path: entry.path, text: entry.text })),
    project.semanticConfig,
    moduleResolver.program,
  );
  const routeExecution = describeRouteExecution(
    options.routeExecutionProviders ?? [],
    options.inventory,
    reachable.effectApiProvenance,
    reachable.sources,
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
    routeExecution,
    surfaceWarnings: reachable.warnings,
    surfaceDiagnostics,
  };
}

function describeRouteExecution(
  providers: readonly RouteExecutionProvider[],
  inventory: RouteInventory,
  effectApiProvenance: readonly EffectApiProvenanceEntry[],
  files: readonly { path: string; text: string }[],
): RouteExecutionDescriptor | undefined {
  if (providers.length === 0) return undefined;
  const filesWithRoutes = files.map((file) => ({
    ...file,
    route: routeForSourceFile(file.path, inventory),
  }));
  const descriptors = providers.map((provider) =>
    provider.describeRouteExecution({
      inventory,
      effectApis: effectApiProvenance.map((entry) => ({
        opId: entry.opId,
        source: entry.source,
      })),
      files: filesWithRoutes,
    }),
  );
  return mergeRouteExecutionDescriptors(descriptors);
}

function routeForSourceFile(
  path: string,
  inventory: RouteInventory,
): RouteNode | undefined {
  const normalized = path.split("\\").join("/");
  const resolved = resolve(path).split("\\").join("/");
  return inventory.routes.find((route) => {
    if (!route.file) return false;
    const routeFile = route.file.split("\\").join("/");
    const resolvedRouteFile = resolve(route.file).split("\\").join("/");
    return (
      resolvedRouteFile === resolved ||
      routeFile === normalized ||
      normalized.endsWith(`/${routeFile}`)
    );
  });
}

function mergeRouteExecutionDescriptors(
  descriptors: readonly RouteExecutionDescriptor[],
): RouteExecutionDescriptor {
  return {
    resources: uniqueById(
      descriptors.flatMap((descriptor) => descriptor.resources),
    ),
    loaders: uniqueById(
      descriptors.flatMap((descriptor) => descriptor.loaders),
    ),
    actions: uniqueById(
      descriptors.flatMap((descriptor) => descriptor.actions),
    ),
  };
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of items) byId.set(item.id, item);
  return [...byId.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
}

export function runProjectExtractionPipeline(
  project: ExtractionProject,
  options: {
    route: string;
    routePatterns: readonly string[];
    effectApis: readonly string[];
    effectOpAliases?: EffectOpAliases;
    environment?: EnvironmentEventConfig;
    sourcePlugins: readonly StateSourcePlugin[];
    handlerWrapperProviders?: readonly HandlerWrapperProvider[];
    routerPlugin?: NavigationAdapter;
    framework?: FrameworkPlugin;
    domainRefinements?: readonly DomainRefinementProvider[];
    inventory: RouteInventory;
    bounds?: Pick<Bounds, "maxDepth">;
  },
): ProjectExtractionPipelineOutput {
  const fragments =
    project.interactionSources.length > 0
      ? project.interactionSources
      : project.sourceText.trim().length > 0
        ? [{ path: project.entryFile, text: project.sourceText }]
        : [];
  if (fragments.length === 0) {
    return {
      pipeline: runExtractionPipeline({
        sourceText: "",
        fileName: project.entryFile,
        semanticProject: project.semanticProject,
        ...options,
      }),
    };
  }
  const discoverFragments = fragments.map((entry) => ({
    sourceText: entry.text,
    fileName: entry.path,
  }));
  const pipelineOptions = {
    sourceText: "",
    fileName: project.entryFile,
    discoverFragments,
    semanticProject: project.semanticProject,
    ...options,
  };
  const relatedFragments = discoveryRelatedFragments(
    pipelineOptions,
    discoverFragments,
  );
  const fragmentTypes = semanticTypeContextForFile(
    project.semanticProject,
    discoverFragments[0]!.fileName,
  );
  const engineFramework = bindEngineFrameworkFromPlugin(
    resolveFrameworkPlugin(options.framework),
    {
      ...(fragmentTypes ? { types: fragmentTypes } : {}),
      fileName: discoverFragments[0]!.fileName,
    },
  );
  const projectSummary = withEngineFramework(engineFramework, () =>
    buildReactExtractionProjectSummary({
      discoverFragments,
      relatedFragments,
      ...(fragmentTypes ? { types: fragmentTypes } : {}),
      route: options.route,
      sourcePlugins: options.sourcePlugins,
    }),
  );
  const sharedDiscovery = runPluginDiscoveryPhase(pipelineOptions);
  const pipelineDiagnostics: ExtractionPipelineDiagnostics = {
    discoveryFragments: discoverFragments.length,
    relatedFragments: relatedFragments.length,
    semanticProjectSourceFiles: project.semanticProject?.sourceFiles.size ?? 0,
  };
  if (fragments.length === 1) {
    const fragment = fragments[0]!;
    return {
      pipeline: runExtractionPipeline({
        sourceText: fragment.text,
        fileName: fragment.path,
        discoverFragments,
        semanticProject: project.semanticProject,
        sharedDiscovery,
        projectSummary,
        ...options,
      }),
      pipelineDiagnostics,
    };
  }
  return {
    pipeline: mergeExtractionPipelineResults(
      fragments.map((fragment) =>
        runExtractionPipeline({
          sourceText: fragment.text,
          fileName: fragment.path,
          discoverFragments,
          semanticProject: project.semanticProject,
          sharedDiscovery,
          projectSummary,
          ...options,
        }),
      ),
      runExtractionPipeline({
        sourceText: "",
        fileName: project.entryFile,
        semanticProject: project.semanticProject,
        sharedDiscovery,
        ...options,
      }),
    ),
    pipelineDiagnostics,
  };
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

export async function attachRouteInventory(
  project: ExtractionProject,
  adapter: NavigationAdapter,
): Promise<ExtractionProject> {
  const files = [...project.rawEntries];
  if (
    adapter.packageNames.some(
      (packageName) =>
        packageName === "react-router" || packageName === "react-router-dom",
    )
  ) {
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
  } else if (adapter.packageNames.includes("@tanstack/react-router")) {
    const routeRoots = await findNearestTanstackRouteRoots(
      project.configStartDir,
    );
    for (const routeFile of routeRoots) {
      if (
        files.some((file) => resolve(file.path) === resolve(routeFile.path))
      ) {
        continue;
      }
      files.push(routeFile);
    }
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
      normalized.match(/^(.*)\/(?:src\/)?pages(?:\/|$)/) ??
      normalized.match(/^(.*)\/(?:src\/)?routes(?:\/|$)/);
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
  const manifestDir = manifestPath ? dirname(manifestPath) : undefined;
  const resolvedSource = resolve(sourcePath);
  return project.inventory.routes
    .filter((node) => {
      if (node.kind !== "page" && node.kind !== "index") return false;
      if (node.file === undefined) return false;
      const resolvedFile = resolve(node.file);
      if (resolvedFile === resolvedSource) return true;
      if (!manifestDir) return false;
      return resolve(manifestDir, node.file) === resolvedSource;
    })
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

function isInventoryRouteSource(
  sourcePath: string,
  project: ExtractionProject,
): boolean {
  const resolvedSource = resolve(sourcePath);
  if (
    project.inventory.routes.some(
      (node) =>
        node.file !== undefined && resolve(node.file) === resolvedSource,
    )
  ) {
    return true;
  }
  return isManifestRouteSource(sourcePath, project);
}

export function resolveExtractionRoute(
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

    if (isInventoryRouteSource(sourcePath, project)) {
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

async function findNearestTanstackRouteRoots(
  startDir: string,
): Promise<Array<{ path: string; text: string }>> {
  const found = new Map<string, string>();
  let current = resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    for (const routesDir of [
      join(current, "src", "routes"),
      join(current, "routes"),
    ]) {
      await collectTanstackRouteFiles(routesDir, found);
    }
    for (const generated of [
      join(current, "src", "routeTree.gen.ts"),
      join(current, "routeTree.gen.ts"),
    ]) {
      await readRouteFileIfPresent(generated, found);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return [...found.entries()]
    .map(([path, text]) => ({ path, text }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

async function collectTanstackRouteFiles(
  routesDir: string,
  found: Map<string, string>,
): Promise<void> {
  try {
    const info = await stat(routesDir);
    if (!info.isDirectory()) return;
  } catch {
    return;
  }
  await walkTanstackRouteDir(routesDir, found, 0);
}

async function walkTanstackRouteDir(
  dir: string,
  found: Map<string, string>,
  depth: number,
): Promise<void> {
  if (depth > 8) return;
  let entries: Array<{
    name: string;
    isFile: () => boolean;
    isDirectory: () => boolean;
  }>;
  try {
    const { readdir } = await import("node:fs/promises");
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkTanstackRouteDir(absolutePath, found, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(?:tsx?|jsx?)$/.test(entry.name)) continue;
    if (/\.(?:test|spec)\.(?:tsx?|jsx?)$/.test(entry.name)) continue;
    await readRouteFileIfPresent(absolutePath, found);
  }
}

async function readRouteFileIfPresent(
  path: string,
  found: Map<string, string>,
): Promise<void> {
  if (found.has(path)) return;
  try {
    const info = await stat(path);
    if (!info.isFile()) return;
    found.set(path, await readFile(path, "utf8"));
  } catch {
    // missing route file
  }
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

export function uniqueStrings(values: readonly string[]): string[] {
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

export function registryIncludesNextConfig(registry: RegistrySummary): boolean {
  return registry.adapters.cacheStorage.some((provider) =>
    provider.packageNames.includes("next"),
  );
}

export function discoverCacheStorageFragments(
  registry: RegistrySummary,
  project: ExtractionProject,
  route: string,
  bounds: { maxHistory?: number },
): {
  vars: StateVarDecl[];
  transitions: Transition[];
  warnings: string[];
  caveats: ExtractionCaveat[];
  reductions: NumericReduction[];
} {
  const providers = [...registry.adapters.cacheStorage].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const vars: StateVarDecl[] = [];
  const transitions: Transition[] = [];
  const warnings: string[] = [];
  const caveats: ExtractionCaveat[] = [];
  const reductions: NumericReduction[] = [];

  for (const provider of providers) {
    let fragment: CacheStorageFragment;
    try {
      fragment = provider.discoverCacheStorage({
        rootDir: project.configStartDir,
        files: project.rawEntries.map((entry) => ({
          path: entry.path,
          text: entry.text,
        })),
        inventory: project.inventory,
        options: { route, bounds },
      });
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : String(error ?? "unknown");
      throw new Error(
        `Cache/storage provider ${provider.id} failed during discovery: ${detail}`,
      );
    }
    if (!Array.isArray(fragment.vars) || !Array.isArray(fragment.transitions)) {
      throw new Error(
        `Cache/storage provider ${provider.id} returned an invalid fragment`,
      );
    }
    vars.push(...fragment.vars);
    transitions.push(...fragment.transitions);
    if (fragment.warnings) warnings.push(...fragment.warnings);
    caveats.push(...fragment.caveats);
    if (fragment.reductions) reductions.push(...fragment.reductions);
  }

  return { vars, transitions, warnings, caveats, reductions };
}
