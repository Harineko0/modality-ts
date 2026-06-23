import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { extractCheckReplayOnce } from "../../benchmark/run-once.js";
import type { BenchmarkDefinition } from "../../benchmark/manifest.js";
import {
  compareModels,
  type ModelComparison,
} from "../../metamorphic/bisimulation.js";
import {
  countMetamorphicCandidates,
  generateMetamorphicVariants,
  type MetamorphicVariantDescriptor,
} from "../../metamorphic/generate.js";
import type {
  ValidityBenchmarkSlice,
  ValidityExperiment,
  ValidityRunContext,
  ValiditySubReport,
} from "../types.js";

export interface MetamorphicExperimentDeps {
  generate?: typeof generateMetamorphicVariants;
  countCandidates?: typeof countMetamorphicCandidates;
  runOnce?: typeof extractCheckReplayOnce;
  compare?: typeof compareModels;
}

export interface MetamorphicMetrics {
  variantsTotal: number;
  stable: number;
  divergent: number;
  inconclusive: number;
  stabilityRate: number;
  sampled: boolean;
  perTransform: Record<
    string,
    {
      generated: number;
      stable: number;
      divergent: number;
      inconclusive: number;
    }
  >;
}

interface VariantResult {
  variant: MetamorphicVariantDescriptor;
  status: "stable" | "divergent" | "inconclusive";
  comparison?: ModelComparison;
  message?: string;
}

const defaultMetamorphic = {
  maxVariants: 8,
  seed: 26062305,
};

export function metamorphicExperiment(
  deps: MetamorphicExperimentDeps = {},
): ValidityExperiment {
  const generate = deps.generate ?? generateMetamorphicVariants;
  const countCandidates = deps.countCandidates ?? countMetamorphicCandidates;
  const runOnce = deps.runOnce ?? extractCheckReplayOnce;
  const compare = deps.compare ?? compareModels;
  return {
    id: "metamorphic",
    async run(ctx) {
      const perBenchmark: ValidityBenchmarkSlice[] = [];
      for (const benchmark of ctx.manifest.benchmarks) {
        perBenchmark.push(
          await runBenchmarkMetamorphic(ctx, benchmark, {
            generate,
            countCandidates,
            runOnce,
            compare,
          }),
        );
      }
      return summarizeMetamorphic(ctx, perBenchmark);
    },
  };
}

async function runBenchmarkMetamorphic(
  ctx: ValidityRunContext,
  benchmark: BenchmarkDefinition,
  deps: Required<MetamorphicExperimentDeps>,
): Promise<ValidityBenchmarkSlice> {
  const benchmarkRoot = resolve(ctx.repoRoot, benchmark.root);
  const outDir = join(ctx.workDir, "metamorphic", benchmark.id);
  const baselineDir = join(outDir, "baseline");
  await mkdir(outDir, { recursive: true });
  const settings = { ...defaultMetamorphic, ...(benchmark.metamorphic ?? {}) };

  let baseline: Awaited<ReturnType<typeof extractCheckReplayOnce>>;
  try {
    baseline = await deps.runOnce({
      appRoot: benchmarkRoot,
      sourcePaths: benchmark.sourcePaths,
      propsPaths: benchmark.propsPaths,
      effectApis: benchmark.effectApis,
      searchLimits: benchmark.searchLimits,
      workDir: baselineDir,
      packageJsonPath: resolve(benchmarkRoot, benchmark.packageJsonPath),
      configPath: resolve(benchmarkRoot, "modality.config.ts"),
      harnessPath: resolve(benchmarkRoot, "modality.replay-harness.ts"),
    });
  } catch (error) {
    return failedSlice(benchmark, `baseline failed: ${errorMessage(error)}`, {
      ...emptyMetrics(),
      inconclusive: 1,
    });
  }

  let variants: MetamorphicVariantDescriptor[] = [];
  let candidateCount = 0;
  try {
    candidateCount = await deps.countCandidates({
      appRoot: benchmarkRoot,
      sourcePaths: benchmark.sourcePaths,
      metamorphic: settings,
    });
    variants = await deps.generate({
      appRoot: benchmarkRoot,
      sourcePaths: benchmark.sourcePaths,
      workDir: join(outDir, "variants"),
      metamorphic: settings,
    });
  } catch (error) {
    return failedSlice(
      benchmark,
      `variant generation failed: ${errorMessage(error)}`,
      { ...emptyMetrics(), inconclusive: 1 },
    );
  }

  const results: VariantResult[] = [];
  for (const variant of variants) {
    results.push(
      await classifyVariant({
        benchmark,
        variant,
        outDir: join(outDir, "runs", variant.variantId),
        baseline,
        deps,
      }),
    );
  }

  const metrics = metamorphicMetrics(
    results,
    variants.length,
    candidateCount > variants.length,
  );
  const minStabilityRate =
    ctx.manifest.validityThresholds?.metamorphic?.minStabilityRate ?? 0;
  const status = metrics.stabilityRate < minStabilityRate ? "fail" : "pass";
  const divergences = results.filter((result) => result.status === "divergent");
  return {
    benchmarkId: benchmark.id,
    framework: benchmark.framework,
    status,
    headline: `stability ${formatRate(metrics.stabilityRate)} (${metrics.stable}/${metrics.stable + metrics.divergent})`,
    metrics,
    messages: [
      `variants=${metrics.variantsTotal} stable=${metrics.stable} divergent=${metrics.divergent} inconclusive=${metrics.inconclusive}`,
      ...(divergences.length > 0
        ? divergences.map((result) => divergenceMessage(result))
        : []),
      ...results
        .filter((result) => result.status === "inconclusive" && result.message)
        .map((result) => `${result.variant.variantId}: ${result.message}`),
    ],
  };
}

