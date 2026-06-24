import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
    await ensureBenchmarkDependencies(options.repoRoot, manifest, emit);
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
  const hasError = subReports.some((entry) => entry.status === "error");
  const hasFailure = subReports.some((entry) => entry.status === "fail");
  return {
    exitCode: hasError ? 4 : hasFailure ? 2 : 0,
    report,
    reportPath,
    lines,
  };
}

async function ensureBenchmarkDependencies(
  repoRoot: string,
  manifest: BenchmarkManifest,
  emit: (message: string) => void,
): Promise<void> {
  for (const benchmark of manifest.benchmarks) {
    const benchmarkRoot = resolve(repoRoot, benchmark.root);
    const lockfilePath = join(benchmarkRoot, "pnpm-lock.yaml");
    const nodeModulesPath = join(benchmarkRoot, "node_modules");
    if (
      !(await pathExists(lockfilePath)) ||
      (await pathExists(nodeModulesPath))
    ) {
      continue;
    }
    emit(`benchmark ${benchmark.id}: install dependencies`);
    await runPnpmInstall(benchmarkRoot);
  }
}

async function runPnpmInstall(cwd: string): Promise<void> {
  const child = spawn("pnpm", ["install", "--frozen-lockfile"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const exitCode = await new Promise<number>((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolvePromise(code ?? 0));
  });
  if (exitCode !== 0) {
    const message = stderr.join("").trim() || stdout.join("").trim();
    throw new Error(
      message
        ? `benchmark dependency install failed: ${message}`
        : "benchmark dependency install failed",
    );
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
