import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { canonicalJson, type CheckReport, type Model } from "modality-ts/core";
import type { BenchmarkDefinition } from "../../benchmark/manifest.js";
import { extractCheckReplayOnce } from "../../benchmark/run-once.js";
import {
  countMutationCandidates,
  generateMutants,
  type MutantDescriptor,
} from "../../mutation/generate.js";
import { compareSeededBehaviour } from "../../mutation/oracle.js";
import type {
  ValidityBenchmarkSlice,
  ValidityExperiment,
  ValidityRunContext,
  ValiditySubReport,
} from "../types.js";
import { hasNoDiscriminatingMutants, hasNoMutationSignal } from "../guards.js";

export interface MutationExperimentDeps {
  generate?: typeof generateMutants;
  countCandidates?: typeof countMutationCandidates;
  runOnce?: typeof extractCheckReplayOnce;
  compareBehaviour?: typeof compareSeededBehaviour;
}

export interface MutationMetrics {
  mutantsTotal: number;
  killed: number;
  survived: number;
  preserved: number;
  falsePositives: number;
  error: number;
  detectionRate: number;
  falsePositiveRate: number;
  sampled: boolean;
  perOperator: Record<
    string,
    {
      generated: number;
      killed: number;
      survived: number;
      preserved: number;
      falsePositives: number;
      error: number;
    }
  >;
}

interface MutantResult {
  mutant: MutantDescriptor;
  status: "killed" | "survived" | "preserved" | "false-positive" | "error";
  killedProperties: string[];
  falsePositiveTransitions: string[];
  message?: string;
}

const defaultMutation = {
  maxMutants: 8,
  seed: 26062304,
};

const defaultOracle = {
  walkCount: 16,
  depth: 8,
  seed: 26062304,
};

export function mutationExperiment(
  deps: MutationExperimentDeps = {},
): ValidityExperiment {
  const generate = deps.generate ?? generateMutants;
  const countCandidates = deps.countCandidates ?? countMutationCandidates;
  const runOnce = deps.runOnce ?? extractCheckReplayOnce;
  const compareBehaviour = deps.compareBehaviour ?? compareSeededBehaviour;
  return {
    id: "mutation",
    async run(ctx) {
      const perBenchmark: ValidityBenchmarkSlice[] = [];
      for (const benchmark of ctx.manifest.benchmarks) {
        ctx.log?.(`benchmark ${benchmark.id}: start`);
        const slice = await runBenchmarkMutation(ctx, benchmark, {
          generate,
          countCandidates,
          runOnce,
          compareBehaviour,
        });
        perBenchmark.push(slice);
        ctx.log?.(
          `benchmark ${benchmark.id}: ${slice.status} ${slice.headline}`,
        );
      }
      return summarizeMutation(ctx, perBenchmark);
    },
  };
}

