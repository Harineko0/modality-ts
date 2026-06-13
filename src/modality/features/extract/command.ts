import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, parse } from "node:path";
import { pathToFileURL } from "node:url";
import { extractUseStateSkeleton, runExtractionPipeline } from "modality-ts/extraction";
import { canonicalJson, parseModelArtifact, type EffectIR, type ExtractionCaveat, type ExtractionReport, type Model, type OverlaySpec, type StateVarDecl } from "modality-ts/kernel";
import type { Bounds } from "modality-ts/kernel";
import type { RouterPlugin, StateSourcePlugin } from "modality-ts/extraction/spi";
import { routeVars as defaultRouteVars } from "modality-ts/source-router";
import { emitAppModel } from "../../codegen/model.js";
import { loadAndApplyOverlay } from "../../overlay.js";
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
  sourcePath: string;
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

export async function runExtractCommand(options: ExtractCommandOptions): Promise<ExtractCommandResult> {
  const config = await loadModalityConfig(options.configPath ?? await findNearestConfig(dirname(options.sourcePath)));
  const source = await readFile(options.sourcePath, "utf8");
  const route = options.route ?? config.route ?? "/";
  const appModelPath = options.appModelPath ?? `${dirname(options.modelPath)}/app.model.ts`;
  const packageJsonPath = options.packageJsonPath ?? config.packageJsonPath ?? await findNearestPackageJson(dirname(options.sourcePath));
  const dependencies = await readPackageDependencies(packageJsonPath);
  const registry = createBuiltinModalityRegistry({
    dependencies,
    disabledPlugins: [...(config.disabledPlugins ?? []), ...(options.disabledPlugins ?? [])],
    extraSourcePlugins: [...(config.plugins ?? []), ...(options.sourcePlugins ?? [])],
    routerPlugin: options.routerPlugin ?? config.routerPlugin
  });
  const effectApis = uniqueStrings([...(config.effectApis ?? []), ...(options.effectApis ?? [])]);
  const bounds = { maxDepth: 12, maxPending: 3, maxInternalSteps: 16, ...(config.bounds ?? {}), ...(options.bounds ?? {}) };
  const pipeline = runExtractionPipeline({
    sourceText: source,
    fileName: options.sourcePath,
    route,
    effectApis,
    sourcePlugins: registry.sourcePlugins,
    routerPlugin: registry.routerPlugin,
    extractHandlers: (sourceText, handlerOptions) => extractUseStateSkeleton(sourceText, handlerOptions)
  });
  const transitions = [...pipeline.transitions];
  const routeVars = pipeline.routeVars.length > 0 ? pipeline.routeVars : defaultRouteVars([route], { route, bounds: { maxHistory: 4 } });
  const templateVars = pipeline.templateFragments.flatMap((fragment) => fragment.vars);
  const stateVars = refineAssignedLiteralDomains([...pipeline.stateVars, ...templateVars], transitions);
  const extractedModel: Model = {
    schemaVersion: 1,
    id: "extracted-model",
    bounds,
    metadata: { sourceHashes: { [options.sourcePath]: sha256(source) }, plugins: pluginProvenance(pipeline.plugins) },
    vars: [...routeVars, ...pendingVars(effectApis, transitions, [...routeVars, ...stateVars], bounds.maxPending), ...stateVars],
    transitions
  };
  const overlaySpec = options.explainDrift && options.overlayPath ? await readOverlaySpec(options.overlayPath) : undefined;
  const driftLines = overlaySpec ? explainOverlayDrift(extractedModel, overlaySpec) : [];
  const overlay = await loadAndApplyOverlay(extractedModel, options.overlayPath);
  if (overlay.errors.length > 0) {
    throw new Error([`Overlay merge failed: ${overlay.errors.join("; ")}`, ...driftLines].join("\n"));
  }
  const warnings = [
    ...pipeline.warnings,
    ...overlay.warnings,
    ...pluginConformanceWarnings(registry.sourcePlugins, dependencies)
  ];
  const extractionCaveats = createExtractionCaveats(warnings);
  const model: Model = {
    ...overlay.model,
    metadata: {
      ...overlay.model.metadata,
      extractionCaveats
    }
  };
  const report = createExtractionReport(options.sourcePath, model, warnings, overlay.ignoredVars, options.now ?? new Date());
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
      ...(options.explainDrift ? (driftLines.length > 0 ? driftLines : ["overlay-drift=none"]) : []),
      ...(options.configPath ? [`config=${options.configPath}`] : []),
      ...(options.expectModelPath ? [`expectedModel=${options.expectModelPath}`] : []),
      ...(options.reportPath ? [`report=${options.reportPath}`] : [])
    ]
  };
}

