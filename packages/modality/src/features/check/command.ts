import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkModel, type CheckResult, type PropertyVerdict } from "@modality-ts/checker";
import { canonicalJson, parseModelArtifact, traceArtifact, type CheckReport, type DomainReportEntry, type Model, type Property, type StateVarDecl } from "@modality-ts/kernel";
import { generateAbstractReplayTest, generateActionReplayTest, generateReplayHarness } from "../../codegen/replay-test.js";
import { loadAndApplyOverlay } from "../../overlay.js";

export interface CheckCommandOptions {
  modelPath: string;
  propsPath?: string;
  reportPath?: string;
  overlayPath?: string;
  tracesDir?: string;
  replayTestsDir?: string;
  actionReplayTestsDir?: string;
  statesPath?: string;
  now?: Date;
}

export interface CheckCommandResult {
  check: CheckResult;
  report: CheckReport;
  exitCode: number;
  lines: string[];
}

export async function runCheckCommand(options: CheckCommandOptions): Promise<CheckCommandResult> {
  const loadedModel = parseModelArtifact(await readFile(options.modelPath, "utf8"));
  const overlay = await loadAndApplyOverlay(loadedModel, options.overlayPath);
  if (overlay.errors.length > 0) {
    throw new Error(`Overlay merge failed: ${overlay.errors.join("; ")}`);
  }
  const model = overlay.model;
  const properties = await loadProperties(model, options.propsPath);
  const check = checkModel(model, properties);
  const report = createCheckReport(model, check, options.now ?? new Date(), overlay.warnings, overlay.ignoredVars);
  if (options.reportPath) {
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, `${canonicalJson(report)}\n`, "utf8");
  }
  const tracePaths = options.tracesDir ? await writeTraceArtifacts(check, options.tracesDir) : [];
  const replayTestPaths = options.replayTestsDir ? await writeReplayTestArtifacts(check, options.replayTestsDir) : [];
  const actionReplayTestPaths = options.actionReplayTestsDir ? await writeActionReplayTestArtifacts(check, options.actionReplayTestsDir) : [];
  return {
    check,
    report,
    exitCode: check.verdicts.some((verdict) => verdict.status === "violated" || verdict.status === "error") ? 2 : 0,
    lines: [...renderCheckResult(check), ...tracePaths.map((path) => `trace=${path}`), ...replayTestPaths.map((path) => `replayTest=${path}`), ...actionReplayTestPaths.map((path) => `actionReplayTest=${path}`)]
  };
}

export function createCheckReport(model: Model, check: CheckResult, now: Date, overlayWarnings: readonly string[] = [], ignoredVars: readonly string[] = []): CheckReport {
  return {
    schemaVersion: 1,
    kind: "check-report",
    modelId: model.id,
    generatedAt: now.toISOString(),
    verdicts: check.verdicts.map(reportVerdict),
    stats: check.stats,
    vacuityWarnings: [...check.vacuityWarnings, ...overlayWarnings].sort(),
    trustLedger: {
      bounds: model.bounds,
      plugins: model.metadata?.plugins ?? [],
      assumptions: sourceHashAssumptions(model),
      abstractions: model.vars
        .filter((decl) => decl.domain.kind === "tokens" || decl.domain.kind === "lengthCat")
        .map((decl) => `${decl.id}:${decl.domain.kind}`),
      globalTaints: model.metadata?.extractionCaveats?.globalTaints ?? [],
      staleReads: model.metadata?.extractionCaveats?.staleReads ?? [],
      unhandledRejections: model.metadata?.extractionCaveats?.unhandledRejections ?? [],
      unextractableHandlers: model.metadata?.extractionCaveats?.unextractableHandlers ?? [],
      domains: model.vars.map((decl) => domainReportEntry(model, decl)).sort((left, right) => left.varId.localeCompare(right.varId)),
      manualTransitions: model.transitions.filter((transition) => transition.confidence === "manual").map((transition) => transition.id),
      overApproxTransitions: model.transitions.filter((transition) => transition.confidence === "over-approx").map((transition) => transition.id),
      boundHits: check.boundHits,
      ignoredVars
    }
  };
}

