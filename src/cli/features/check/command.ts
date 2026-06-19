import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getHeapStatistics } from "node:v8";
import {
  type CheckOptions,
  type CheckResult,
  checkModel,
  type PropertyVerdict,
} from "modality-ts/check";
import {
  type CheckReport,
  canonicalJson,
  type DomainReportEntry,
  type ExtractionCaveat,
  type Model,
  type NumericReduction,
  type Property,
  parseModelArtifact,
  type ReportPropertyConfidence,
  type ReportPropertyConfidenceLevel,
  type StateVarDecl,
  traceArtifact,
} from "modality-ts/core";
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
  worstNumericClaim,
} from "../../../extract/engine/ts/numeric/abstraction.js";
import {
  generateAbstractReplayTest,
  generateActionReplayTest,
  generateReplayHarness,
} from "../../codegen/replay-test.js";
import { loadAndApplyOverlay } from "../../overlay.js";
import { loadProperties } from "../../properties/load-properties.js";
import {
  type ArtifactPathEntry,
  formatCompactConfidence,
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
  partialOrderReduction?: boolean;
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
    partialOrderReduction: options.partialOrderReduction,
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
      ...renderCheckResult(check, report.verdicts),
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
      reportVerdict(verdict, model, check, properties, numericReductions),
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
    const sliced = sliceModelForProperty(model, property).model;
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

export function renderCheckResult(
  check: CheckResult,
  reportVerdicts: readonly CheckReport["verdicts"][number][] = [],
): string[] {
  const confidenceByProperty = new Map(
    reportVerdicts.map((verdict) => [verdict.property, verdict.confidence]),
  );
  const lines: string[] = [];
  for (const verdict of check.verdicts) {
    lines.push(`${verdict.property}: ${verdict.status}`);
    const confidence = confidenceByProperty.get(verdict.property);
    if (confidence && confidence.level !== "exact") {
      lines.push(`  ${formatCompactConfidence(confidence)}`);
    }
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
  const por = check.diagnostics?.partialOrderReduction;
  if (por?.requested || por?.enabled) {
    if (por.enabled) {
      lines.push(
        `por=enabled reducedStates:${por.reducedStates} skippedTransitions:${por.skippedTransitions} cycleFallbacks:${por.cycleFallbackStates}`,
      );
    } else if (por.skipped) {
      lines.push(`por=skipped reason:${por.skipReason ?? "unknown"}`);
    }
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

function partitionExtractionCaveats(model: Model) {
  const entries = model.metadata?.extractionCaveats?.entries ?? [];
  return partitionCaveats(entries);
}

const CONFIDENCE_LEVEL_RANK: Record<ReportPropertyConfidenceLevel, number> = {
  exact: 0,
  "property-preserving": 1,
  bounded: 2,
  "over-approx": 3,
  manual: 4,
  heuristic: 5,
};

function pickConfidenceLevel(
  candidates: readonly ReportPropertyConfidenceLevel[],
): ReportPropertyConfidenceLevel {
  return candidates.reduce(
    (worst, level) =>
      CONFIDENCE_LEVEL_RANK[level] > CONFIDENCE_LEVEL_RANK[worst]
        ? level
        : worst,
    "exact" as ReportPropertyConfidenceLevel,
  );
}

function sliceVarIds(
  model: Model,
  property: Property | undefined,
): Set<string> {
  if (!property) return new Set(model.vars.map((decl) => decl.id));
  return new Set(
    sliceModelForProperty(model, property).model.vars.map((decl) => decl.id),
  );
}

function sliceTransitionIds(
  model: Model,
  property: Property | undefined,
): Set<string> {
  if (!property) {
    return new Set(model.transitions.map((transition) => transition.id));
  }
  return new Set(
    sliceModelForProperty(model, property).model.transitions.map(
      (transition) => transition.id,
    ),
  );
}

function relevantModelSlackCaveats(
  caveats: readonly ExtractionCaveat[],
  sliceVars: ReadonlySet<string>,
): ExtractionCaveat[] {
  return caveats.filter((caveat) => sliceVars.has(caveat.id));
}

function relevantBoundHits(
  boundHits: readonly string[],
  sliceTransitions: ReadonlySet<string>,
): string[] {
  return boundHits.filter((hit) =>
    [...sliceTransitions].some((transitionId) => hit.includes(transitionId)),
  );
}

export function propertyConfidence(
  model: Model,
  check: CheckResult,
  property: Property | undefined,
  numericReductions: readonly NumericReduction[],
): ReportPropertyConfidence | undefined {
  const sliceVars = sliceVarIds(model, property);
  const sliceTransitions = sliceTransitionIds(model, property);
  const caveats = partitionExtractionCaveats(model);
  const relevantReductions = reductionsAffectingProperty(
    numericReductions,
    property?.reads,
  );
  const manualTransitions = model.transitions
    .filter(
      (transition) =>
        transition.confidence === "manual" &&
        sliceTransitions.has(transition.id),
    )
    .map((transition) => transition.id);
  const overApproxTransitions = model.transitions
    .filter(
      (transition) =>
        transition.confidence === "over-approx" &&
        sliceTransitions.has(transition.id),
    )
    .map((transition) => transition.id);
  const modelSlack = relevantModelSlackCaveats(caveats.modelSlack, sliceVars);
  const boundHits = relevantBoundHits(check.boundHits, sliceTransitions);
  const searchLimited = check.diagnostics?.limits !== undefined;

  const reasons: string[] = [];
  const levelCandidates: ReportPropertyConfidenceLevel[] = [];

  const worstReductionClaim = worstNumericClaim(relevantReductions);
  if (worstReductionClaim === "heuristic") {
    levelCandidates.push("heuristic");
    reasons.push(
      `Heuristic numeric reduction may hide relevant distinctions (${relevantReductions.length} reduction(s))`,
    );
  } else if (worstReductionClaim === "property-preserving") {
    levelCandidates.push("property-preserving");
    reasons.push(
      `Property-preserving numeric reduction (${relevantReductions.length} reduction(s))`,
    );
  }

  if (manualTransitions.length > 0) {
    levelCandidates.push("manual");
    reasons.push(
      `Manual transition(s) retained in property slice: ${manualTransitions.join(", ")}`,
    );
  }

  if (overApproxTransitions.length > 0) {
    levelCandidates.push("over-approx");
    reasons.push(
      `Over-approx transition(s) retained in property slice: ${overApproxTransitions.join(", ")}`,
    );
  }

  if (modelSlack.length > 0) {
    levelCandidates.push("over-approx");
    for (const caveat of modelSlack) {
      reasons.push(`Model slack: ${caveat.reason}`);
    }
  }

  if (boundHits.length > 0 || searchLimited) {
    levelCandidates.push("bounded");
    if (searchLimited) {
      reasons.push(
        `Search limit reached: ${check.diagnostics?.limits?.reason ?? "unknown"}`,
      );
    }
    for (const hit of boundHits) {
      reasons.push(`Bound hit: ${hit}`);
    }
  }

  const level = pickConfidenceLevel(levelCandidates);
  if (level === "exact") return undefined;

  const affectedVars = [
    ...new Set([
      ...relevantReductions.map((reduction) => reduction.varId),
      ...modelSlack.map((caveat) => caveat.id),
    ]),
  ].sort();

  return {
    level,
    reasons,
    caveatIds: modelSlack.map((caveat) => caveat.id).sort(),
    affectedTransitions: [
      ...new Set([...manualTransitions, ...overApproxTransitions]),
    ].sort(),
    affectedVars,
  };
}

function attachConfidence(
  verdict: CheckReport["verdicts"][number],
  confidence: ReportPropertyConfidence | undefined,
): CheckReport["verdicts"][number] {
  if (!confidence) return verdict;
  return { ...verdict, confidence };
}

function reportVerdict(
  verdict: PropertyVerdict,
  model: Model,
  check: CheckResult,
  properties: readonly Property[],
  numericReductions: readonly NumericReduction[],
): CheckReport["verdicts"][number] {
  const property = properties.find((entry) => entry.name === verdict.property);
  const confidence = propertyConfidence(
    model,
    check,
    property,
    numericReductions,
  );
  if (verdict.status === "violated" || verdict.status === "reachable") {
    return attachConfidence(
      {
        property: verdict.property,
        status: verdict.status,
        trace: verdict.trace,
        ...(verdict.replayable === false
          ? {
              replayable: false,
              replayBlockedReason: verdict.replayBlockedReason,
            }
          : {}),
      },
      confidence,
    );
  }
  if (verdict.status === "error" || verdict.status === "vacuous-warning") {
    return attachConfidence(
      {
        property: verdict.property,
        status: verdict.status,
        message: verdict.message,
      },
      confidence,
    );
  }
  const relevant = reductionsAffectingProperty(
    numericReductions,
    property?.reads,
  );
  const downgraded = downgradeVerdictForReductions(verdict.status, relevant);
  if (downgraded.status === "vacuous-warning") {
    return attachConfidence(
      {
        property: verdict.property,
        status: downgraded.status,
        message: downgraded.message,
      },
      confidence,
    );
  }
  return attachConfidence(
    { property: verdict.property, status: verdict.status },
    confidence,
  );
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
