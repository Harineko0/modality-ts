import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  canonicalJson,
  type CheckReport,
  type ConformanceMatrixReport,
  type ConformReport,
} from "modality-ts/core";
import { runCheckCommand } from "../../src/cli/check.ts";
import { runConformCommand } from "../../src/cli/conform.ts";
import { runExtractCommand } from "../../src/cli/extract.ts";
import {
  assertConformPassRate,
  assertCoverageThreshold,
  assertSemanticExpectations,
  assertStateSpaceBudget,
  assertTransitionPassRates,
  type ThresholdAssertionResult,
} from "./assertions.js";
import {
  loadConformanceFixtureManifests,
  readConformanceMatrixManifest,
  validateConformanceFixturePaths,
  type ConformanceFixtureManifest,
  type ConformanceMatrixManifest,
} from "./manifest.js";

export interface ConformanceRunnerOptions {
  repoRoot: string;
  matrixPath: string;
  featureId?: string;
  targetId?: string;
  fixtureId?: string;
  includePartial?: boolean;
  reportPath?: string;
  now?: Date;
}

export interface ConformanceRunnerResult {
  exitCode: number;
  report: ConformanceMatrixReport;
  reportPath: string;
  selectedFixtureCount: number;
  lines: string[];
}

export async function runConformanceMatrix(
  options: ConformanceRunnerOptions,
): Promise<ConformanceRunnerResult> {
  const now = options.now ?? new Date();
  const matrix = await readConformanceMatrixManifest(options.matrixPath);
  const fixtureManifests = await loadConformanceFixtureManifests(
    options.repoRoot,
    matrix,
  );
  const selected = selectFixtures(matrix, fixtureManifests, options);
  const artifactRoot = await mkdtemp(join(tmpdir(), "modality-conformance-"));
  const reportPath =
    options.reportPath ?? join(artifactRoot, "conformance-matrix-report.json");
  const lines: string[] = [];
  const fixtureResults: ConformanceMatrixReport["fixtureResults"] = [];

  try {
    for (const fixture of selected) {
      const fixtureRoot = resolve(options.repoRoot, fixture.root);
      try {
        await validateConformanceFixturePaths(fixtureRoot, fixture);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        fixtureResults.push({
          fixtureId: fixture.id,
          status: "error",
          featureIds: fixture.featureIds,
          targetIds: fixture.targetIds,
        });
        lines.push(`fixture ${fixture.id}: invalid (${message})`);
        return finalize({
          exitCode: 3,
          reportPath,
          lines,
          matrix,
          now,
          fixtureResults,
          selectedFixtureCount: selected.length,
        });
      }

      const fixtureArtifactDir = join(artifactRoot, fixture.id);
      await mkdir(fixtureArtifactDir, { recursive: true });
      const modelPath = join(fixtureArtifactDir, "model.json");
      const extractReportPath = join(fixtureArtifactDir, "extract-report.json");
      const checkReportPath = join(fixtureArtifactDir, "check-report.json");
      const conformReportPath = join(fixtureArtifactDir, "conform-report.json");
      const sourcePaths = fixture.sourcePaths.map((relativePath) =>
        join(fixtureRoot, relativePath),
      );
      const propsPaths = fixture.propsPaths.map((relativePath) =>
        join(fixtureRoot, relativePath),
      );
      const packageJsonPath = fixture.extract?.packageJsonPath
        ? join(fixtureRoot, fixture.extract.packageJsonPath)
        : undefined;
      const configPath = fixture.extract?.configPath
        ? join(fixtureRoot, fixture.extract.configPath)
        : undefined;

      const extracted = await runExtractCommand({
        ...(sourcePaths.length === 1
          ? { sourcePath: sourcePaths[0] }
          : { sourcePaths }),
        modelPath,
        reportPath: extractReportPath,
        packageJsonPath,
        configPath,
        effectApis: fixture.extract?.effectApis,
        route: fixture.extract?.route,
        now,
      });

      const thresholdResults: ThresholdAssertionResult[] = [
        assertCoverageThreshold(
          extracted.report,
          fixture.thresholds?.minCoverageExactOrOverlay,
        ),
      ];
      const semanticFailures = assertSemanticExpectations(
        extracted.model,
        extracted.report,
        fixture.expectations,
      );

      let checkReport: CheckReport | undefined;
      if (fixture.check?.enabled !== false) {
        const checked = await runCheckCommand({
          modelPath,
          propsPaths,
          reportPath: checkReportPath,
          searchLimits: fixture.check?.searchLimits,
          now,
        });
        checkReport = checked.report;
      }

      let conformReport: ConformReport | undefined;
      if (fixture.conform?.enabled !== false) {
        const conformed = await runConformCommand({
          modelPath,
          reportPath: conformReportPath,
          walkCount: fixture.conform?.walkCount ?? 2,
          depth: fixture.conform?.depth ?? 3,
          seed: fixture.conform?.seed ?? 1,
          fixtureId: fixture.id,
          featureIds: fixture.featureIds,
          targetIds: fixture.targetIds,
          thresholds: {
            minPassRate: fixture.thresholds?.minConformPassRate,
            minTransitionPassRate: fixture.thresholds?.minTransitionPassRate,
          },
          now,
        });
        conformReport = conformed.report;
        thresholdResults.push(
          assertConformPassRate(
            conformReport,
            fixture.thresholds?.minConformPassRate,
          ),
          assertTransitionPassRates(
            conformReport,
            fixture.thresholds?.minTransitionPassRate,
          ),
        );
      }

      const budgetResults = assertStateSpaceBudget(checkReport, fixture.budgets);
      const failedThresholds = thresholdResults.filter(
        (entry) => entry.status === "fail",
      );
      const failedBudgets = budgetResults.filter(
        (entry) => entry.status === "fail",
      );
      const status =
        semanticFailures.length > 0 ||
        failedThresholds.length > 0 ||
        failedBudgets.length > 0
          ? "fail"
          : "pass";

      fixtureResults.push({
        fixtureId: fixture.id,
        status,
        featureIds: fixture.featureIds,
        targetIds: fixture.targetIds,
        thresholds: thresholdResults,
        budgets: budgetResults,
        reportPaths: {
          extract: extractReportPath,
          ...(checkReport ? { check: checkReportPath } : {}),
          ...(conformReport ? { conform: conformReportPath } : {}),
        },
      });

      if (status === "pass") {
        lines.push(`fixture ${fixture.id}: pass`);
      } else {
        for (const failure of semanticFailures) {
          lines.push(`fixture ${fixture.id}: ${failure.message}`);
        }
        for (const failure of failedThresholds) {
          if (failure.message) {
            lines.push(`fixture ${fixture.id}: ${failure.message}`);
          }
        }
        for (const failure of failedBudgets) {
          if (failure.message) {
            lines.push(`fixture ${fixture.id}: ${failure.message}`);
          }
        }
      }
    }

    const exitCode = fixtureResults.every((entry) => entry.status === "pass")
      ? 0
      : 2;
    return finalize({
      exitCode,
      reportPath,
      lines,
      matrix,
      now,
      fixtureResults,
      selectedFixtureCount: selected.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines.push(`runner failure: ${message}`);
    return finalize({
      exitCode: 4,
      reportPath,
      lines,
      matrix,
      now,
      fixtureResults,
      selectedFixtureCount: selected.length,
    });
  }
}

export async function listFixtureRootEntries(fixtureRoot: string): Promise<string[]> {
  const entries: string[] = [];
  async function walk(relativeDir: string): Promise<void> {
    const absoluteDir = relativeDir ? join(fixtureRoot, relativeDir) : fixtureRoot;
    for (const name of await readdir(absoluteDir, { withFileTypes: true })) {
      const relativePath = relativeDir ? join(relativeDir, name.name) : name.name;
      if (name.isDirectory()) {
        if (name.name === ".modality") {
          entries.push(relativePath);
        } else {
          await walk(relativePath);
        }
      } else if (name.name.endsWith(".json") && relativePath.includes(".modality")) {
        entries.push(relativePath);
      }
    }
  }
  await walk("");
  return entries.sort();
}

function selectFixtures(
  matrix: ConformanceMatrixManifest,
  fixtures: readonly ConformanceFixtureManifest[],
  options: ConformanceRunnerOptions,
): ConformanceFixtureManifest[] {
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const selectedIds = new Set<string>();

  if (options.fixtureId) {
    if (!fixtureById.has(options.fixtureId)) {
      throw new Error(`unknown fixture id ${options.fixtureId}`);
    }
    selectedIds.add(options.fixtureId);
  } else if (options.featureId || options.targetId) {
    for (const cell of matrix.cells) {
      if (options.featureId && cell.featureId !== options.featureId) continue;
      if (options.targetId && cell.targetId !== options.targetId) continue;
      if (cell.status !== "supported" && !options.includePartial) continue;
      for (const fixtureId of cell.fixtures) selectedIds.add(fixtureId);
    }
    if (selectedIds.size === 0) {
      throw new Error("no fixtures matched the requested matrix selection");
    }
  } else {
    for (const cell of matrix.cells) {
      if (options.featureId && cell.featureId !== options.featureId) continue;
      if (options.targetId && cell.targetId !== options.targetId) continue;
      if (cell.status === "supported") {
        for (const fixtureId of cell.fixtures) selectedIds.add(fixtureId);
      } else if (options.includePartial) {
        for (const fixtureId of cell.fixtures) selectedIds.add(fixtureId);
      }
    }
    if (selectedIds.size === 0) {
      throw new Error("no supported fixtures selected");
    }
  }

  return [...selectedIds].map((fixtureId) => {
    const fixture = fixtureById.get(fixtureId);
    if (!fixture) throw new Error(`matrix references missing fixture ${fixtureId}`);
    return fixture;
  });
}

async function finalize(input: {
  exitCode: number;
  reportPath: string;
  lines: string[];
  matrix: ConformanceMatrixManifest;
  now: Date;
  fixtureResults: ConformanceMatrixReport["fixtureResults"];
  selectedFixtureCount: number;
}): Promise<ConformanceRunnerResult> {
  const report: ConformanceMatrixReport = {
    schemaVersion: 1,
    kind: "conformance-matrix-report",
    generatedAt: input.now.toISOString(),
    matrixId: "repo-matrix",
    fixtureResults: input.fixtureResults,
    reportPath: input.reportPath,
  };
  await mkdir(dirname(input.reportPath), { recursive: true });
  await writeFile(input.reportPath, `${canonicalJson(report)}\n`, "utf8");
  return {
    exitCode: input.exitCode,
    report,
    reportPath: input.reportPath,
    selectedFixtureCount: input.selectedFixtureCount,
    lines: input.lines,
  };
}