async function runBenchmarkMutation(
  ctx: ValidityRunContext,
  benchmark: BenchmarkDefinition,
  deps: Required<MutationExperimentDeps>,
): Promise<ValidityBenchmarkSlice> {
  const benchmarkRoot = resolve(ctx.repoRoot, benchmark.root);
  const outDir = join(ctx.workDir, "mutation", benchmark.id);
  const baselineDir = join(outDir, "baseline");
  await mkdir(outDir, { recursive: true });
  const harnessPath = resolve(benchmarkRoot, "modality.replay-harness.ts");
  const settings = { ...defaultMutation, ...(benchmark.mutation ?? {}) };

  let baseline: Awaited<ReturnType<typeof extractCheckReplayOnce>>;
  try {
    ctx.log?.(`benchmark ${benchmark.id}: baseline start`);
    baseline = await deps.runOnce({
      appRoot: benchmarkRoot,
      sourcePaths: benchmark.sourcePaths,
      propsPaths: benchmark.propsPaths,
      effectApis: benchmark.effectApis,
      searchLimits: benchmark.searchLimits,
      workDir: baselineDir,
      packageJsonPath: resolve(benchmarkRoot, benchmark.packageJsonPath),
      configPath: resolve(benchmarkRoot, "modality.config.ts"),
      harnessPath,
      log: (message) =>
        ctx.log?.(`benchmark ${benchmark.id}: baseline ${message}`),
    });
  } catch (error) {
    const message = errorMessage(error);
    return failedSlice(benchmark, `baseline failed: ${message}`, {
      mutantsTotal: 0,
      killed: 0,
      survived: 0,
      preserved: 0,
      falsePositives: 0,
      error: 1,
      detectionRate: 0,
      falsePositiveRate: 0,
      sampled: false,
      perOperator: {},
    });
  }

  const baselineReproducedViolations = reproducedViolationProperties(
    baseline.checkReport,
    baseline.replayVerdicts,
  );

  let mutants: MutantDescriptor[] = [];
  let candidateCount = 0;
  const mutationSourcePaths = sourcePathsFromBaseline(
    benchmarkRoot,
    baseline,
    benchmark.sourcePaths,
  );
  try {
    ctx.log?.(`benchmark ${benchmark.id}: mutation candidates start`);
    candidateCount = await deps.countCandidates({
      appRoot: benchmarkRoot,
      sourcePaths: mutationSourcePaths,
      mutation: settings,
    });
    ctx.log?.(
      `benchmark ${benchmark.id}: mutation generate start candidates=${candidateCount} max=${settings.maxMutants}`,
    );
    mutants = await deps.generate({
      appRoot: benchmarkRoot,
      sourcePaths: mutationSourcePaths,
      workDir: join(outDir, "mutants"),
      mutation: settings,
    });
    ctx.log?.(
      `benchmark ${benchmark.id}: mutation generate done mutants=${mutants.length}`,
    );
  } catch (error) {
    return failedSlice(
      benchmark,
      `mutant generation failed: ${errorMessage(error)}`,
      {
        ...emptyMetrics(),
        error: 1,
      },
    );
  }

  if (candidateCount === 0) {
    return failedSlice(benchmark, "no mutation candidates discovered", {
      ...emptyMetrics(),
      sampled: false,
    });
  }

  const results: MutantResult[] = [];
  for (const mutant of mutants) {
    ctx.log?.(`benchmark ${benchmark.id}: mutant ${mutant.mutantId} start`);
    const result = await classifyMutant({
      ctx,
      benchmark,
      mutant,
      outDir: join(outDir, "runs", mutant.mutantId),
      baseline,
      baselineReproducedViolations,
      deps,
    });
    results.push(result);
    ctx.log?.(
      `benchmark ${benchmark.id}: mutant ${mutant.mutantId} ${result.status}`,
    );
  }
  const metrics = mutationMetrics(
    results,
    mutants.length,
    candidateCount > mutants.length,
  );
  const minDetectionRate =
    ctx.manifest.validityThresholds?.mutation?.minDetectionRate ?? 0;
  const noSignal = hasNoMutationSignal(metrics);
  const noDiscriminatingMutants = hasNoDiscriminatingMutants(metrics);
  const status =
    noSignal ||
    noDiscriminatingMutants ||
    metrics.detectionRate < minDetectionRate
      ? "fail"
      : "pass";
  const falsePositiveTransitions = [
    ...new Set(results.flatMap((result) => result.falsePositiveTransitions)),
  ].sort();
  return {
    benchmarkId: benchmark.id,
    framework: benchmark.framework,
    status,
    headline: noSignal
      ? "blocked: no mutants killed or preserved (oracle produced no signal)"
      : noDiscriminatingMutants
        ? "blocked: no discriminating mutants"
        : `detection ${formatRate(metrics.detectionRate)} (${metrics.killed}/${metrics.killed + metrics.survived})`,
    metrics,
    messages: [
      ...(noSignal
        ? [
            "blocked: no mutants killed or preserved (oracle produced no signal)",
          ]
        : []),
      ...(noDiscriminatingMutants
        ? ["blocked: no discriminating mutants"]
        : []),
      `mutants=${metrics.mutantsTotal} killed=${metrics.killed} survived=${metrics.survived} preserved=${metrics.preserved} error=${metrics.error}`,
      `false-positive-rate=${formatRate(metrics.falsePositiveRate)} (${metrics.falsePositives}/${metrics.preserved})`,
      ...(falsePositiveTransitions.length > 0
        ? [`false-positive transitions: ${falsePositiveTransitions.join(", ")}`]
        : []),
      ...(baselineReproducedViolations.length > 0
        ? [
            `baseline reproduced violations ignored for mutant delta: ${baselineReproducedViolations.join(", ")}`,
          ]
        : []),
      ...results
        .filter((result) => result.message)
        .map((result) => `${result.mutant.mutantId}: ${result.message}`),
    ],
  };
}

