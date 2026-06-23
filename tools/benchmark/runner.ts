import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { canonicalJson, type Model } from "modality-ts/core";
import {
  classifyPropertyVerdicts,
  libraryEvidenceFromExtraction,
} from "./classify.js";
import {
  type BenchmarkDefinition,
  type BenchmarkManifest,
  readBenchmarkManifest,
  selectBenchmarks,
  validateBenchmarkPaths,
} from "./manifest.js";
import {
  type BenchmarkFrameworkReport,
  type BenchmarkRunReport,
  buildBenchmarkRunReport,
} from "./report.js";
import { extractCheckReplayOnce, readPackageDependencies } from "./run-once.js";

export interface BenchmarkRunnerOptions {
  repoRoot: string;
  manifestPath: string;
  benchmarkId?: string;
  reportPath?: string;
  now?: Date;
}

export interface BenchmarkRunnerResult {
  exitCode: number;
  report: BenchmarkRunReport;
  reportPath: string;
  lines: string[];
}

const REQUIRED_LIBRARIES = [
  "jotai",
  "zustand",
  "swr",
  "zod",
  "arktype",
] as const;

export async function runBenchmarkSuite(
  options: BenchmarkRunnerOptions,
): Promise<BenchmarkRunnerResult> {
  const now = options.now ?? new Date();
  const lines: string[] = [];

  let manifest: BenchmarkManifest;
  try {
    manifest = await readBenchmarkManifest(options.manifestPath);
    await validateBenchmarkPaths(options.repoRoot, manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return invalidManifestResult(message, options, now, lines);
  }

  let selected: BenchmarkDefinition[];
  try {
    selected = selectBenchmarks(manifest, options.benchmarkId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return invalidManifestResult(message, options, now, lines);
  }

  const artifactRoot = await mkdtemp(join(tmpdir(), "modality-benchmark-"));
  const reportPath =
    options.reportPath ?? join(artifactRoot, "benchmark-run-report.json");
  const frameworkReports: BenchmarkFrameworkReport[] = [];

  try {
    for (const benchmark of selected) {
      const frameworkReport = await runSingleBenchmark({
        repoRoot: options.repoRoot,
        benchmark,
        artifactRoot,
      });
      frameworkReports.push(frameworkReport);
      for (const message of frameworkReport.messages) {
        lines.push(`benchmark ${benchmark.id}: ${message}`);
      }
      lines.push(
        `benchmark ${benchmark.id}: ${frameworkReport.status} routes=${frameworkReport.routeCount} vars=${frameworkReport.varCount} transitions=${frameworkReport.transitionCount}`,
      );
    }

    const report = buildBenchmarkRunReport({
      manifestId: manifest.manifestId,
      generatedAt: now.toISOString(),
      reportPath,
      frameworks: frameworkReports,
    });
    await mkdir(dirname(reportPath), { recursive: true });
    await writeReport(reportPath, report);

    const exitCode = frameworkReports.every((entry) => entry.status === "pass")
      ? 0
      : 2;
    return { exitCode, report, reportPath, lines };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`runner failure: ${message}`);
    const report = buildBenchmarkRunReport({
      manifestId: manifest.manifestId,
      generatedAt: now.toISOString(),
      reportPath,
      frameworks: frameworkReports,
    });
    await mkdir(dirname(reportPath), { recursive: true });
    await writeReport(reportPath, report);
    return { exitCode: 4, report, reportPath, lines };
  }
}

async function runSingleBenchmark(input: {
  repoRoot: string;
  benchmark: BenchmarkDefinition;
  artifactRoot: string;
}): Promise<BenchmarkFrameworkReport> {
  const messages: string[] = [];
  const benchmarkRoot = resolve(input.repoRoot, input.benchmark.root);
  const artifactDir = join(input.artifactRoot, input.benchmark.id);
  await mkdir(artifactDir, { recursive: true });

  const packageJsonPath = join(benchmarkRoot, input.benchmark.packageJsonPath);
  const dependencies = await readPackageDependencies(packageJsonPath);
  const run = await extractCheckReplayOnce({
    appRoot: benchmarkRoot,
    sourcePaths: input.benchmark.sourcePaths,
    propsPaths: input.benchmark.propsPaths,
    effectApis: input.benchmark.effectApis,
    searchLimits: input.benchmark.searchLimits,
    workDir: artifactDir,
    packageJsonPath,
    configPath: join(benchmarkRoot, "modality.config.ts"),
  });

  const libraryCoverage = libraryEvidenceFromExtraction(
    run.extractReport,
    dependencies,
  );
  for (const library of REQUIRED_LIBRARIES) {
    if (!libraryCoverage[library]) {
      messages.push(`missing library evidence for ${library}`);
    }
  }

  const modelSlackPropertyIds = modelSlackProperties(
    run.extractReport,
    run.checkReport,
  );
  const classified = classifyPropertyVerdicts({
    checkReport: run.checkReport,
    replayByProperty: new Map(
      [...run.replayVerdicts].map(([property, replay]) => [
        property,
        replay.status === "reproduced" ? "reproduced" : "not-reproduced",
      ]),
    ),
    modelSlackPropertyIds,
  });

  for (const failure of classified.summary.failures) {
    messages.push(failure);
  }

  const expected = input.benchmark.expected;
  if (
    classified.summary.truePositiveViolations !==
    expected.truePositiveViolations
  ) {
    messages.push(
      `TP count ${classified.summary.truePositiveViolations} != expected ${expected.truePositiveViolations}`,
    );
  }
  if (
    classified.summary.trueNegativeVerified !== expected.trueNegativeVerified
  ) {
    messages.push(
      `TN count ${classified.summary.trueNegativeVerified} != expected ${expected.trueNegativeVerified}`,
    );
  }
  if (classified.summary.falsePositiveProbes !== expected.falsePositiveProbes) {
    messages.push(
      `FP count ${classified.summary.falsePositiveProbes} != expected ${expected.falsePositiveProbes}`,
    );
  }
  if (classified.summary.falseNegativeProbes !== expected.falseNegativeProbes) {
    messages.push(
      `FN count ${classified.summary.falseNegativeProbes} != expected ${expected.falseNegativeProbes}`,
    );
  }

  const routeCount = countRoutesFromModel(run.model);
  const status =
    messages.length === 0 &&
    Object.values(libraryCoverage).every(Boolean) &&
    classified.summary.failures.length === 0
      ? "pass"
      : "fail";

  return {
    benchmarkId: input.benchmark.id,
    framework: input.benchmark.framework,
    status,
    routeCount,
    varCount: run.model.vars.length,
    transitionCount: run.model.transitions.length,
    libraryCoverage,
    propertyVerdicts: classified.verdicts,
    classification: classified.summary,
    artifactPaths: {
      model: run.artifactPaths.model,
      extractReport: run.artifactPaths.extractReport,
      checkReport: run.artifactPaths.checkReport,
      tracesDir: run.artifactPaths.tracesDir,
    },
    messages,
  };
}

function countRoutesFromModel(model: Model): number {
  const routeVar = model.vars.find((entry) => entry.id === "sys:route");
  if (routeVar?.domain.kind === "enum") {
    return routeVar.domain.values.length;
  }
  return 0;
}

function modelSlackProperties(
  extractionReport: { modelSlack?: readonly { id?: string }[] },
  checkReport: CheckReport,
): Set<string> {
  const slackIds = new Set(
    (extractionReport.modelSlack ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === "string"),
  );
  const properties = new Set<string>();
  for (const verdict of checkReport.verdicts) {
    if (verdict.confidence?.level === "over-approx") {
      properties.add(verdict.property);
    }
    if (
      verdict.confidence?.caveatIds?.some((id) => slackIds.has(id)) ||
      verdict.confidence?.reasons?.some((reason) =>
        reason.toLowerCase().includes("slack"),
      )
    ) {
      properties.add(verdict.property);
    }
  }
  return properties;
}

async function writeReport(
  reportPath: string,
  report: BenchmarkRunReport,
): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(reportPath, `${canonicalJson(report)}\n`, "utf8");
}

async function invalidManifestResult(
  message: string,
  options: BenchmarkRunnerOptions,
  now: Date,
  lines: string[],
): Promise<BenchmarkRunnerResult> {
  lines.push(`manifest invalid: ${message}`);
  const artifactRoot = await mkdtemp(
    join(tmpdir(), "modality-benchmark-invalid-"),
  );
  const reportPath =
    options.reportPath ?? join(artifactRoot, "benchmark-run-report.json");
  const report = buildBenchmarkRunReport({
    manifestId: "invalid",
    generatedAt: now.toISOString(),
    reportPath,
    frameworks: [],
  });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeReport(reportPath, report);
  return { exitCode: 3, report, reportPath, lines };
}