async function classifyVariant(input: {
  benchmark: BenchmarkDefinition;
  variant: MetamorphicVariantDescriptor;
  outDir: string;
  baseline: Awaited<ReturnType<typeof extractCheckReplayOnce>>;
  deps: Required<MetamorphicExperimentDeps>;
}): Promise<VariantResult> {
  let run: Awaited<ReturnType<typeof extractCheckReplayOnce>>;
  try {
    run = await input.deps.runOnce({
      appRoot: input.variant.appRoot,
      sourcePaths: input.benchmark.sourcePaths,
      propsPaths: input.benchmark.propsPaths,
      effectApis: input.benchmark.effectApis,
      searchLimits: input.benchmark.searchLimits,
      workDir: input.outDir,
      packageJsonPath: resolve(
        input.variant.appRoot,
        input.benchmark.packageJsonPath,
      ),
      configPath: resolve(input.variant.appRoot, "modality.config.ts"),
      harnessPath: resolve(input.variant.appRoot, "modality.replay-harness.ts"),
    });
  } catch (error) {
    return {
      variant: input.variant,
      status: "inconclusive",
      message: `extract/check failed: ${errorMessage(error)}`,
    };
  }

  const comparison = input.deps.compare({
    baseline: input.baseline.model,
    variant: run.model,
    baselineReport: input.baseline.checkReport,
    variantReport: run.checkReport,
    searchLimits: input.benchmark.searchLimits,
  });
  if (comparison.boundHit) {
    return {
      variant: input.variant,
      status: "inconclusive",
      comparison,
      message: "reachable-state exploration hit search limits",
    };
  }
  return {
    variant: input.variant,
    status: comparison.bisimilar ? "stable" : "divergent",
    comparison,
  };
}

function metamorphicMetrics(
  results: readonly VariantResult[],
  variantsTotal: number,
  sampled: boolean,
): MetamorphicMetrics {
  const perTransform: MetamorphicMetrics["perTransform"] = {};
  const ensure = (transformId: string) =>
    (perTransform[transformId] ??= {
      generated: 0,
      stable: 0,
      divergent: 0,
      inconclusive: 0,
    });
  for (const result of results) {
    const bucket = ensure(result.variant.transformId);
    bucket.generated += 1;
    bucket[result.status] += 1;
  }
  const stable = results.filter((result) => result.status === "stable").length;
  const divergent = results.filter(
    (result) => result.status === "divergent",
  ).length;
  const inconclusive = results.filter(
    (result) => result.status === "inconclusive",
  ).length;
  return {
    variantsTotal,
    stable,
    divergent,
    inconclusive,
    stabilityRate: stable + divergent === 0 ? 1 : stable / (stable + divergent),
    sampled,
    perTransform,
  };
}

