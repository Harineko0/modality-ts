import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getHeapStatistics } from "node:v8";
import {
  type CheckOptions,
  type CheckResult,
  checkModel,
  type PropertyVerdict,
} from "modality-ts/check";
import {
  assertSerializableProperty,
  type CheckReport,
  canonicalJson,
  type DomainReportEntry,
  type Model,
  type Property,
  type PropertyArtifact,
  type PropertyExport,
  type PropertyFactory,
  parseModelArtifact,
  type StateVarDecl,
  traceArtifact,
} from "modality-ts/core";
import {
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
  transpileModule,
} from "typescript";
import {
  canSliceAllProperties,
  sliceModelForProperty,
} from "../../../check/slicing/slice-model.js";
import { partitionCaveats } from "../../../extract/engine/ts/caveats.js";
import {
  downgradeVerdictForReductions,
  mergeNumericReductions,
  numericCoiDroppedReductions,
  reductionsAffectingProperty,
} from "../../../extract/engine/ts/numeric/abstraction.js";
import {
  generateAbstractReplayTest,
  generateActionReplayTest,
  generateReplayHarness,
} from "../../codegen/replay-test.js";
import { loadAndApplyOverlay } from "../../overlay.js";
import {
  type ArtifactPathEntry,
  renderHumanCheckArtifacts,
  renderHumanCheckResult,
} from "./output.js";

const DEFAULT_CLI_MAX_STATES = 1_000_000;
const DEFAULT_CLI_MAX_EDGES = 5_000_000;
const DEFAULT_CLI_MAX_FRONTIER = 250_000;
const MIB = 1024 * 1024;

export interface CheckCommandOptions {
  modelPath: string;
  propsPath?: string;
  propsPaths?: readonly string[];
  reportPath?: string;
  overlayPath?: string;
  tracesDir?: string;
  replayTestsDir?: string;
  actionReplayTestsDir?: string;
  statesPath?: string;
  searchLimits?:
    | {
        maxStates?: number;
        maxEdges?: number;
        maxFrontier?: number;
        memoryGuardBytes?: number;
      }
    | false;
  now?: Date;
  output?: {
    emit?: (line: string) => void;
    color?: boolean;
    human?: boolean;
  };
}

export interface CheckCommandResult {
  check: CheckResult;
  report: CheckReport;
  exitCode: number;
  lines: string[];
  artifacts: readonly ArtifactPathEntry[];
}

export async function runCheckCommand(
  options: CheckCommandOptions,
): Promise<CheckCommandResult> {
  const loadedModel = parseModelArtifact(
    await readFile(options.modelPath, "utf8"),
  );
  const overlay = await loadAndApplyOverlay(loadedModel, options.overlayPath);
  if (overlay.errors.length > 0) {
    throw new Error(`Overlay merge failed: ${overlay.errors.join("; ")}`);
  }
  const model = overlay.model;
  const properties = await loadProperties(model, [
    ...(options.propsPaths ?? []),
    ...(options.propsPath ? [options.propsPath] : []),
  ]);
  const canSlice = canSliceAllProperties(model, properties);
  const check = checkModel(model, properties, {
    slicing: canSlice,
    ...resolveCheckSearchLimits(options.searchLimits),
  });
  const streamHuman =
    options.output?.emit !== undefined && options.output.human === true;
  const outputOptions = { color: options.output?.color };
  if (streamHuman) {
    for (const line of renderHumanCheckResult(check, outputOptions)) {
      options.output?.emit?.(line);
    }
  }
  const report = createCheckReport(
    model,
    check,
    options.now ?? new Date(),
    overlay.warnings,
    overlay.ignoredVars,
    properties,
  );
  if (options.reportPath) {
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, `${canonicalJson(report)}\n`, "utf8");
  }
  const emitArtifacts = (entries: readonly ArtifactPathEntry[]) => {
    if (!streamHuman || entries.length === 0) return;
    for (const line of renderHumanCheckArtifacts(entries, outputOptions)) {
      options.output?.emit?.(line);
    }
  };
  const artifacts: ArtifactPathEntry[] = [];
  const tracePaths = options.tracesDir
    ? await writeTraceArtifacts(check, options.tracesDir, (kind, path) => {
        artifacts.push({ kind, path });
      })
    : [];
  emitArtifacts(tracePaths.map((path) => ({ kind: "trace" as const, path })));
  const replayTestPaths = options.replayTestsDir
    ? await writeReplayTestArtifacts(
        check,
        options.replayTestsDir,
        (kind, path) => {
          artifacts.push({ kind, path });
        },
      )
    : [];
  emitArtifacts(
    replayTestPaths.map((path) => ({ kind: "replayTest" as const, path })),
  );
  const actionReplayTestPaths = options.actionReplayTestsDir
    ? await writeActionReplayTestArtifacts(
        check,
        options.actionReplayTestsDir,
        (kind, path) => {
          artifacts.push({ kind, path });
        },
      )
    : [];
  emitArtifacts(
    actionReplayTestPaths.map((path) => ({
      kind: "actionReplayTest" as const,
      path,
    })),
  );
  return {
    check,
    report,
    exitCode: check.verdicts.some(
      (verdict) => verdict.status === "violated" || verdict.status === "error",
    )
      ? 2
      : 0,
    lines: [
      ...renderCheckResult(check),
      ...tracePaths.map((path) => `trace=${path}`),
      ...replayTestPaths.map((path) => `replayTest=${path}`),
      ...actionReplayTestPaths.map((path) => `actionReplayTest=${path}`),
    ],
    artifacts,
  };
}

