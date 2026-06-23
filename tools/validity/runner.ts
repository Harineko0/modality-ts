import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalJson } from "modality-ts/core";
import {
  type BenchmarkManifest,
  readBenchmarkManifest,
  validateBenchmarkPaths,
} from "../benchmark/manifest.js";
import { validityExperiments } from "./experiments/index.js";
import type {
  ValidityExperiment,
  ValidityExperimentId,
  ValidityReport,
  ValiditySubReport,
} from "./types.js";

export interface ValidityRunnerOptions {
  repoRoot: string;
  manifestPath: string;
  experimentIds?: readonly ValidityExperimentId[];
  reportPath?: string;
  now?: Date;
  gating?: boolean;
  experiments?: Partial<Record<ValidityExperimentId, () => ValidityExperiment>>;
  log?: (message: string) => void;
}

export interface ValidityRunnerResult {
  exitCode: number;
  report: ValidityReport;
  reportPath: string;
  lines: string[];
}

export async function runValiditySuite(
  options: ValidityRunnerOptions,
): Promise<ValidityRunnerResult> {
  const now = options.now ?? new Date();
  const lines: string[] = [];
  const emit = (message: string) => {
    lines.push(message);
    options.log?.(message);
  };
  const workDir = await mkdtemp(join(tmpdir(), "modality-validity-"));
  const reportPath =
    options.reportPath ?? join(workDir, "validity-report.json");

  let manifest: BenchmarkManifest;
  try {
    manifest = await readBenchmarkManifest(options.manifestPath);
    await validateBenchmarkPaths(options.repoRoot, manifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit(`manifest invalid: ${message}`);
    const report: ValidityReport = {
      schemaVersion: 1,
      kind: "validity-report",
      generatedAt: now.toISOString(),
      manifestId: "invalid",
      subReports: [],
      reportPath,
    };
    await writeValidityReport(reportPath, report);
    return { exitCode: 3, report, reportPath, lines };
  }

  const requested = options.experimentIds ?? allExperimentIds();
  const subReports: ValiditySubReport[] = [];
  const registry = { ...validityExperiments, ...options.experiments };
  emit(
    `validity: start manifest=${manifest.manifestId} selected=${requested.length}`,
  );

  for (const experimentId of requested) {
    const createExperiment = registry[experimentId];
    if (!createExperiment) {
      subReports.push(
        errorSubReport(experimentId, "experiment is not registered"),
      );
      emit(`validity ${experimentId}: error experiment is not registered`);
      continue;
    }

    const experiment = createExperiment();
    try {
      emit(`validity ${experimentId}: start`);
      const subReport = await experiment.run({
        repoRoot: options.repoRoot,
        manifest,
        workDir,
        now,
        gating: options.gating,
        log: (message) => emit(`validity ${experimentId}: ${message}`),
      });
      subReports.push(subReport);
      emit(
        `validity ${experimentId}: ${subReport.status} ${subReport.headline}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      subReports.push(errorSubReport(experimentId, message));
      emit(`validity ${experimentId}: error ${message}`);
    }
  }

  const report: ValidityReport = {
    schemaVersion: 1,
    kind: "validity-report",
    generatedAt: now.toISOString(),
    manifestId: manifest.manifestId,
    subReports,
    reportPath,
  };
  await writeValidityReport(reportPath, report);
  return {
    exitCode: subReports.some((entry) => entry.status === "error") ? 4 : 0,
    report,
    reportPath,
    lines,
  };
}

function allExperimentIds(): ValidityExperimentId[] {
  return ["conformance", "mutation", "metamorphic"];
}

function errorSubReport(
  experiment: ValidityExperimentId,
  message: string,
): ValiditySubReport {
  return {
    experiment,
    status: "error",
    headline: message,
    perBenchmark: [],
    messages: [message],
  };
}

async function writeValidityReport(
  reportPath: string,
  report: ValidityReport,
): Promise<void> {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${canonicalJson(report)}\n`, "utf8");
}