function summarizeMetamorphic(
  ctx: ValidityRunContext,
  perBenchmark: readonly ValidityBenchmarkSlice[],
): ValiditySubReport {
  const metrics = perBenchmark
    .map((slice) => slice.metrics)
    .filter(isMetamorphicMetrics);
  const stable = sum(metrics, (entry) => entry.stable);
  const divergent = sum(metrics, (entry) => entry.divergent);
  const inconclusive = sum(metrics, (entry) => entry.inconclusive);
  const stabilityRate =
    stable + divergent === 0 ? 1 : stable / (stable + divergent);
  const minStabilityRate =
    ctx.manifest.validityThresholds?.metamorphic?.minStabilityRate ?? 0;
  const status =
    perBenchmark.some((slice) => slice.status === "fail") ||
    stabilityRate < minStabilityRate
      ? "fail"
      : "pass";
  const divergentTransforms = divergentTransformIds(metrics);
  return {
    experiment: "metamorphic",
    status,
    headline: `stability ${formatRate(stabilityRate)} (${stable}/${stable + divergent})`,
    perBenchmark: [...perBenchmark],
    messages: [
      `aggregate inconclusive=${inconclusive}`,
      ...(divergentTransforms.length > 0
        ? [`divergent transforms: ${divergentTransforms.join(", ")}`]
        : []),
    ],
  };
}

function divergenceMessage(result: VariantResult): string {
  const comparison = result.comparison;
  const stateDelta = comparison?.stateSetDelta;
  const verdictDelta = comparison?.verdictDelta;
  const details = [
    stateDelta
      ? `stateDelta baselineOnly=${stateDelta.baselineOnly.length} variantOnly=${stateDelta.variantOnly.length}`
      : undefined,
    verdictDelta?.length
      ? `verdictDelta=${verdictDelta
          .map(
            (entry) =>
              `${entry.property}:${entry.baseline ?? "missing"}->${entry.variant ?? "missing"}`,
          )
          .join(", ")}`
      : undefined,
  ].filter(Boolean);
  return `${result.variant.variantId} divergent ${result.variant.transformId} ${result.variant.file} ${result.variant.siteId}${details.length > 0 ? ` (${details.join("; ")})` : ""}\n${result.variant.sourceDiff}`;
}

function divergentTransformIds(
  metrics: readonly MetamorphicMetrics[],
): string[] {
  const ids = new Set<string>();
  for (const metric of metrics) {
    for (const [transformId, bucket] of Object.entries(metric.perTransform)) {
      if (bucket.divergent > 0) ids.add(transformId);
    }
  }
  return [...ids].sort();
}

function failedSlice(
  benchmark: BenchmarkDefinition,
  headline: string,
  metrics: MetamorphicMetrics,
): ValidityBenchmarkSlice {
  return {
    benchmarkId: benchmark.id,
    framework: benchmark.framework,
    status: "fail",
    headline,
    metrics,
    messages: [headline],
  };
}

function emptyMetrics(): MetamorphicMetrics {
  return {
    variantsTotal: 0,
    stable: 0,
    divergent: 0,
    inconclusive: 0,
    stabilityRate: 0,
    sampled: false,
    perTransform: {},
  };
}

function isMetamorphicMetrics(value: unknown): value is MetamorphicMetrics {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MetamorphicMetrics>;
  return (
    typeof candidate.variantsTotal === "number" &&
    typeof candidate.stable === "number" &&
    typeof candidate.divergent === "number" &&
    typeof candidate.inconclusive === "number" &&
    typeof candidate.stabilityRate === "number"
  );
}

function sum<T>(items: readonly T[], read: (item: T) => number): number {
  return items.reduce((total, item) => total + read(item), 0);
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