async function readOverlaySpec(overlayPath: string): Promise<OverlaySpec> {
  return JSON.parse(await readFile(overlayPath, "utf8")) as OverlaySpec;
}

async function loadModalityConfig(configPath: string | undefined): Promise<ModalityConfig> {
  if (!configPath) return {};
  const module = (await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`)) as {
    default?: ModalityConfig | (() => ModalityConfig | Promise<ModalityConfig>);
    config?: ModalityConfig | (() => ModalityConfig | Promise<ModalityConfig>);
  };
  const exported = module.default ?? module.config ?? {};
  return typeof exported === "function" ? await exported() : exported;
}

async function findNearestConfig(startDir: string): Promise<string | undefined> {
  const names = ["modality.config.ts", "modality.config.mts", "modality.config.js", "modality.config.mjs"];
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

async function findNearestPackageJson(startDir: string): Promise<string | undefined> {
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

async function readPackageDependencies(packageJsonPath: string | undefined): Promise<Record<string, string> | undefined> {
  if (!packageJsonPath) return undefined;
  const manifest = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  return {
    ...(manifest.peerDependencies ?? {}),
    ...(manifest.devDependencies ?? {}),
    ...(manifest.dependencies ?? {})
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function assertMatchesExpectedModel(model: Model, expectedModelPath: string): Promise<void> {
  const expected = parseModelArtifact(await readFile(expectedModelPath, "utf8"));
  const actualText = canonicalJson(model);
  const expectedText = canonicalJson(expected);
  if (actualText !== expectedText) {
    throw new Error(`Extracted model differs from expected snapshot ${expectedModelPath}`);
  }
}

function createExtractionReport(sourcePath: string, model: Model, warnings: readonly string[], ignoredVars: readonly string[], now: Date): ExtractionReport {
  const caveats = model.metadata?.extractionCaveats ?? emptyExtractionCaveats();
  const transitionHandlers = model.transitions.map((transition) => ({
    id: transition.id,
    classification: transition.confidence === "manual" ? "overlay" as const : transition.confidence,
    reasons: transition.confidence === "over-approx" ? overApproxReasons(transition) : [] as string[]
  }));
  const transitionIds = new Set(transitionHandlers.map((handler) => handler.id));
  const unextractableHandlers = warnings
    .map(unextractableHandlerFromWarning)
    .filter((handler): handler is { id: string; reason: string } => Boolean(handler))
    .filter((handler) => !transitionIds.has(handler.id))
    .map((handler) => ({
      id: handler.id,
      classification: "unextractable" as const,
      reasons: [handler.reason]
    }));
  const handlers = [...transitionHandlers, ...unextractableHandlers];
  const exactOrOverlay = handlers.filter((handler) => handler.classification === "exact" || handler.classification === "overlay").length;
  const unextractable = handlers.filter((handler) => handler.classification === "unextractable").length;
  return {
    schemaVersion: 1,
    kind: "extraction-report",
    generatedAt: now.toISOString(),
    sourceFiles: [sourcePath],
    plugins: model.metadata?.plugins ?? [],
    handlers,
    globalTaints: caveats.globalTaints,
    staleReads: caveats.staleReads,
    unhandledRejections: caveats.unhandledRejections,
    domains: model.vars.map((decl) => ({
      varId: decl.id,
      domainKind: decl.domain.kind,
      provenance: model.metadata?.domainProvenance?.[decl.id] ?? (decl.origin === "system" ? "system" : decl.origin === "library-template" ? "template" : decl.domain.kind === "tokens" ? "default-token" : "type-derived")
    })),
    coverage: {
      handlersTotal: handlers.length,
      exactOrOverlay,
      unextractable,
      ignoredVars: ignoredVars.length,
      percentExactOrOverlay: handlers.length === 0 ? 1 : exactOrOverlay / handlers.length
    },
    warnings
  };
}

function emptyExtractionCaveats(): NonNullable<NonNullable<Model["metadata"]>["extractionCaveats"]> {
  return { globalTaints: [], staleReads: [], unhandledRejections: [], unextractableHandlers: [] };
}

function createExtractionCaveats(warnings: readonly string[]): NonNullable<NonNullable<Model["metadata"]>["extractionCaveats"]> {
  return {
    globalTaints: warnings.map(globalTaintFromWarning).filter(isCaveat).sort(compareCaveats),
    staleReads: warnings.map(staleReadFromWarning).filter(isCaveat).sort(compareCaveats),
    unhandledRejections: warnings.map(unhandledRejectionFromWarning).filter(isCaveat).sort(compareCaveats),
    unextractableHandlers: warnings.map(unextractableHandlerFromWarning).filter(isCaveat).sort(compareCaveats)
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

function unhandledRejectionFromWarning(warning: string): ExtractionCaveat | undefined {
  const match = /^Unhandled rejection (.+)$/.exec(warning);
  return match?.[1] ? { id: match[1], reason: warning } : undefined;
}

function isCaveat(value: ExtractionCaveat | undefined): value is ExtractionCaveat {
  return Boolean(value);
}

function compareCaveats(left: ExtractionCaveat, right: ExtractionCaveat): number {
  return left.id.localeCompare(right.id) || left.reason.localeCompare(right.reason);
}

function pluginConformanceWarnings(sourcePlugins: readonly StateSourcePlugin[], dependencies: Record<string, string> | undefined): string[] {
  if (!dependencies) return [];
  const warnings: string[] = [];
  for (const plugin of sourcePlugins) {
    const testedVersions = plugin.conformance?.testedVersions;
    if (!testedVersions) continue;
    const requirement = parseTestedVersionRange(testedVersions);
    if (!requirement) {
      warnings.push(`Plugin ${plugin.id} has unsupported testedVersions range ${testedVersions}`);
      continue;
    }
    const packageName = plugin.packageNames.find((candidate) => candidate === requirement.packageName) ?? plugin.packageNames[0];
    const actual = packageName ? dependencies[packageName] : undefined;
    if (!packageName || actual === undefined) {
      warnings.push(`Plugin ${plugin.id} tested against ${testedVersions}, but no matching app dependency was found`);
      continue;
    }
    const actualMajor = firstSemverMajor(actual);
    if (actualMajor === undefined) {
      warnings.push(`Plugin ${plugin.id} tested against ${testedVersions}, but app dependency ${packageName}@${actual} could not be parsed`);
      continue;
    }
    if (actualMajor < requirement.minimumMajor) {
      warnings.push(`Plugin ${plugin.id} tested against ${testedVersions}, but app uses ${packageName}@${actual}`);
    }
  }
  return warnings.sort();
}

function parseTestedVersionRange(range: string): { packageName: string; minimumMajor: number } | undefined {
  const match = /^([a-zA-Z0-9@/_-]+)>=([0-9]+)/.exec(range.trim());
  if (!match?.[1] || !match[2]) return undefined;
  return { packageName: match[1], minimumMajor: Number(match[2]) };
}

function firstSemverMajor(range: string): number | undefined {
  const match = /[0-9]+/.exec(range);
  return match ? Number(match[0]) : undefined;
}

function pluginProvenance(plugins: ReturnType<typeof runExtractionPipeline>["plugins"]): NonNullable<Model["metadata"]>["plugins"] {
  return [...plugins.sources, ...(plugins.router ? [plugins.router] : [])].sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
}

function overApproxReasons(transition: Model["transitions"][number]): string[] {
  const reasons = new Set<string>();
  if (transition.id.endsWith(".escaped")) reasons.add("setter escaped to unanalyzed call");
  for (const variable of havocWrites(transition.effect)) reasons.add(`havoc write to ${variable}`);
  if (reasons.size === 0) reasons.add("transition confidence is over-approx");
  return [...reasons].sort();
}

function explainOverlayDrift(model: Model, overlay: OverlaySpec): string[] {
  const transitionIds = model.transitions.map((transition) => transition.id).sort();
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

function formatDrift(kind: string, id: string, candidates: readonly string[]): string {
  const suggestions = nearestCandidates(id, candidates);
  return suggestions.length > 0
    ? `overlay-drift: ${kind} ${id} has no match; nearest=${suggestions.join(",")}`
    : `overlay-drift: ${kind} ${id} has no match; nearest=none`;
}

function nearestCandidates(id: string, candidates: readonly string[]): string[] {
  return candidates
    .map((candidate) => ({ candidate, distance: editDistance(normalizeId(id), normalizeId(candidate)) }))
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate))
    .slice(0, 3)
    .map(({ candidate, distance }) => `${candidate}(${distance})`);
}

function normalizeId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0]!;
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const up = previous[rightIndex]! + 1;
      const leftCost = previous[rightIndex - 1]! + 1;
      const subst = diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      diagonal = previous[rightIndex]!;
      previous[rightIndex] = Math.min(up, leftCost, subst);
    }
  }
  return previous[right.length]!;
}

function havocWrites(effect: EffectIR): string[] {
  if (effect.kind === "havoc") return [effect.var];
  if (effect.kind === "seq") return effect.effects.flatMap(havocWrites);
  if (effect.kind === "if") return [...havocWrites(effect.then), ...havocWrites(effect.else)];
  return [];
}

function unextractableHandlerFromWarning(warning: string): { id: string; reason: string } | undefined {
  const match = /^Unextractable handler (.+)$/.exec(warning);
  return match?.[1] ? { id: match[1], reason: warning } : undefined;
}

function pendingVars(effectApis: readonly string[], transitions: readonly Model["transitions"][number][] = [], vars: readonly StateVarDecl[] = [], maxPending = 3): StateVarDecl[] {
  const enqueues = transitions.flatMap((transition) => enqueueOps(transition.effect));
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
            args: { kind: "record", fields: argFields }
          }
        },
        maxLen: maxPending
      },
      origin: "system",
      scope: { kind: "global" },
      initial: []
    }
  ];
}

function enqueueOps(effect: EffectIR): { op: string; continuation: string; args: Extract<EffectIR, { kind: "enqueue" }>["args"] }[] {
  if (effect.kind === "enqueue") return [{ op: effect.op, continuation: effect.continuation, args: effect.args }];
  if (effect.kind === "seq") return effect.effects.flatMap(enqueueOps);
  if (effect.kind === "if") return [...enqueueOps(effect.then), ...enqueueOps(effect.else)];
  return [];
}

function pendingArgDomain(expr: Extract<EffectIR, { kind: "enqueue" }>["args"][string], varsById: ReadonlyMap<string, StateVarDecl>): StateVarDecl["domain"] | undefined {
  if (expr.kind === "lit") return domainForLiteral(expr.value);
  if (expr.kind !== "read") return { kind: "tokens", count: 1 };
  const domain = varsById.get(expr.var)?.domain;
  if (!domain) return { kind: "tokens", count: 1 };
  return expr.path?.length ? { kind: "tokens", count: 1 } : domain;
}

function refineAssignedLiteralDomains(vars: readonly StateVarDecl[], transitions: readonly Model["transitions"][number][]): StateVarDecl[] {
  const refinements = new Map<string, StateVarDecl["domain"]>();
  for (const transition of transitions) {
    for (const [varId, domain] of assignedLiteralDomains(transition.effect)) {
      refinements.set(varId, mergeArgDomains(refinements.get(varId), domain));
    }
  }
  return vars.map((decl) => {
    if (decl.origin === "library-template") return decl;
    const refinement = refinements.get(decl.id);
    return refinement ? { ...decl, domain: mergeArgDomains(decl.domain, refinement) } : decl;
  });
}

function assignedLiteralDomains(effect: EffectIR): Array<[string, StateVarDecl["domain"]]> {
  if (effect.kind === "assign" && effect.expr.kind === "lit") return [[effect.var, domainForLiteral(effect.expr.value)]];
  if (effect.kind === "choose") {
    return effect.among
      .filter((expr): expr is Extract<typeof expr, { kind: "lit" }> => expr.kind === "lit")
      .map((expr) => [effect.var, domainForLiteral(expr.value)]);
  }
  if (effect.kind === "seq") return effect.effects.flatMap(assignedLiteralDomains);
  if (effect.kind === "if") return [...assignedLiteralDomains(effect.then), ...assignedLiteralDomains(effect.else)];
  return [];
}

function domainForLiteral(value: unknown): StateVarDecl["domain"] {
  if (typeof value === "boolean") return { kind: "bool" };
  if (typeof value === "number") return { kind: "boundedInt", min: value, max: value };
  if (typeof value === "string") return { kind: "enum", values: [value] };
  if (value === null) return { kind: "option", inner: { kind: "tokens", count: 1 } };
  return { kind: "tokens", count: 1 };
}

function mergeArgDomains(left: StateVarDecl["domain"] | undefined, right: StateVarDecl["domain"]): StateVarDecl["domain"] {
  if (!left) return right;
  if (left.kind === "enum" && right.kind === "enum") return { kind: "enum", values: [...new Set([...left.values, ...right.values])].sort() };
  if (left.kind === "boundedInt" && right.kind === "boundedInt") return { kind: "boundedInt", min: Math.min(left.min, right.min), max: Math.max(left.max, right.max) };
  if (left.kind === right.kind) return left;
  return { kind: "tokens", count: 1 };
}