function sourcePathsFromBaseline(
  appRoot: string,
  baseline: Awaited<ReturnType<typeof extractCheckReplayOnce>>,
  fallback: readonly string[],
): string[] {
  const sourceFiles = baseline.extractReport.sourceFiles ?? [];
  const relativePaths = sourceFiles
    .map((path) => relative(appRoot, path))
    .filter(
      (path) =>
        path &&
        !path.startsWith("..") &&
        !path.includes("node_modules") &&
        /\.(tsx?|jsx?)$/.test(path) &&
        !path.endsWith(".modals.ts") &&
        !path.endsWith(".props.ts"),
    );
  return relativePaths.length > 0
    ? [...new Set(relativePaths)].sort()
    : [...fallback];
}

async function classifyMutant(input: {
  ctx: ValidityRunContext;
  benchmark: BenchmarkDefinition;
  mutant: MutantDescriptor;
  outDir: string;
  baseline: Awaited<ReturnType<typeof extractCheckReplayOnce>>;
  baselineReproducedViolations: readonly string[];
  deps: Required<MutationExperimentDeps>;
}): Promise<MutantResult> {
  const harnessPath = resolve(
    input.mutant.appRoot,
    "modality.replay-harness.ts",
  );
  let run: Awaited<ReturnType<typeof extractCheckReplayOnce>>;
  try {
    run = await input.deps.runOnce({
      appRoot: input.mutant.appRoot,
      sourcePaths: input.benchmark.sourcePaths,
      propsPaths: input.benchmark.propsPaths,
      effectApis: input.benchmark.effectApis,
      searchLimits: input.benchmark.searchLimits,
      workDir: input.outDir,
      packageJsonPath: resolve(
        input.mutant.appRoot,
        input.benchmark.packageJsonPath,
      ),
      configPath: resolve(input.mutant.appRoot, "modality.config.ts"),
      harnessPath,
      log: (message) =>
        input.ctx.log?.(
          `benchmark ${input.benchmark.id}: mutant ${input.mutant.mutantId} ${message}`,
        ),
    });
  } catch (error) {
    return {
      mutant: input.mutant,
      status: "error",
      killedProperties: [],
      falsePositiveTransitions: [],
      message: errorMessage(error),
    };
  }
  const baselineViolationSet = new Set(input.baselineReproducedViolations);
  const reproducedViolations = reproducedViolationProperties(
    run.checkReport,
    run.replayVerdicts,
  ).filter((property) => !baselineViolationSet.has(property));
  const oracleModelPaths = await writeOracleModels({
    outDir: join(input.outDir, "oracle-models"),
    baseline: input.baseline.model,
    baselineRoot: resolve(input.ctx.repoRoot, input.benchmark.root),
    mutant: run.model,
    mutantRoot: input.mutant.appRoot,
  });
  const oracle = await input.deps.compareBehaviour({
    baselineModelPath: oracleModelPaths.baseline,
    baselineHarnessPath: resolve(
      input.ctx.repoRoot,
      input.benchmark.root,
      "modality.replay-harness.ts",
    ),
    mutantModelPath: oracleModelPaths.mutant,
    mutantHarnessPath: harnessPath,
    workDir: join(input.outDir, "oracle"),
    fixtureId: input.benchmark.id,
    settings: {
      ...defaultOracle,
      ...(input.benchmark.mutation?.conformance ??
        input.benchmark.conformance ??
        {}),
    },
    now: input.ctx.now,
  });

  if (oracle.preserved) {
    if (reproducedViolations.length > 0) {
      return {
        mutant: input.mutant,
        status: "false-positive",
        killedProperties: reproducedViolations,
        falsePositiveTransitions: affectedTransitions(
          run.checkReport,
          reproducedViolations,
        ),
        message: `preserved but violated ${reproducedViolations.join(", ")}`,
      };
    }
    return {
      mutant: input.mutant,
      status: "preserved",
      killedProperties: [],
      falsePositiveTransitions: [],
    };
  }

  if (reproducedViolations.length > 0) {
    return {
      mutant: input.mutant,
      status: "killed",
      killedProperties: reproducedViolations,
      falsePositiveTransitions: [],
    };
  }
  return {
    mutant: input.mutant,
    status: "survived",
    killedProperties: [],
    falsePositiveTransitions: [],
  };
}