export function createCheckReport(
  model: Model,
  check: CheckResult,
  now: Date,
  overlayWarnings: readonly string[] = [],
  ignoredVars: readonly string[] = [],
  properties: readonly Property[] = [],
): CheckReport {
  const numericReductions = collectCheckNumericReductions(model, properties);
  return {
    schemaVersion: 1,
    kind: "check-report",
    modelId: model.id,
    generatedAt: now.toISOString(),
    verdicts: check.verdicts.map((verdict) =>
      reportVerdict(verdict, model, properties, numericReductions),
    ),
    stats: check.stats,
    vacuityWarnings: [...check.vacuityWarnings, ...overlayWarnings].sort(),
    ...(check.diagnostics ? { diagnostics: check.diagnostics } : {}),
    trustLedger: (() => {
      const caveats = partitionExtractionCaveats(model);
      return {
        bounds: model.bounds,
        plugins: model.metadata?.plugins ?? [],
        assumptions: trustLedgerAssumptions(model),
        abstractions: model.vars
          .filter(
            (decl) =>
              decl.domain.kind === "tokens" || decl.domain.kind === "lengthCat",
          )
          .map((decl) => `${decl.id}:${decl.domain.kind}`),
        globalTaints: caveats.globalTaints,
        staleReads: caveats.staleReads,
        unhandledRejections: caveats.unhandledRejections,
        unextractableHandlers: caveats.unextractableHandlers,
        modelSlack: caveats.modelSlack,
        domains: model.vars
          .map((decl) => domainReportEntry(model, decl))
          .sort((left, right) => left.varId.localeCompare(right.varId)),
        manualTransitions: model.transitions
          .filter((transition) => transition.confidence === "manual")
          .map((transition) => transition.id),
        overApproxTransitions: model.transitions
          .filter((transition) => transition.confidence === "over-approx")
          .map((transition) => transition.id),
        boundHits: check.boundHits,
        ignoredVars,
        numericReductions,
      };
    })(),
  };
}

function collectCheckNumericReductions(
  model: Model,
  properties: readonly Property[],
): CheckReport["trustLedger"]["numericReductions"] {
  const coiReductions = properties.flatMap((property) => {
    if (!property.reads) return [];
    const sliced = sliceModelForProperty(model, property);
    return numericCoiDroppedReductions(model, sliced, property.reads);
  });
  return mergeNumericReductions(
    model.metadata?.numericReductions?.entries,
    coiReductions,
  );
}

function domainReportEntry(
  model: Model,
  decl: StateVarDecl,
): DomainReportEntry {
  return {
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
  };
}

function trustLedgerAssumptions(model: Model): string[] {
  return [
    `bound:maxPending=${model.bounds.maxPending}`,
    ...sourceHashAssumptions(model),
  ];
}

function sourceHashAssumptions(model: Model): string[] {
  return Object.entries(model.metadata?.sourceHashes ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, hash]) => `sourceHash:${file}=${hash}`);
}

