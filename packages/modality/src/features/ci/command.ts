import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCheckReportArtifact, parseModelArtifact, type CheckReport } from "modality-ts/kernel";
import { runCheckCommand } from "../../check.js";
import { runConformCommand } from "../../conform.js";

export interface CiCommandOptions {
  modelPath: string;
  propsPath?: string;
  artifactDir: string;
  overlayPath?: string;
  baselinePath?: string;
  sourcePath?: string;
  conformWalksPath?: string;
  conformCount?: number;
  conformDepth?: number;
  conformSeed?: number;
  minConformPassRate?: number;
  minTransitionConformPassRate?: number;
  now?: Date;
}

export interface CiCommandResult {
  exitCode: number;
  lines: string[];
  reportPath: string;
  tracesDir: string;
}

export async function runCiCommand(options: CiCommandOptions): Promise<CiCommandResult> {
  await mkdir(options.artifactDir, { recursive: true });
  const reportPath = join(options.artifactDir, "report.json");
  const tracesDir = join(options.artifactDir, "traces");
  const now = options.now ?? new Date();
  const check = await runCheckCommand({
    modelPath: options.modelPath,
    propsPath: options.propsPath,
    overlayPath: options.overlayPath,
    reportPath,
    tracesDir,
    now
  });
  const determinism = await checkDeterminism(options, now, reportPath, tracesDir);
  const violationCount = check.check.verdicts.filter((verdict) => verdict.status === "violated").length;
  const errorCount = check.check.verdicts.filter((verdict) => verdict.status === "error").length;
  const trustRegressions = options.baselinePath ? await compareTrustLedger(options.baselinePath, check.report) : [];
  const staleSource = options.sourcePath ? await checkSourceFreshness(options.modelPath, options.sourcePath) : [];
  const conform = await runOptionalConformance(options, now);
  const conformPassRate = conform?.report.metrics.passRate;
  const minConformPassRate = options.minConformPassRate ?? 1;
  const conformFailed = conformPassRate !== undefined && conformPassRate < minConformPassRate;
  const minTransitionConformPassRate = options.minTransitionConformPassRate ?? minConformPassRate;
  const transitionConformFailures = conform ? transitionConformFailuresBelow(conform.report.transitionMetrics, minTransitionConformPassRate) : [];
  const transitionConformFailed = transitionConformFailures.length > 0;
  const exitCode = violationCount > 0 || errorCount > 0 ? 2 : trustRegressions.length > 0 ? 3 : determinism.length > 0 ? 4 : conformFailed || transitionConformFailed ? 5 : staleSource.length > 0 ? 6 : 0;
  return {
    exitCode,
    reportPath,
    tracesDir,
    lines: [
      `ci: ${exitCode === 0 ? "passed" : "failed"}`,
      `violations=${violationCount} errors=${errorCount}`,
      `determinism=${determinism.length === 0 ? "passed" : "failed"}`,
      ...determinism.map((failure) => `determinism-failure: ${failure}`),
      ...(options.baselinePath ? [`trust-regressions=${trustRegressions.length}`, ...trustRegressions.map((regression) => `trust-regression: ${regression}`)] : []),
      ...(options.sourcePath ? [`source-freshness=${staleSource.length === 0 ? "passed" : "failed"}`, ...staleSource.map((failure) => `source-stale: ${failure}`)] : []),
      ...(conform ? [
        `conform-pass-rate=${conform.report.metrics.passRate}`,
        `conform-min-pass-rate=${minConformPassRate}`,
        `conform-transition-min-pass-rate=${minTransitionConformPassRate}`,
        ...transitionConformFailures.map((failure) => `conform-transition-failure: ${failure}`),
        ...conform.lines
      ] : []),
      `report=${reportPath}`,
      `traces=${tracesDir}`
    ]
  };
}

function transitionConformFailuresBelow(
  transitionMetrics: readonly { transitionId: string; passRate: number; walks: number }[],
  minimum: number
): string[] {
  return transitionMetrics
    .filter((metric) => metric.passRate < minimum)
    .sort((left, right) => left.transitionId.localeCompare(right.transitionId))
    .map((metric) => `${metric.transitionId} passRate=${metric.passRate} walks=${metric.walks}`);
}

