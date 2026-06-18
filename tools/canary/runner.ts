import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  canonicalJson,
  type CanaryRunReport,
  type CheckReport,
  type ConformReport,
} from "modality-ts/core";
import { runCheckCommand } from "../../src/cli/check.ts";
import { runCiCommand } from "../../src/cli/ci.ts";
import { runConformCommand } from "../../src/cli/conform.ts";
import { runExtractCommand } from "../../src/cli/extract.ts";
import { runReplayCommand } from "../../src/cli/replay.ts";
import { evaluateAcceptedCaveats } from "../shared-gates/caveats.js";
import {
  assertSeededBugExpectations,
  assertStateSpaceBudget,
  assertThresholds,
  type ThresholdAssertionResult,
} from "./assertions.js";
import { classifyCanaryFailure } from "./classify.js";
import {
  readCanaryManifest,
  selectActiveCanaries,
  validateActiveCanaryPaths,
  type CanaryDefinition,
  type CanaryKind,
  type CanaryManifest,
} from "./manifest.js";

export interface CanaryRunnerOptions {
  repoRoot: string;
  manifestPath: string;
  canaryId?: string;
  kind?: CanaryKind;
  reportPath?: string;
  now?: Date;
}

export interface CanaryRunnerResult {
  exitCode: number;
  report: CanaryRunReport;
  reportPath: string;
  selectedCanaryCount: number;
  lines: string[];
}