async function writeOracleModels(input: {
  outDir: string;
  baseline: Model;
  baselineRoot: string;
  mutant: Model;
  mutantRoot: string;
}): Promise<{ baseline: string; mutant: string }> {
  await mkdir(input.outDir, { recursive: true });
  const baselinePath = join(input.outDir, "baseline-model.json");
  const mutantPath = join(input.outDir, "mutant-model.json");
  await writeFile(
    baselinePath,
    `${canonicalJson(normalizeModelRoot(input.baseline, input.baselineRoot))}\n`,
    "utf8",
  );
  await writeFile(
    mutantPath,
    `${canonicalJson(normalizeModelRoot(input.mutant, input.mutantRoot))}\n`,
    "utf8",
  );
  return { baseline: baselinePath, mutant: mutantPath };
}

function normalizeModelRoot(model: unknown, appRoot: string): Model {
  const normalizedRoot = appRoot.replaceAll("\\", "/");
  const normalized = JSON.parse(
    JSON.stringify(model).replaceAll(normalizedRoot, "<app>"),
  ) as Model;
  return sanitizeDanglingVars(normalized);
}

function sanitizeDanglingVars(model: Model): Model {
  const declared = new Set(model.vars.map((decl) => decl.id));
  const sanitize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sanitize);
    if (typeof value !== "object" || value === null) return value;
    const record = value as Record<string, unknown>;
    if (
      record.kind === "read" &&
      typeof record.var === "string" &&
      !declared.has(record.var)
    ) {
      return { kind: "lit", value: false };
    }
    return Object.fromEntries(
      Object.entries(record).map(([key, entry]) => [key, sanitize(entry)]),
    );
  };
  return {
    ...model,
    transitions: model.transitions.map((transition) => ({
      ...transition,
      reads: transition.reads?.filter((varId) => declared.has(varId)),
      writes: transition.writes?.filter((varId) => declared.has(varId)),
      guard: sanitize(transition.guard) as typeof transition.guard,
      effect: sanitize(transition.effect) as typeof transition.effect,
    })),
  };
}

function reproducedViolationProperties(
  checkReport: CheckReport,
  replayVerdicts: Map<string, { status: string }>,
): string[] {
  return checkReport.verdicts
    .filter(
      (verdict) =>
        verdict.status === "violated" &&
        replayVerdicts.get(verdict.property)?.status === "reproduced",
    )
    .map((verdict) => verdict.property)
    .sort();
}

function affectedTransitions(
  checkReport: CheckReport,
  properties: readonly string[],
): string[] {
  const propertySet = new Set(properties);
  return [
    ...new Set(
      checkReport.verdicts
        .filter((verdict) => propertySet.has(verdict.property))
        .flatMap((verdict) => [
          ...(verdict.confidence?.affectedTransitions ?? []),
          ...(verdict.trace?.steps.map((step) => step.transitionId) ?? []),
        ]),
    ),
  ].sort();
}

function mutationMetrics(
  results: readonly MutantResult[],
  mutantsTotal: number,
  sampled: boolean,
): MutationMetrics {
  const perOperator: MutationMetrics["perOperator"] = {};
  const ensure = (operatorId: string) =>
    (perOperator[operatorId] ??= {
      generated: 0,
      killed: 0,
      survived: 0,
      preserved: 0,
      falsePositives: 0,
      error: 0,
    });
  for (const result of results) {
    const bucket = ensure(result.mutant.operatorId);
    bucket.generated += 1;
    if (result.status === "killed") bucket.killed += 1;
    else if (result.status === "survived") bucket.survived += 1;
    else if (result.status === "preserved") bucket.preserved += 1;
    else if (result.status === "false-positive") {
      bucket.preserved += 1;
      bucket.falsePositives += 1;
    } else bucket.error += 1;
  }
  const killed = results.filter((result) => result.status === "killed").length;
  const survived = results.filter(
    (result) => result.status === "survived",
  ).length;
  const preserved = results.filter(
    (result) =>
      result.status === "preserved" || result.status === "false-positive",
  ).length;
  const falsePositives = results.filter(
    (result) => result.status === "false-positive",
  ).length;
  const error = results.filter((result) => result.status === "error").length;
  return {
    mutantsTotal,
    killed,
    survived,
    preserved,
    falsePositives,
    error,
    detectionRate: killed + survived === 0 ? 0 : killed / (killed + survived),
    falsePositiveRate: preserved === 0 ? 0 : falsePositives / preserved,
    sampled,
    perOperator,
  };
}

