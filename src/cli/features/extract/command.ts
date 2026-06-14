import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, extname, join, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript";
import { runExtractionPipeline } from "modality-ts/extract";
import {
  canonicalJson,
  parseModelArtifact,
  type EffectIR,
  type ExtractionCaveat,
  type ExtractionReport,
  type Model,
  type OverlaySpec,
  type StateVarDecl,
} from "modality-ts/core";
import type { Bounds } from "modality-ts/core";
import type {
  RouterPlugin,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";
import { routerSource } from "modality-ts/extract/sources/router";
import { emitAppModel } from "../../codegen/model.js";
import { loadAndApplyOverlay, loadOverlaySpec } from "../../overlay.js";
import { createBuiltinModalityRegistry } from "../../registry/index.js";

export interface ModalityConfig {
  route?: string;
  effectApis?: readonly string[];
  bounds?: Partial<Bounds>;
  packageJsonPath?: string;
  disabledPlugins?: readonly string[];
  plugins?: readonly StateSourcePlugin[];
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
  routerPlugin?: RouterPlugin | false;
  bounds?: Partial<Bounds>;
  explainDrift?: boolean;
  now?: Date;
}

export interface ExtractCommandResult {
  model: Model;
  report: ExtractionReport;
  lines: string[];
}

export async function runExtractCommand(
  options: ExtractCommandOptions,
): Promise<ExtractCommandResult> {
  const sourcePaths = normalizedSourcePaths(options);
  const project = await loadExtractionProject(sourcePaths);
  const config = await loadModalityConfig(
    options.configPath ?? (await findNearestConfig(project.configStartDir)),
  );
  const route = options.route ?? config.route ?? "/";
  const appModelPath =
    options.appModelPath ?? `${dirname(options.modelPath)}/app.model.ts`;
  const packageJsonPath =
    options.packageJsonPath ??
    config.packageJsonPath ??
    (await findNearestPackageJson(project.configStartDir));
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
    routerPlugin: options.routerPlugin ?? config.routerPlugin,
  });
  const effectApis = uniqueStrings([
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
  const pipeline = runExtractionPipeline({
    sourceText: project.sourceText,
    fileName: project.entryFile,
    route,
    routePatterns: project.routes,
    effectApis,
    sourcePlugins: registry.sourcePlugins,
    routerPlugin: registry.routerPlugin,
  });
  const transitions = [...pipeline.transitions];
  const discoveredRoutes = uniqueStrings([
    route,
    ...project.routes,
    ...transitionNavigatedRoutes(transitions),
  ]);
  const defaultRouter = routerSource();
  const routeVars = registry.routerPlugin
    ? registry.routerPlugin.routeVars(discoveredRoutes, {
        route,
        bounds: { maxHistory: 4 },
      })
    : defaultRouter.routeVars(discoveredRoutes, {
        route,
        bounds: { maxHistory: 4 },
      });
  const templateVars = pipeline.templateFragments.flatMap(
    (fragment) => fragment.vars,
  );
  const stateVars = refineAssignedLiteralDomains(
    [...pipeline.stateVars, ...templateVars],
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
      ...pendingVars(
        effectApis,
        transitions,
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
  const warnings = [
    ...pipeline.warnings,
    ...overlay.warnings,
    ...pluginConformanceWarnings(registry.sourcePlugins, dependencies),
  ];
  const extractionCaveats = createExtractionCaveats(warnings);
  const model: Model = {
    ...overlay.model,
    metadata: {
      ...overlay.model.metadata,
      extractionCaveats,
    },
  };
  const report = createExtractionReport(
    project.sourceFiles,
    model,
    warnings,
    overlay.ignoredVars,
    options.now ?? new Date(),
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
  return {
    model,
    report,
    lines: [
      `extracted vars=${pipeline.stateVars.length + pipeline.templateFragments.flatMap((fragment) => fragment.vars).length} transitions=${transitions.length}`,
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
  sourceFiles: string[];
  sources: Array<{ path: string; text: string }>;
  routes: string[];
  effectApis: string[];
  configStartDir: string;
}

interface TsConfigResolution {
  baseUrl?: string;
  paths: Array<{ prefix: string; suffix: string; targets: string[] }>;
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
  const resolved = sourcePaths[0]!;
  const info = await stat(resolved);
  if (!info.isDirectory()) {
    const source = await readFile(resolved, "utf8");
    const tsconfig = await readTsConfigResolution(dirname(resolved));
    const imported = await sourceWithLocalImports(
      [{ path: resolved, text: source }],
      tsconfig,
    );
    return {
      entryFile: resolved,
      sourceText: imported.sources.map((entry) => entry.text).join("\n"),
      sourceFiles: imported.sources.map((entry) => entry.path),
      sources: imported.sources,
      routes: [],
      effectApis: fetchEffectApis(
        imported.sources.map((entry) => entry.text).join("\n"),
      ),
      configStartDir: dirname(resolved),
    };
  }
  const routesPath = join(resolved, "app", "routes.ts");
  const routeEntries = parseReactRouterRoutes(
    await readFile(routesPath, "utf8"),
  );
  const rootPath = join(resolved, "app", "root.tsx");
  const roots = await existingFiles([rootPath]);
  const entries = [
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
  const tsconfig = await readTsConfigResolution(resolved);
  const imported = await sourceWithLocalImports(entries, tsconfig);
  const sourceText = imported.sources.map((entry) => entry.text).join("\n");
  return {
    entryFile: routesPath,
    sourceText,
    sourceFiles: imported.sources.map((entry) => entry.path),
    sources: imported.sources,
    routes: uniqueStrings(routeEntries.map((entry) => entry.pattern)),
    effectApis: fetchEffectApis(sourceText),
    configStartDir: resolved,
  };
}

async function loadMultiFileExtractionProject(
  sourcePaths: readonly string[],
): Promise<ExtractionProject> {
  const projects = await Promise.all(
    sourcePaths.map((sourcePath) => loadExtractionProject([sourcePath])),
  );
  const sourcesByPath = new Map<string, { path: string; text: string }>();
  for (const project of projects) {
    for (const source of project.sources) {
      sourcesByPath.set(source.path, source);
    }
  }
  const sources = [...sourcesByPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  const sourceText = sources.map((entry) => entry.text).join("\n");
  return {
    entryFile: projects.map((project) => project.entryFile).join(","),
    sourceText,
    sourceFiles: sources.map((entry) => entry.path),
    sources,
    routes: uniqueStrings(projects.flatMap((project) => project.routes)),
    effectApis: uniqueStrings([
      ...projects.flatMap((project) => project.effectApis),
      ...fetchEffectApis(sourceText),
    ]),
    configStartDir: commonAncestor(
      projects.map((project) => project.configStartDir),
    ),
  };
}

async function sourceWithLocalImports(
  entries: Array<{ path: string; text: string }>,
  tsconfig: TsConfigResolution,
): Promise<{ sources: Array<{ path: string; text: string }> }> {
  const seen = new Set<string>();
  const sources: Array<{ path: string; text: string }> = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const next = queue.shift()!;
    const canonical = resolve(next.path);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    sources.push({ path: canonical, text: next.text });
    for (const specifier of localImportSpecifiers(next.text)) {
      const imported = await resolveImportPath(
        dirname(canonical),
        specifier,
        tsconfig,
      );
      if (imported)
        queue.push({ path: imported, text: await readFile(imported, "utf8") });
    }
  }
  return { sources };
}

function localImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const parsed = tsCreateSourceFile(source);
  const visit = (node: import("typescript").Node): void => {
    if (
      tsIsImportDeclaration(node) &&
      tsIsStringLiteral(node.moduleSpecifier) &&
      isLocalImportSpecifier(node.moduleSpecifier.text)
    ) {
      specs.push(node.moduleSpecifier.text);
    }
    tsForEachChild(node, visit);
  };
  visit(parsed);
  return specs;
}

function tsCreateSourceFile(source: string): import("typescript").SourceFile {
  return ts.createSourceFile(
    "imports.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function tsIsImportDeclaration(
  node: import("typescript").Node,
): node is import("typescript").ImportDeclaration {
  return ts.isImportDeclaration(node);
}

function tsIsStringLiteral(
  node: import("typescript").Node,
): node is import("typescript").StringLiteral {
  return ts.isStringLiteral(node);
}

function tsForEachChild(
  node: import("typescript").Node,
  cb: (node: import("typescript").Node) => void,
): void {
  ts.forEachChild(node, cb);
}

function isLocalImportSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("~/");
}

async function resolveImportPath(
  baseDir: string,
  specifier: string,
  tsconfig: TsConfigResolution,
): Promise<string | undefined> {
  if (specifier.startsWith("./+types/") || specifier.startsWith("../+types/"))
    return undefined;
  const bases = importBases(baseDir, specifier, tsconfig);
  for (const base of bases) {
    const resolved = await firstExistingModulePath(base);
    if (resolved) return resolved;
  }
  return undefined;
}

function importBases(
  baseDir: string,
  specifier: string,
  tsconfig: TsConfigResolution,
): string[] {
  if (specifier.startsWith(".")) return [resolve(baseDir, specifier)];
  const matches = tsconfig.paths.flatMap((entry) => {
    if (
      !specifier.startsWith(entry.prefix) ||
      !specifier.endsWith(entry.suffix)
    )
      return [];
    const star = specifier.slice(
      entry.prefix.length,
      specifier.length - entry.suffix.length,
    );
    return entry.targets.map((target) => resolve(target.replace("*", star)));
  });
  if (matches.length > 0) return matches;
  return tsconfig.baseUrl ? [resolve(tsconfig.baseUrl, specifier)] : [];
}

async function firstExistingModulePath(
  base: string,
): Promise<string | undefined> {
  const candidates = /\.[cm]?[jt]sx?$/.test(base)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.mts`,
        `${base}.cts`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
      ];
  for (const candidate of candidates) {
    try {
      const candidateStat = await stat(candidate);
      if (candidateStat.isFile()) return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return undefined;
}

async function readTsConfigResolution(
  startDir: string,
): Promise<TsConfigResolution> {
  const tsconfigPath = await findNearestTsConfig(startDir);
  if (!tsconfigPath) return { paths: [] };
  const parsed = JSON.parse(await readFile(tsconfigPath, "utf8")) as {
    compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
  };
  const configDir = dirname(tsconfigPath);
  const baseUrl = parsed.compilerOptions?.baseUrl
    ? resolve(configDir, parsed.compilerOptions.baseUrl)
    : configDir;
  const paths = Object.entries(parsed.compilerOptions?.paths ?? {}).map(
    ([key, targets]) => {
      const star = key.indexOf("*");
      const prefix = star >= 0 ? key.slice(0, star) : key;
      const suffix = star >= 0 ? key.slice(star + 1) : "";
      return {
        prefix,
        suffix,
        targets: targets.map((target) => resolve(baseUrl, target)),
      };
    },
  );
  return { baseUrl, paths };
}

async function findNearestTsConfig(
  startDir: string,
): Promise<string | undefined> {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, "tsconfig.json");
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

function parseReactRouterRoutes(
  source: string,
): Array<{ pattern: string; file: string }> {
  const routes: Array<{ pattern: string; file: string }> = [];
  const parsed = tsCreateSourceFile(source);
  const visit = (node: import("typescript").Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (
        node.expression.text === "index" &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        routes.push({ pattern: "/", file: node.arguments[0].text });
      }
      if (
        node.expression.text === "route" &&
        ts.isStringLiteral(node.arguments[0]) &&
        ts.isStringLiteral(node.arguments[1])
      ) {
        routes.push({
          pattern: reactRouterPathPattern(node.arguments[0].text),
          file: node.arguments[1].text,
        });
      }
    }
    tsForEachChild(node, visit);
  };
  visit(parsed);
  return routes;
}

function reactRouterPathPattern(pattern: string): string {
  const normalized = pattern.startsWith("/") ? pattern : `/${pattern}`;
  return normalized.replace(/\$([A-Za-z0-9_]+)/g, ":$1").replace(/\*$/, "*");
}

function sourceHashes(
  sources: readonly { path: string; text: string }[],
): Record<string, string> {
  return Object.fromEntries(
    sources.map((source) => [source.path, sha256(source.text)]),
  );
}

function fetchEffectApis(sourceText: string): string[] {
  const source = tsCreateSourceFile(sourceText);
  const ops = new Set<string>();
  const visit = (node: import("typescript").Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "fetch"
    ) {
      const op = fetchOpId(node);
      if (op) ops.add(op);
    }
    tsForEachChild(node, visit);
  };
  visit(source);
  return [...ops].sort();
}

function fetchOpId(
  call: import("typescript").CallExpression,
): string | undefined {
  const first = call.arguments[0];
  if (!first) return undefined;
  const path = fetchPathValue(first);
  if (!path) return undefined;
  const method = fetchMethodValue(call.arguments[1]) ?? "GET";
  return `${method} ${path}`;
}

function fetchPathValue(
  expression: import("typescript").Expression,
): string | undefined {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  )
    return normalizeFetchPath(expression.text);
  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;
    for (const span of expression.templateSpans)
      value += `:id${span.literal.text}`;
    return normalizeFetchPath(value);
  }
  return undefined;
}

function normalizeFetchPath(path: string): string {
  return (path.startsWith("/") ? path : `/${path}`).replace(
    /\/:param(?=\/|$)/g,
    "/:id",
  );
}

function fetchMethodValue(
  expression: import("typescript").Expression | undefined,
): string | undefined {
  if (!expression || !ts.isObjectLiteralExpression(expression))
    return undefined;
  const method = expression.properties.find(
    (property): property is import("typescript").PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      propertyName(property.name) === "method",
  );
  const value = method ? literalString(method.initializer) : undefined;
  return value?.toUpperCase();
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
  return prefix === "" ? parse(paths[0]!).root : prefix;
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

function createExtractionReport(
  sourceFiles: readonly string[],
  model: Model,
  warnings: readonly string[],
  ignoredVars: readonly string[],
  now: Date,
): ExtractionReport {
  const caveats = model.metadata?.extractionCaveats ?? emptyExtractionCaveats();
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
  const unextractableHandlers = dedupeUnextractableHandlers(warnings)
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
  return {
    schemaVersion: 1,
    kind: "extraction-report",
    generatedAt: now.toISOString(),
    sourceFiles,
    plugins: model.metadata?.plugins ?? [],
    handlers,
    globalTaints: caveats.globalTaints,
    staleReads: caveats.staleReads,
    unhandledRejections: caveats.unhandledRejections,
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
    coverage: {
      handlersTotal: handlers.length,
      exactOrOverlay,
      unextractable,
      ignoredVars: ignoredVars.length,
      percentExactOrOverlay:
        handlers.length === 0 ? 1 : exactOrOverlay / handlers.length,
    },
    warnings,
  };
}

function emptyExtractionCaveats(): NonNullable<
  NonNullable<Model["metadata"]>["extractionCaveats"]
> {
  return {
    globalTaints: [],
    staleReads: [],
    unhandledRejections: [],
    unextractableHandlers: [],
  };
}

function createExtractionCaveats(
  warnings: readonly string[],
): NonNullable<NonNullable<Model["metadata"]>["extractionCaveats"]> {
  return {
    globalTaints: warnings
      .map(globalTaintFromWarning)
      .filter(isCaveat)
      .sort(compareCaveats),
    staleReads: warnings
      .map(staleReadFromWarning)
      .filter(isCaveat)
      .sort(compareCaveats),
    unhandledRejections: warnings
      .map(unhandledRejectionFromWarning)
      .filter(isCaveat)
      .sort(compareCaveats),
    unextractableHandlers: dedupeUnextractableHandlers(warnings),
  };
}

function globalTaintFromWarning(warning: string): ExtractionCaveat | undefined {
  const match = /^Global taint (.+)$/.exec(warning);
  return match?.[1] ? { id: match[1], reason: warning } : undefined;
}

function staleReadFromWarning(warning: string): ExtractionCaveat | undefined {
  const match = /^Stale-read risk (.+)$/.exec(warning);
  return match?.[1] ? { id: match[1], reason: warning } : undefined;
}

function unhandledRejectionFromWarning(
  warning: string,
): ExtractionCaveat | undefined {
  const match = /^Unhandled rejection (.+)$/.exec(warning);
  return match?.[1] ? { id: match[1], reason: warning } : undefined;
}

function isCaveat(
  value: ExtractionCaveat | undefined,
): value is ExtractionCaveat {
  return Boolean(value);
}

function compareCaveats(
  left: ExtractionCaveat,
  right: ExtractionCaveat,
): number {
  return (
    left.id.localeCompare(right.id) || left.reason.localeCompare(right.reason)
  );
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
  return [...plugins.sources, ...(plugins.router ? [plugins.router] : [])].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
  );
}

function transitionNavigatedRoutes(
  transitions: readonly Model["transitions"][number][],
): string[] {
  const routes = new Set<string>();
  const visit = (effect: EffectIR): void => {
    if (
      effect.kind === "navigate" &&
      effect.to?.kind === "lit" &&
      typeof effect.to.value === "string"
    )
      routes.add(effect.to.value);
    if (effect.kind === "seq") {
      for (const child of effect.effects) visit(child);
    }
    if (effect.kind === "if") {
      visit(effect.then);
      visit(effect.else);
    }
  };
  for (const transition of transitions) visit(transition.effect);
  return [...routes].sort();
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
    let diagonal = previous[0]!;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const up = previous[rightIndex]! + 1;
      const leftCost = previous[rightIndex - 1]! + 1;
      const subst =
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      diagonal = previous[rightIndex]!;
      previous[rightIndex] = Math.min(up, leftCost, subst);
    }
  }
  return previous[right.length]!;
}

function havocWrites(effect: EffectIR): string[] {
  if (effect.kind === "havoc") return [effect.var];
  if (effect.kind === "seq") return effect.effects.flatMap(havocWrites);
  if (effect.kind === "if")
    return [...havocWrites(effect.then), ...havocWrites(effect.else)];
  return [];
}

const GENERIC_UNEXTRACTABLE_CATEGORIES = new Set([
  "no-extractable-effect",
  "unextractable",
]);

function dedupeUnextractableHandlers(
  warnings: readonly string[],
): ExtractionCaveat[] {
  const parsed = warnings.map(unextractableHandlerFromWarning).filter(
    (
      handler,
    ): handler is {
      id: string;
      reason: string;
      source?: string;
      category: string;
    } => Boolean(handler),
  );
  const byId = new Map<
    string,
    { id: string; reason: string; source?: string; category: string }
  >();
  for (const handler of parsed) {
    const existing = byId.get(handler.id);
    if (!existing) {
      byId.set(handler.id, handler);
      continue;
    }
    const existingIsGeneric = GENERIC_UNEXTRACTABLE_CATEGORIES.has(
      existing.category,
    );
    const incomingIsGeneric = GENERIC_UNEXTRACTABLE_CATEGORIES.has(
      handler.category,
    );
    if (existingIsGeneric && !incomingIsGeneric) byId.set(handler.id, handler);
  }
  return [...byId.values()]
    .map(({ id, reason, source }) =>
      source ? { id, reason, source } : { id, reason },
    )
    .sort(compareCaveats);
}

function unextractableHandlerFromWarning(
  warning: string,
):
  | { id: string; reason: string; source?: string; category: string }
  | undefined {
  const rich = /^Unextractable handler (\S+) \[([^\]]+)\] \((.+)\)$/.exec(
    warning,
  );
  if (rich)
    return {
      id: rich[1]!,
      category: rich[2]!,
      reason: `${rich[2]!} at ${rich[3]!}`,
      source: rich[3]!,
    };
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
): StateVarDecl[] {
  const enqueues = transitions.flatMap((transition) =>
    enqueueOps(transition.effect),
  );
  const opValues = new Set(effectApis);
  const continuationValues = new Set<string>();
  const argFields: Record<string, StateVarDecl["domain"]> = {};
  const varsById = new Map(vars.map((decl) => [decl.id, decl]));
  for (const op of effectApis) {
    continuationValues.add(`App.onClick.${op}.cont`);
    continuationValues.add(`App.onSubmit.${op}.cont`);
    continuationValues.add(`App.onChange.${op}.cont`);
  }
  for (const enqueue of enqueues) {
    opValues.add(enqueue.op);
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
  if (expr.kind !== "read") return { kind: "tokens", count: 1 };
  const domain = varsById.get(expr.var)?.domain;
  if (!domain) return { kind: "tokens", count: 1 };
  return expr.path?.length ? { kind: "tokens", count: 1 } : domain;
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
