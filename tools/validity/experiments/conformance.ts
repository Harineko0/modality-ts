import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ConformReport } from "modality-ts/core";
import { runConformCommand } from "../../../src/cli/conform.js";
import { runExtractCommand } from "../../../src/cli/extract.js";
import type { BenchmarkDefinition } from "../../benchmark/manifest.js";
import type {
  ValidityBenchmarkSlice,
  ValidityExperiment,
  ValidityRunContext,
  ValiditySubReport,
} from "../types.js";

export interface ConformanceExperimentDeps {
  extract?: typeof runExtractCommand;
  conform?: typeof runConformCommand;
  readReport?: (path: string) => Promise<ConformReport>;
}

export interface ConformanceMetrics {
  total: number;
  reproduced: number;
  notReproduced: number;
  inconclusive: number;
  passRate: number;
  transitionMetrics: ConformReport["transitionMetrics"];
  walkCount: number;
  depth: number;
  seed: number;
}

const defaultConformance = {
  walkCount: 32,
  depth: 12,
  seed: 26062303,
};

export function conformanceExperiment(
  deps: ConformanceExperimentDeps = {},
): ValidityExperiment {
  const extract = deps.extract ?? runExtractCommand;
  const conform = deps.conform ?? runConformCommand;
  const readReport = deps.readReport ?? readConformReport;
  return {
    id: "conformance",
    async run(ctx) {
      const perBenchmark: ValidityBenchmarkSlice[] = [];
      for (const benchmark of ctx.manifest.benchmarks) {
        ctx.log?.(`benchmark ${benchmark.id}: start`);
        const slice = await runBenchmarkConformance(ctx, benchmark, {
          extract,
          conform,
          readReport,
        });
        perBenchmark.push(slice);
        ctx.log?.(
          `benchmark ${benchmark.id}: ${slice.status} ${slice.headline}`,
        );
      }
      return summarizeConformance(ctx, perBenchmark);
    },
  };
}

async function runBenchmarkConformance(
  ctx: ValidityRunContext,
  benchmark: BenchmarkDefinition,
  deps: Required<ConformanceExperimentDeps>,
): Promise<ValidityBenchmarkSlice> {
  const benchmarkRoot = resolve(ctx.repoRoot, benchmark.root);
  const outDir = join(ctx.workDir, "conformance", benchmark.id);
  await mkdir(outDir, { recursive: true });
  const modelPath = join(outDir, "model.json");
  const reportPath = join(outDir, "conform.json");
  const settings = {
    ...defaultConformance,
    ...(benchmark.conformance ?? {}),
  };

  try {
    ctx.log?.(`benchmark ${benchmark.id}: extract start`);
    await deps.extract({
      sourcePaths: benchmark.sourcePaths.map((path) =>
        resolve(benchmarkRoot, path),
      ),
      propsPaths: benchmark.propsPaths.map((path) =>
        resolve(benchmarkRoot, path),
      ),
      packageJsonPath: resolve(benchmarkRoot, benchmark.packageJsonPath),
      configPath: resolve(benchmarkRoot, "modality.config.ts"),
      modelPath,
      reportPath: join(outDir, "extract.json"),
      sliceManifestPath: join(outDir, "slices.json"),
      now: ctx.now,
    });
    ctx.log?.(`benchmark ${benchmark.id}: conform start`);
    await deps.conform({
      modelPath,
      mode: "action",
      harnessPath: resolve(benchmarkRoot, "modality.replay-harness.ts"),
      walkCount: settings.walkCount,
      depth: settings.depth,
      seed: settings.seed,
      reportPath,
      thresholds: ctx.manifest.validityThresholds?.conformance,
      fixtureId: benchmark.id,
      now: ctx.now,
    });
    const report = await deps.readReport(reportPath);
    ctx.log?.(
      `benchmark ${benchmark.id}: conform done reproduced=${report.metrics.reproduced} total=${report.metrics.total} inconclusive=${report.metrics.inconclusive}`,
    );
    return sliceFromConformReport(ctx, benchmark, report, settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      benchmarkId: benchmark.id,
      framework: benchmark.framework,
      status: "fail",
      headline: `blocked: harness/extraction (${message})`,
      metrics: {
        walkCount: settings.walkCount,
        depth: settings.depth,
        seed: settings.seed,
      },
      messages: [
        "blocked: action conformance could not produce walks for this benchmark",
        message,
      ],
    };
  }
}