function summarizeMutation(
  ctx: ValidityRunContext,
  perBenchmark: readonly ValidityBenchmarkSlice[],
): ValiditySubReport {
  const metrics = perBenchmark
    .map((slice) => slice.metrics)
    .filter(isMutationMetrics);
  const killed = sum(metrics, (entry) => entry.killed);
  const survived = sum(metrics, (entry) => entry.survived);
  const preserved = sum(metrics, (entry) => entry.preserved);
  const falsePositives = sum(metrics, (entry) => entry.falsePositives);
  const errors = sum(metrics, (entry) => entry.error);
  const mutantsTotal = sum(metrics, (entry) => entry.mutantsTotal);
  const detectionRate =
    killed + survived === 0 ? 0 : killed / (killed + survived);
  const minDetectionRate =
    ctx.manifest.validityThresholds?.mutation?.minDetectionRate ?? 0;
  const noSignal = hasNoMutationSignal({ mutantsTotal, killed, preserved });
  const noDiscriminatingMutants = hasNoDiscriminatingMutants({
    mutantsTotal,
    killed,
    survived,
  });
  const status =
    perBenchmark.some((slice) => slice.status === "fail") ||
    noSignal ||
    noDiscriminatingMutants ||
    detectionRate < minDetectionRate
      ? "fail"
      : "pass";
  const worst = worstOperator(metrics);
  return {
    experiment: "mutation",
    status,
    headline: noSignal
      ? "blocked: no mutants killed or preserved (oracle produced no signal)"
      : noDiscriminatingMutants
        ? "blocked: no discriminating mutants"
        : `detection ${formatRate(detectionRate)} (${killed}/${killed + survived})`,
    perBenchmark: [...perBenchmark],
    messages: [
      ...(noSignal
        ? [
            "blocked: no mutants killed or preserved (oracle produced no signal)",
          ]
        : []),
      ...(noDiscriminatingMutants
        ? ["blocked: no discriminating mutants"]
        : []),
      `aggregate preserved=${preserved} falsePositives=${falsePositives} errors=${errors}`,
      ...(worst
        ? [
            `worst survival operator: ${worst.operatorId}=${formatRate(
              worst.survivalRate,
            )} (${worst.survived}/${worst.killed + worst.survived})`,
          ]
        : []),
    ],
  };
}

function worstOperator(metrics: readonly MutationMetrics[]):
  | {
      operatorId: string;
      survived: number;
      killed: number;
      survivalRate: number;
    }
  | undefined {
  const merged = new Map<string, { killed: number; survived: number }>();
  for (const metric of metrics) {
    for (const [operatorId, bucket] of Object.entries(metric.perOperator)) {
      const entry = merged.get(operatorId) ?? { killed: 0, survived: 0 };
      entry.killed += bucket.killed;
      entry.survived += bucket.survived;
      merged.set(operatorId, entry);
    }
  }
  return [...merged]
    .map(([operatorId, entry]) => ({
      operatorId,
      ...entry,
      survivalRate:
        entry.killed + entry.survived === 0
          ? 0
          : entry.survived / (entry.killed + entry.survived),
    }))
    .sort(
      (left, right) =>
        right.survivalRate - left.survivalRate ||
        right.survived - left.survived ||
        left.operatorId.localeCompare(right.operatorId),
    )[0];
}

function failedSlice(
  benchmark: BenchmarkDefinition,
  headline: string,
  metrics: MutationMetrics,
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

function emptyMetrics(): MutationMetrics {
  return {
    mutantsTotal: 0,
    killed: 0,
    survived: 0,
    preserved: 0,
    falsePositives: 0,
    error: 0,
    detectionRate: 0,
    falsePositiveRate: 0,
    sampled: false,
    perOperator: {},
  };
}

function isMutationMetrics(value: unknown): value is MutationMetrics {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<MutationMetrics>;
  return (
    typeof candidate.mutantsTotal === "number" &&
    typeof candidate.killed === "number" &&
    typeof candidate.survived === "number" &&
    typeof candidate.preserved === "number" &&
    typeof candidate.detectionRate === "number"
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