export function renderCheckResult(check: CheckResult): string[] {
  const lines: string[] = [];
  for (const verdict of check.verdicts) {
    lines.push(`${verdict.property}: ${verdict.status}`);
    if (verdict.status === "violated" || verdict.status === "reachable") {
      lines.push(
        `  trace steps: ${verdict.trace.steps.map((step) => step.transitionId).join(" -> ") || "(initial)"}`,
      );
    }
    if (verdict.status === "error" || verdict.status === "vacuous-warning") {
      lines.push(`  ${verdict.message}`);
    }
  }
  lines.push(
    `states=${check.stats.states} edges=${check.stats.edges} depth=${check.stats.depth}`,
  );
  const slicing = check.diagnostics?.slicing;
  if (slicing?.enabled) {
    const totalVars =
      slicing.sliceSummaries?.reduce((sum, summary) => sum + summary.vars, 0) ??
      0;
    const totalTransitions =
      slicing.sliceSummaries?.reduce(
        (sum, summary) => sum + summary.transitions,
        0,
      ) ?? 0;
    lines.push(
      `slicing=slices:${slicing.slices ?? 0} vars:${totalVars} transitions:${totalTransitions} skipped:0`,
    );
  } else if (slicing?.skipped) {
    lines.push(`slicing=skipped reason:${slicing.skipReason ?? "unknown"}`);
  }
  const limits = check.diagnostics?.limits;
  if (limits) {
    const limitKind =
      limits.maxStates !== undefined
        ? "maxStates"
        : limits.maxFrontier !== undefined
          ? "maxFrontier"
          : limits.maxEdges !== undefined
            ? "maxEdges"
            : "memoryGuard";
    lines.push(
      `search-limit=${limitKind} states=${check.stats.states} frontier=${check.diagnostics?.search?.finalFrontier ?? 0} depth=${check.stats.depth}`,
    );
  }
  const storage = check.diagnostics?.storage;
  if (storage) {
    lines.push(
      `storage=mode:${storage.edgeRecordingMode} recordedEdges:${storage.recordedEdges} storedStates:${storage.storedStates} parentEntries:${storage.parentEntries}`,
    );
  }
  const hotPath = check.diagnostics?.hotPath;
  if (hotPath) {
    lines.push(
      `hotPath=canonicalCache:${hotPath.canonicalCache} transitionIndex:${hotPath.transitionIndex} internalTransitionIndex:${hotPath.internalTransitionIndex}`,
    );
  }
  return lines;
}

function defaultMemoryGuardBytes(): number | undefined {
  const heapLimit = getHeapStatistics().heap_size_limit;
  const headroom = Math.min(heapLimit * 0.8, heapLimit - 256 * MIB);
  const bytes = Math.floor(headroom);
  return bytes > 0 ? bytes : undefined;
}

function resolveCheckSearchLimits(
  searchLimits?: CheckCommandOptions["searchLimits"],
): Pick<
  CheckOptions,
  "maxStates" | "maxEdges" | "maxFrontier" | "memoryGuard"
> {
  if (searchLimits === false) {
    return {};
  }
  const defaults = {
    maxStates: DEFAULT_CLI_MAX_STATES,
    maxEdges: DEFAULT_CLI_MAX_EDGES,
    maxFrontier: DEFAULT_CLI_MAX_FRONTIER,
    memoryGuardBytes: defaultMemoryGuardBytes(),
  };
  const resolved =
    searchLimits === undefined
      ? defaults
      : {
          maxStates: searchLimits.maxStates ?? defaults.maxStates,
          maxEdges: searchLimits.maxEdges ?? defaults.maxEdges,
          maxFrontier: searchLimits.maxFrontier ?? defaults.maxFrontier,
          memoryGuardBytes:
            searchLimits.memoryGuardBytes ?? defaults.memoryGuardBytes,
        };
  return {
    maxStates: resolved.maxStates,
    maxEdges: resolved.maxEdges,
    maxFrontier: resolved.maxFrontier,
    ...(resolved.memoryGuardBytes !== undefined
      ? { memoryGuard: { maxHeapUsedBytes: resolved.memoryGuardBytes } }
      : {}),
  };
}

async function loadProperties(
  model: Model,
  propsPaths: readonly string[],
): Promise<Property[]> {
  const properties = await Promise.all(
    propsPaths.map(async (propsPath) => {
      const modulePath = await importableModulePath(propsPath);
      const module = (await import(
        /* @vite-ignore */ pathToFileURL(modulePath).href
      )) as {
        properties?: PropertyExport;
        propertiesFor?: PropertyFactory;
        default?: readonly Property[] | PropertyArtifact;
      };
      let loaded: readonly Property[];
      if (typeof module.propertiesFor === "function") {
        loaded = module.propertiesFor(model);
      } else if (typeof module.properties === "function") {
        loaded = module.properties(model);
      } else if (module.properties !== undefined) {
        loaded = module.properties;
      } else if (
        module.default &&
        typeof module.default === "object" &&
        !Array.isArray(module.default) &&
        "schemaVersion" in module.default &&
        "properties" in module.default
      ) {
        loaded = [...module.default.properties];
      } else if (Array.isArray(module.default)) {
        loaded = module.default;
      } else {
        loaded = [];
      }
      return loaded.map((property, index) =>
        assertSerializableProperty(property, `${propsPath}[${index}]`),
      );
    }),
  );
  return properties.flat();
}