function sliceFromConformReport(
  ctx: ValidityRunContext,
  benchmark: BenchmarkDefinition,
  report: ConformReport,
  settings: typeof defaultConformance,
): ValidityBenchmarkSlice {
  const minPassRate =
    ctx.manifest.validityThresholds?.conformance?.minPassRate ?? 0;
  const inconclusiveWalks = report.walks.filter(
    (walk) => walk.status === "inconclusive",
  );
  const metrics: ConformanceMetrics = {
    ...report.metrics,
    transitionMetrics: report.transitionMetrics,
    walkCount: settings.walkCount,
    depth: settings.depth,
    seed: settings.seed,
  };
  const messages = [
    `mode=${report.mode ?? "abstract"}`,
    `walkCount=${settings.walkCount} depth=${settings.depth} seed=${settings.seed}`,
    ...(inconclusiveWalks.length > 0
      ? [
          `inconclusive walks: ${inconclusiveWalks
            .map((walk) =>
              walk.reason ? `${walk.id} (${walk.reason})` : walk.id,
            )
            .join(", ")}`,
        ]
      : []),
  ];
  const status =
    report.metrics.inconclusive > 0
      ? "fail"
      : report.metrics.passRate < minPassRate
        ? "fail"
        : "pass";
  const headlinePrefix = report.metrics.inconclusive > 0 ? "warning: " : "";
  return {
    benchmarkId: benchmark.id,
    framework: benchmark.framework,
    status,
    headline: `${headlinePrefix}pass-rate ${formatRate(
      report.metrics.passRate,
    )} (${report.metrics.reproduced}/${report.metrics.total})`,
    metrics,
    messages,
  };
}

function summarizeConformance(
  ctx: ValidityRunContext,
  perBenchmark: readonly ValidityBenchmarkSlice[],
): ValiditySubReport {
  const metrics = perBenchmark
    .map((slice) => slice.metrics)
    .filter(isConformanceMetrics);
  const total = sum(metrics, (entry) => entry.total);
  const reproduced = sum(metrics, (entry) => entry.reproduced);
  const inconclusive = sum(metrics, (entry) => entry.inconclusive);
  const passRate = total === 0 ? 1 : reproduced / total;
  const minPassRate =
    ctx.manifest.validityThresholds?.conformance?.minPassRate ?? 0;
  const worstTransitions = metrics
    .flatMap((entry) => entry.transitionMetrics)
    .filter((entry) => entry.walks > 0)
    .sort(
      (left, right) =>
        left.passRate - right.passRate ||
        right.walks - left.walks ||
        left.transitionId.localeCompare(right.transitionId),
    )
    .slice(0, 5);
  const status =
    perBenchmark.some((slice) => slice.status === "fail") ||
    passRate < minPassRate
      ? "fail"
      : "pass";
  return {
    experiment: "conformance",
    status,
    headline: `action pass-rate ${formatRate(passRate)} (${reproduced}/${total})`,
    perBenchmark: [...perBenchmark],
    messages: [
      `aggregate inconclusive=${inconclusive}`,
      ...(worstTransitions.length > 0
        ? [
            `worst transitions: ${worstTransitions
              .map(
                (entry) =>
                  `${entry.transitionId}=${formatRate(entry.passRate)} (${entry.reproduced}/${entry.walks})`,
              )
              .join(", ")}`,
          ]
        : []),
    ],
  };
}

async function readConformReport(path: string): Promise<ConformReport> {
  return JSON.parse(await readFile(path, "utf8")) as ConformReport;
}

function isConformanceMetrics(value: unknown): value is ConformanceMetrics {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ConformanceMetrics>;
  return (
    typeof candidate.total === "number" &&
    typeof candidate.reproduced === "number" &&
    typeof candidate.inconclusive === "number" &&
    typeof candidate.passRate === "number" &&
    Array.isArray(candidate.transitionMetrics)
  );
}

function sum<T>(items: readonly T[], read: (item: T) => number): number {
  return items.reduce((total, item) => total + read(item), 0);
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