export async function runCanarySuite(
  options: CanaryRunnerOptions,
): Promise<CanaryRunnerResult> {
  const now = options.now ?? new Date();
  let manifest: CanaryManifest;
  try {
    manifest = await readCanaryManifest(options.manifestPath);
    await validateActiveCanaryPaths(options.repoRoot, manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return invalidManifestResult(message, options, now);
  }

  let selected: CanaryDefinition[];
  try {
    selected = selectActiveCanaries(manifest, {
      canaryId: options.canaryId,
      kind: options.kind,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return invalidManifestResult(message, options, now);
  }

  const artifactRoot = await mkdtemp(join(tmpdir(), "modality-canary-"));
  const reportPath =
    options.reportPath ?? join(artifactRoot, "canary-run-report.json");
  const lines: string[] = [];
  const canaryResults: CanaryRunReport["canaryResults"] = [];
  const classifications: CanaryRunReport["classifications"] = [];

  try {
    for (const canary of selected) {
      const canaryRoot = resolve(options.repoRoot, canary.root);
      const canaryArtifactDir = join(artifactRoot, canary.id);
      await mkdir(canaryArtifactDir, { recursive: true });
      const modelPath = join(canaryArtifactDir, "model.json");
      const extractReportPath = join(canaryArtifactDir, "extract-report.json");
      const checkReportPath = join(canaryArtifactDir, "check-report.json");
      const conformReportPath = join(canaryArtifactDir, "conform-report.json");
      const tracesDir = join(canaryArtifactDir, "traces");
      const replayTestsDir = join(canaryArtifactDir, "replay-tests");
      const ciArtifactDir = join(canaryArtifactDir, ".modality");

      const sourcePaths = (canary.extract.sourcePaths ?? []).map((relativePath) =>
        join(canaryRoot, relativePath),
      );
      const propsPaths = (canary.check?.propsPaths ?? []).map((relativePath) =>
        join(canaryRoot, relativePath),
      );
      const packageJsonPath = canary.extract.packageJsonPath
        ? join(canaryRoot, canary.extract.packageJsonPath)
        : undefined;
      const configPath = canary.extract.configPath
        ? join(canaryRoot, canary.extract.configPath)
        : undefined;

      const extracted = await runExtractCommand({
        ...(sourcePaths.length === 1
          ? { sourcePath: sourcePaths[0] }
          : { sourcePaths }),
        modelPath,
        reportPath: extractReportPath,
        packageJsonPath,
        configPath,
        effectApis: canary.extract.effectApis,
        disabledPlugins: canary.extract.disabledPlugins,
        now,
      });

      const thresholdResults: ThresholdAssertionResult[] = assertThresholds({
        extractionReport: extracted.report,
        thresholds: coverageThresholds(canary.thresholds),
      });

      let checkReport: CheckReport | undefined;
      if (canary.check) {
        const checked = await runCheckCommand({
          modelPath,
          propsPaths,
          reportPath: checkReportPath,
          tracesDir,
          replayTestsDir,
          searchLimits: resolveSearchLimits(canary),
          now,
        });
        checkReport = checked.report;
      }

      let conformReport: ConformReport | undefined;
      if (canary.conform) {
        const conformed = await runConformCommand({
          modelPath,
          reportPath: conformReportPath,
          walkCount: canary.conform.count ?? 2,
          depth: canary.conform.depth ?? 3,
          seed: canary.conform.seed ?? 1,
          mode: canary.conform.mode,
          harnessPath: canary.conform.harnessPath,
          thresholds: {
            minPassRate:
              canary.conform.minPassRate ?? canary.thresholds.minConformPassRate,
            minTransitionPassRate:
              canary.conform.minTransitionPassRate ??
              canary.thresholds.minTransitionPassRate,
          },
          now,
        });
        conformReport = conformed.report;
        thresholdResults.push(
          ...assertThresholds({
            extractionReport: extracted.report,
            conformReport,
            thresholds: conformThresholds(canary.thresholds),
          }),
        );
      }

      const budgetResults = assertStateSpaceBudget(
        checkReport,
        canary.budgets ?? resolveCheckBudgets(canary),
        extracted.report,
      );

      const caveatOutcome = evaluateAcceptedCaveats({
        extractionReport: extracted.report,
        checkReport,
        acceptedCaveats: canary.acceptedCaveats,
        knownUnsupported: canary.knownUnsupported,
      });

      const reproducedReplayCount = checkReport
        ? await countReproducedReplays(tracesDir, now)
        : 0;
      const overlayLines = await countOverlayLines(canaryRoot);

      let ciExitCode: number | undefined;
      let ciLines: string[] | undefined;
      if (canary.expectations?.expectedCiExitCode !== undefined && sourcePaths[0]) {
        const ci = await runCiCommand({
          modelPath,
          propsPath: propsPaths[0],
          artifactDir: ciArtifactDir,
          sourcePath: sourcePaths[0],
          now,
        });
        ciExitCode = ci.exitCode;
        ciLines = ci.lines;
      }

      const expectationFailures = assertSeededBugExpectations({
        checkReport,
        reproducedReplayCount,
        overlayLines,
        ciExitCode,
        ciLines,
        expectations: canary.expectations,
      });

      const failedThresholds = thresholdResults.filter(
        (entry) => entry.status === "fail",
      );
      const failedBudgets = budgetResults.filter((entry) => entry.status === "fail");
      const coveragePassed = !failedThresholds.some(
        (entry) => entry.id === "minCoverageExactOrOverlay",
      );
      const status =
        expectationFailures.length > 0 ||
        failedThresholds.length > 0 ||
        failedBudgets.length > 0 ||
        caveatOutcome.status === "fail"
          ? "fail"
          : "pass";

      canaryResults.push({
        canaryId: canary.id,
        status,
        thresholds: thresholdResults,
        budgets: budgetResults,
        acceptedCaveats: caveatOutcome.acceptedCaveats,
        unacceptedCaveats: caveatOutcome.unacceptedCaveats,
        reportPaths: {
          extract: extractReportPath,
          ...(checkReport ? { check: checkReportPath } : {}),
          ...(conformReport ? { conform: conformReportPath } : {}),
        },
      });

      if (status !== "pass") {
        classifications.push(
          ...classifyCanaryFailure({
            canaryId: canary.id,
            status,
            extractionReport: extracted.report,
            conformReport,
            checkReport,
            thresholdResults,
            budgetResults,
            caveatOutcome,
            knownUnsupported: canary.knownUnsupported,
            fixtureCoveragePassed: coveragePassed,
          }),
        );
      }

      if (status === "pass") {
        lines.push(`canary ${canary.id}: pass`);
      } else {
        for (const failure of expectationFailures) {
          lines.push(`canary ${canary.id}: ${failure.message}`);
        }
        for (const failure of failedThresholds) {
          if (failure.message) {
            lines.push(`canary ${canary.id}: ${failure.message}`);
          }
        }
        for (const failure of failedBudgets) {
          if (failure.message) {
            lines.push(`canary ${canary.id}: ${failure.message}`);
          }
        }
        for (const caveat of caveatOutcome.unacceptedCaveats) {
          lines.push(`canary ${canary.id}: unaccepted caveat ${caveat}`);
        }
        for (const caveat of caveatOutcome.missingRequiredCaveats) {
          lines.push(`canary ${canary.id}: missing required caveat ${caveat}`);
        }
      }
    }

    const exitCode = canaryResults.every((entry) => entry.status === "pass") ? 0 : 2;
    return finalize({
      exitCode,
      reportPath,
      lines,
      manifest,
      now,
      canaryResults,
      classifications,
      selectedCanaryCount: selected.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`runner failure: ${message}`);
    return finalize({
      exitCode: 4,
      reportPath,
      lines,
      manifest,
      now,
      canaryResults,
      classifications,
      selectedCanaryCount: selected.length,
    });
  }
}

function coverageThresholds(
  thresholds: CanaryDefinition["thresholds"],
): CanaryDefinition["thresholds"] {
  return {
    minCoverageExactOrOverlay: thresholds.minCoverageExactOrOverlay,
    maxUnextractable: thresholds.maxUnextractable,
    maxGlobalTaints: thresholds.maxGlobalTaints,
    maxUnhandledRejections: thresholds.maxUnhandledRejections,
    maxStaleReads: thresholds.maxStaleReads,
    minRouteCoverage: thresholds.minRouteCoverage,
  };
}

function conformThresholds(
  thresholds: CanaryDefinition["thresholds"],
): CanaryDefinition["thresholds"] {
  return {
    minConformPassRate: thresholds.minConformPassRate,
    minTransitionPassRate: thresholds.minTransitionPassRate,
  };
}

function resolveSearchLimits(canary: CanaryDefinition) {
  if (
    canary.check?.maxStates === undefined &&
    canary.check?.maxEdges === undefined &&
    canary.check?.maxFrontier === undefined &&
    canary.check?.memoryGuardMb === undefined
  ) {
    return undefined;
  }
  return {
    ...(canary.check?.maxStates !== undefined
      ? { maxStates: canary.check.maxStates }
      : {}),
    ...(canary.check?.maxEdges !== undefined
      ? { maxEdges: canary.check.maxEdges }
      : {}),
    ...(canary.check?.maxFrontier !== undefined
      ? { maxFrontier: canary.check.maxFrontier }
      : {}),
    ...(canary.check?.memoryGuardMb !== undefined
      ? { memoryGuardBytes: canary.check.memoryGuardMb * 1024 * 1024 }
      : {}),
  };
}

function resolveCheckBudgets(canary: CanaryDefinition) {
  if (!canary.check) return undefined;
  const budgets = {
    ...(canary.check.maxStates !== undefined
      ? { maxStates: canary.check.maxStates }
      : {}),
    ...(canary.check.maxEdges !== undefined
      ? { maxEdges: canary.check.maxEdges }
      : {}),
    ...(canary.check.maxFrontier !== undefined
      ? { maxFrontier: canary.check.maxFrontier }
      : {}),
  };
  return Object.keys(budgets).length > 0 ? budgets : undefined;
}

async function countReproducedReplays(
  tracesDir: string,
  now: Date,
): Promise<number> {
  let traceNames: string[] = [];
  try {
    traceNames = (await readdir(tracesDir))
      .filter((name) => name.endsWith(".violated.trace.json"))
      .sort();
  } catch {
    return 0;
  }
  let reproduced = 0;
  for (const traceName of traceNames) {
    const replay = await runReplayCommand({
      tracePath: join(tracesDir, traceName),
      now,
    });
    if (replay.report.verdict.status === "reproduced") {
      reproduced += 1;
    }
  }
  return reproduced;
}

async function countOverlayLines(root: string): Promise<number> {
  const names = await readdir(root, { recursive: true });
  let lines = 0;
  for (const name of names) {
    const relative = String(name);
    if (!isOverlayFile(relative)) continue;
    const text = await readFile(join(root, relative), "utf8");
    lines += text
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length;
  }
  return lines;
}

function isOverlayFile(path: string): boolean {
  return (
    /(^|\/)(modality\.)?overlay\.(json|mjs|js|ts)$/.test(path) ||
    path.endsWith(".overlay.ts")
  );
}

async function finalize(input: {
  exitCode: number;
  reportPath: string;
  lines: string[];
  manifest: CanaryManifest;
  now: Date;
  canaryResults: CanaryRunReport["canaryResults"];
  classifications: CanaryRunReport["classifications"];
  selectedCanaryCount: number;
}): Promise<CanaryRunnerResult> {
  const report: CanaryRunReport = {
    schemaVersion: 1,
    kind: "canary-run-report",
    generatedAt: input.now.toISOString(),
    manifestId: input.manifest.manifestId,
    canaryResults: input.canaryResults,
    classifications: input.classifications,
    reportPath: input.reportPath,
  };
  await mkdir(dirname(input.reportPath), { recursive: true });
  await writeFile(input.reportPath, `${canonicalJson(report)}\n`, "utf8");
  return {
    exitCode: input.exitCode,
    report,
    reportPath: input.reportPath,
    selectedCanaryCount: input.selectedCanaryCount,
    lines: input.lines,
  };
}

async function invalidManifestResult(
  message: string,
  options: CanaryRunnerOptions,
  now: Date,
): Promise<CanaryRunnerResult> {
  const artifactRoot = await mkdtemp(join(tmpdir(), "modality-canary-invalid-"));
  const reportPath =
    options.reportPath ?? join(artifactRoot, "canary-run-report.json");
  return finalize({
    exitCode: 3,
    reportPath,
    lines: [`manifest invalid: ${message}`],
    manifest: {
      schemaVersion: 1,
      manifestId: "invalid",
      canaries: [],
    },
    now,
    canaryResults: [],
    classifications: [
      ...classifyCanaryFailure({
        canaryId: options.canaryId ?? "invalid",
        status: "error",
        manifestInvalid: true,
        integrationError: message,
      }),
    ],
    selectedCanaryCount: 0,
  });
}