function normalizedImportCacheKey(path: string): string {
  return resolve(path);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function importCacheFileName(path: string, extension: string): string {
  return `props-${sha256(normalizedImportCacheKey(path))}.${process.pid}.${Date.now()}${extension}`;
}

async function importableModulePath(path: string): Promise<string> {
  const extension = extname(path) || ".mjs";
  if (extension === ".ts") return transpiledTypeScriptModule(path);
  if (!process.env.VITEST) return path;
  const cacheDir = join(process.cwd(), ".modality", "import-cache");
  await mkdir(cacheDir, { recursive: true });
  const copyPath = join(cacheDir, importCacheFileName(path, extension));
  await copyFile(path, copyPath);
  return copyPath;
}

async function transpiledTypeScriptModule(path: string): Promise<string> {
  const cacheDir = join(process.cwd(), ".modality", "import-cache");
  await mkdir(cacheDir, { recursive: true });
  const source = await readFile(path, "utf8");
  const output = transpileModule(source, {
    fileName: path,
    compilerOptions: {
      target: ScriptTarget.ES2022,
      module: ModuleKind.ES2022,
      moduleResolution: ModuleResolutionKind.NodeNext,
      sourceMap: false,
      verbatimModuleSyntax: true,
    },
  });
  const copyPath = join(cacheDir, importCacheFileName(path, ".mjs"));
  await writeFile(copyPath, output.outputText, "utf8");
  return copyPath;
}

function reportVerdict(
  verdict: PropertyVerdict,
  _model: Model,
  properties: readonly Property[],
  numericReductions: readonly import("modality-ts/core").NumericReduction[],
): CheckReport["verdicts"][number] {
  if (verdict.status === "violated" || verdict.status === "reachable") {
    return {
      property: verdict.property,
      status: verdict.status,
      trace: verdict.trace,
      ...(verdict.replayable === false
        ? {
            replayable: false,
            replayBlockedReason: verdict.replayBlockedReason,
          }
        : {}),
    };
  }
  if (verdict.status === "error" || verdict.status === "vacuous-warning") {
    return {
      property: verdict.property,
      status: verdict.status,
      message: verdict.message,
    };
  }
  const property = properties.find((entry) => entry.name === verdict.property);
  const relevant = reductionsAffectingProperty(
    numericReductions,
    property?.reads,
  );
  const downgraded = downgradeVerdictForReductions(verdict.status, relevant);
  if (downgraded.status === "vacuous-warning") {
    return {
      property: verdict.property,
      status: downgraded.status,
      message: downgraded.message,
    };
  }
  return { property: verdict.property, status: verdict.status };
}

async function writeTraceArtifacts(
  check: CheckResult,
  tracesDir: string,
  onPath?: (kind: ArtifactPathEntry["kind"], path: string) => void,
): Promise<string[]> {
  await mkdir(tracesDir, { recursive: true });
  const paths: string[] = [];
  for (const verdict of check.verdicts) {
    if (verdict.status !== "violated" && verdict.status !== "reachable")
      continue;
    const path = join(
      tracesDir,
      `${safeFileName(verdict.property)}.${verdict.status}.trace.json`,
    );
    await writeFile(
      path,
      `${canonicalJson(traceArtifact(verdict.trace))}\n`,
      "utf8",
    );
    paths.push(path);
    onPath?.("trace", path);
  }
  return paths;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function writeReplayTestArtifacts(
  check: CheckResult,
  replayTestsDir: string,
  onPath?: (kind: ArtifactPathEntry["kind"], path: string) => void,
): Promise<string[]> {
  await mkdir(replayTestsDir, { recursive: true });
  const paths: string[] = [];
  for (const verdict of check.verdicts) {
    if (verdict.status !== "violated") continue;
    if (verdict.replayable === false) continue;
    const artifact = generateAbstractReplayTest(
      verdict.property,
      verdict.trace,
    );
    const path = join(replayTestsDir, artifact.fileName);
    await writeFile(path, artifact.source, "utf8");
    paths.push(path);
    onPath?.("replayTest", path);
  }
  return paths;
}

async function writeActionReplayTestArtifacts(
  check: CheckResult,
  replayTestsDir: string,
  onPath?: (kind: ArtifactPathEntry["kind"], path: string) => void,
): Promise<string[]> {
  await mkdir(replayTestsDir, { recursive: true });
  const paths: string[] = [];
  let wroteHarness = false;
  for (const verdict of check.verdicts) {
    if (verdict.status !== "violated") continue;
    if (verdict.replayable === false) continue;
    if (!wroteHarness) {
      const harness = generateReplayHarness();
      const harnessPath = join(replayTestsDir, harness.fileName);
      await writeFile(harnessPath, harness.source, "utf8");
      paths.push(harnessPath);
      onPath?.("actionReplayTest", harnessPath);
      wroteHarness = true;
    }
    const artifact = generateActionReplayTest(verdict.property, verdict.trace);
    const path = join(replayTestsDir, artifact.fileName);
    await writeFile(path, artifact.source, "utf8");
    paths.push(path);
    onPath?.("actionReplayTest", path);
  }
  return paths;
}

function partitionExtractionCaveats(model: Model) {
  const entries = model.metadata?.extractionCaveats?.entries ?? [];
  return partitionCaveats(entries);
}