function domainReportEntry(model: Model, decl: StateVarDecl): DomainReportEntry {
  return {
    varId: decl.id,
    domainKind: decl.domain.kind,
    provenance: model.metadata?.domainProvenance?.[decl.id] ?? (decl.origin === "system" ? "system" : decl.origin === "library-template" ? "template" : decl.domain.kind === "tokens" ? "default-token" : "type-derived")
  };
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
      lines.push(`  trace steps: ${verdict.trace.steps.map((step) => step.transitionId).join(" -> ") || "(initial)"}`);
    }
    if (verdict.status === "error" || verdict.status === "vacuous-warning") {
      lines.push(`  ${verdict.message}`);
    }
  }
  lines.push(`states=${check.stats.states} edges=${check.stats.edges} depth=${check.stats.depth}`);
  return lines;
}

async function loadProperties(model: Model, propsPath: string | undefined): Promise<Property[]> {
  if (!propsPath) return [];
  const modulePath = await importableCopy(propsPath);
  const module = (await import(/* @vite-ignore */ pathToFileURL(modulePath).href)) as {
    properties?: Property[] | ((model: Model) => Property[]);
    propertiesFor?: (model: Model) => Property[];
  };
  if (typeof module.propertiesFor === "function") return module.propertiesFor(model);
  if (typeof module.properties === "function") return module.properties(model);
  return module.properties ?? [];
}

async function importableCopy(path: string): Promise<string> {
  if (!process.env.VITEST) return path;
  const extension = extname(path) || ".mjs";
  const cacheDir = join(process.cwd(), ".modality", "import-cache");
  await mkdir(cacheDir, { recursive: true });
  const copyPath = join(cacheDir, `${Buffer.from(path).toString("hex")}.${process.pid}.${Date.now()}${extension}`);
  await copyFile(path, copyPath);
  return copyPath;
}

function reportVerdict(verdict: PropertyVerdict): CheckReport["verdicts"][number] {
  if (verdict.status === "violated" || verdict.status === "reachable") {
    return {
      property: verdict.property,
      status: verdict.status,
      trace: verdict.trace,
      ...(verdict.replayable === false ? { replayable: false, replayBlockedReason: verdict.replayBlockedReason } : {})
    };
  }
  if (verdict.status === "error" || verdict.status === "vacuous-warning") {
    return { property: verdict.property, status: verdict.status, message: verdict.message };
  }
  return { property: verdict.property, status: verdict.status };
}

async function writeTraceArtifacts(check: CheckResult, tracesDir: string): Promise<string[]> {
  await mkdir(tracesDir, { recursive: true });
  const paths: string[] = [];
  for (const verdict of check.verdicts) {
    if (verdict.status !== "violated" && verdict.status !== "reachable") continue;
    const path = join(tracesDir, `${safeFileName(verdict.property)}.${verdict.status}.trace.json`);
    await writeFile(path, `${canonicalJson(traceArtifact(verdict.trace))}\n`, "utf8");
    paths.push(path);
  }
  return paths;
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function writeReplayTestArtifacts(check: CheckResult, replayTestsDir: string): Promise<string[]> {
  await mkdir(replayTestsDir, { recursive: true });
  const paths: string[] = [];
  for (const verdict of check.verdicts) {
    if (verdict.status !== "violated") continue;
    if (verdict.replayable === false) continue;
    const artifact = generateAbstractReplayTest(verdict.property, verdict.trace);
    const path = join(replayTestsDir, artifact.fileName);
    await writeFile(path, artifact.source, "utf8");
    paths.push(path);
  }
  return paths;
}

async function writeActionReplayTestArtifacts(check: CheckResult, replayTestsDir: string): Promise<string[]> {
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
      wroteHarness = true;
    }
    const artifact = generateActionReplayTest(verdict.property, verdict.trace);
    const path = join(replayTestsDir, artifact.fileName);
    await writeFile(path, artifact.source, "utf8");
    paths.push(path);
  }
  return paths;
}