async function checkSourceFreshness(modelPath: string, sourcePath: string): Promise<string[]> {
  const model = parseModelArtifact(await readFile(modelPath, "utf8"));
  const expected = model.metadata?.sourceHashes?.[sourcePath];
  if (!expected) return [`missing source hash for ${sourcePath}`];
  const actual = sha256(await readFile(sourcePath, "utf8"));
  return actual === expected ? [] : [`${sourcePath} expected=${expected} actual=${actual}`];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function runOptionalConformance(options: CiCommandOptions, now: Date) {
  if (!options.conformWalksPath && options.conformCount === undefined) return undefined;
  return runConformCommand({
    walksPath: options.conformWalksPath,
    modelPath: options.conformWalksPath ? undefined : options.modelPath,
    walkCount: options.conformCount,
    depth: options.conformDepth,
    seed: options.conformSeed,
    now
  });
}

async function checkDeterminism(options: CiCommandOptions, now: Date, reportPath: string, tracesDir: string): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), "modality-ci-determinism-"));
  try {
    const secondReportPath = join(dir, "report.json");
    const secondTracesDir = join(dir, "traces");
    await runCheckCommand({
      modelPath: options.modelPath,
      propsPath: options.propsPath,
      overlayPath: options.overlayPath,
      reportPath: secondReportPath,
      tracesDir: secondTracesDir,
      now
    });
    return [
      ...(await sameFile(reportPath, secondReportPath) ? [] : ["report.json differed between runs"]),
      ...(await compareTraceDirs(tracesDir, secondTracesDir))
    ];
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function sameFile(leftPath: string, rightPath: string): Promise<boolean> {
  const [left, right] = await Promise.all([readFile(leftPath, "utf8"), readFile(rightPath, "utf8")]);
  return left === right;
}

async function compareTraceDirs(leftDir: string, rightDir: string): Promise<string[]> {
  const [leftNames, rightNames] = await Promise.all([sortedDirEntries(leftDir), sortedDirEntries(rightDir)]);
  const failures: string[] = [];
  if (leftNames.join("\0") !== rightNames.join("\0")) {
    failures.push(`trace set differed: ${leftNames.join(",")} != ${rightNames.join(",")}`);
    return failures;
  }
  for (const name of leftNames) {
    if (!(await sameFile(join(leftDir, name), join(rightDir, name)))) {
      failures.push(`trace differed: ${name}`);
    }
  }
  return failures;
}

async function sortedDirEntries(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function compareTrustLedger(baselinePath: string, current: CheckReport): Promise<string[]> {
  const baseline = parseCheckReportArtifact(await readFile(baselinePath, "utf8"));
  return [
    ...increases("plugins", pluginKeys(baseline.trustLedger.plugins ?? []), pluginKeys(current.trustLedger.plugins ?? [])),
    ...increases("domains", domainKeys(baseline.trustLedger.domains ?? []), domainKeys(current.trustLedger.domains ?? [])),
    ...increases("manualTransitions", baseline.trustLedger.manualTransitions, current.trustLedger.manualTransitions),
    ...increases("overApproxTransitions", baseline.trustLedger.overApproxTransitions, current.trustLedger.overApproxTransitions),
    ...increases("ignoredVars", baseline.trustLedger.ignoredVars ?? [], current.trustLedger.ignoredVars ?? []),
    ...increases("globalTaints", caveatKeys(baseline.trustLedger.globalTaints), caveatKeys(current.trustLedger.globalTaints)),
    ...increases("staleReads", caveatKeys(baseline.trustLedger.staleReads), caveatKeys(current.trustLedger.staleReads)),
    ...increases("unhandledRejections", caveatKeys(baseline.trustLedger.unhandledRejections), caveatKeys(current.trustLedger.unhandledRejections)),
    ...increases("unextractableHandlers", caveatKeys(baseline.trustLedger.unextractableHandlers), caveatKeys(current.trustLedger.unextractableHandlers)),
    ...increases("boundHits", baseline.trustLedger.boundHits, current.trustLedger.boundHits),
    ...increases("vacuityWarnings", baseline.vacuityWarnings, current.vacuityWarnings)
  ];
}

function caveatKeys(caveats: CheckReport["trustLedger"]["globalTaints"]): string[] {
  return caveats
    .map((caveat) => `${caveat.id}:${caveat.reason}${caveat.source ? `:${caveat.source}` : ""}`)
    .sort();
}

function domainKeys(domains: NonNullable<CheckReport["trustLedger"]["domains"]>): string[] {
  return domains
    .map((domain) => `${domain.varId}:${domain.domainKind}:${domain.provenance}`)
    .sort();
}

function pluginKeys(plugins: NonNullable<CheckReport["trustLedger"]["plugins"]>): string[] {
  return plugins
    .map((plugin) => `${plugin.kind}:${plugin.id}@${plugin.version}[${plugin.packageNames.join(",")}]`)
    .sort();
}

function increases(label: string, baselineValues: readonly string[], currentValues: readonly string[]): string[] {
  const baseline = new Set(baselineValues);
  const added = currentValues.filter((value) => !baseline.has(value)).sort();
  const countIncreased = currentValues.length > baselineValues.length;
  if (added.length === 0 && !countIncreased) return [];
  const detail = added.length > 0 ? ` new=${added.join(",")}` : "";
  return [`${label} ${baselineValues.length}->${currentValues.length}${detail}`];
}
