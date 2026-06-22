import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { checkModel } from "modality-ts/check";
import type { StateSpaceContributor } from "modality-ts/core";
import { buildStateContributors } from "../src/check/slicing/contributors.js";
import { buildPropertySlicePlan } from "../src/cli/features/extract/command.js";
import {
  COFFEE_SHAPED_DENSITY_ONE_PROPERTY,
  coffeeShapedPerformanceModel,
  coffeeShapedPerformanceProperties,
} from "./perf/coffee-shaped-fixture.js";

export interface CheckPerformanceBenchmarkPropertySlice {
  property: string;
  status: "emitted" | "skipped";
  mode?: "state" | "targetedStep" | "full";
  fullVars?: number;
  fullTransitions?: number;
  vars?: number;
  transitions?: number;
  retainedBits?: number;
  prunedBits?: number;
  topRetainedContributors?: readonly StateSpaceContributor[];
  topPrunedContributors?: readonly StateSpaceContributor[];
  slicePlanningElapsedMs?: number;
  reason?: string;
}

export interface CheckPerformanceBenchmarkCheckStats {
  states: number;
  edges: number;
  depth: number;
  elapsedMs: number;
}

export interface CheckPerformanceBenchmarkResult {
  fixture: string;
  properties: readonly string[];
  fullVars: number;
  fullTransitions: number;
  fullStateSpaceBits: number;
  propertySlices: readonly CheckPerformanceBenchmarkPropertySlice[];
  slicePlanningTotalElapsedMs: number;
  motivatingProperty: string;
  motivatingPropertySlice?: CheckPerformanceBenchmarkPropertySlice;
  unsliced: CheckPerformanceBenchmarkCheckStats;
  sliced: CheckPerformanceBenchmarkCheckStats;
  slicedPor?: CheckPerformanceBenchmarkCheckStats & {
    partialOrderReduction?: {
      enabled: boolean;
      skippedTransitions?: number;
      reducedStates?: number;
      cycleFallbackStates?: number;
    };
  };
  speedup?: number;
}

const BENCHMARK_NOW = new Date("2026-06-19T00:00:00.000Z");

function roundElapsedMs(value: number): number {
  return Math.round(value * 100) / 100;
}

export function runCheckPerformanceBenchmark(
  fixture = "coffee-shaped",
): CheckPerformanceBenchmarkResult {
  if (fixture !== "coffee-shaped") {
    throw new Error(`unsupported benchmark fixture: ${fixture}`);
  }
  const model = coffeeShapedPerformanceModel();
  const properties = coffeeShapedPerformanceProperties(model);
  const contributors = buildStateContributors(model);
  const slicePlan = buildPropertySlicePlan(
    model,
    properties,
    "benchmark.model.json",
    "benchmark.slices.json",
    BENCHMARK_NOW,
  );
  const propertySlices: CheckPerformanceBenchmarkPropertySlice[] = (
    slicePlan.diagnosticsSummary.entries ?? []
  ).map((entry) => ({
    property: entry.property,
    status: entry.status,
    ...(entry.mode ? { mode: entry.mode } : {}),
    ...(entry.fullVars !== undefined ? { fullVars: entry.fullVars } : {}),
    ...(entry.fullTransitions !== undefined
      ? { fullTransitions: entry.fullTransitions }
      : {}),
    ...(entry.vars !== undefined ? { vars: entry.vars } : {}),
    ...(entry.transitions !== undefined
      ? { transitions: entry.transitions }
      : {}),
    ...(entry.retainedBits !== undefined
      ? { retainedBits: entry.retainedBits }
      : {}),
    ...(entry.prunedBits !== undefined ? { prunedBits: entry.prunedBits } : {}),
    ...(entry.topRetainedContributors
      ? { topRetainedContributors: entry.topRetainedContributors }
      : {}),
    ...(entry.topPrunedContributors
      ? { topPrunedContributors: entry.topPrunedContributors }
      : {}),
    ...(entry.elapsedMs !== undefined
      ? { slicePlanningElapsedMs: entry.elapsedMs }
      : {}),
    ...(entry.reason ? { reason: entry.reason } : {}),
  }));

  const unslicedStartedAt = performance.now();
  const unsliced = checkModel(model, properties, { slicing: false });
  const unslicedElapsedMs = roundElapsedMs(
    performance.now() - unslicedStartedAt,
  );

  const slicedStartedAt = performance.now();
  const slicedResult = checkModel(model, properties, { slicing: true });
  const slicedElapsedMs = roundElapsedMs(performance.now() - slicedStartedAt);

  const slicedPorStartedAt = performance.now();
  const slicedPorResult = checkModel(model, properties, {
    slicing: true,
    partialOrderReduction: true,
  });
  const slicedPorElapsedMs = roundElapsedMs(
    performance.now() - slicedPorStartedAt,
  );

  const speedup =
    unslicedElapsedMs > 0 && slicedElapsedMs > 0
      ? roundElapsedMs(unslicedElapsedMs / slicedElapsedMs)
      : undefined;

  return {
    fixture,
    properties: properties.map((property) => property.name),
    fullVars: model.vars.length,
    fullTransitions: model.transitions.length,
    fullStateSpaceBits: contributors.totalBits,
    propertySlices,
    slicePlanningTotalElapsedMs:
      slicePlan.diagnosticsSummary.totalElapsedMs ?? 0,
    motivatingProperty: COFFEE_SHAPED_DENSITY_ONE_PROPERTY,
    motivatingPropertySlice: propertySlices.find(
      (entry) => entry.property === COFFEE_SHAPED_DENSITY_ONE_PROPERTY,
    ),
    unsliced: {
      states: unsliced.stats.states,
      edges: unsliced.stats.edges,
      depth: unsliced.stats.depth,
      elapsedMs: unslicedElapsedMs,
    },
    sliced: {
      states: slicedResult.stats.states,
      edges: slicedResult.stats.edges,
      depth: slicedResult.stats.depth,
      elapsedMs: slicedElapsedMs,
    },
    slicedPor: {
      states: slicedPorResult.stats.states,
      edges: slicedPorResult.stats.edges,
      depth: slicedPorResult.stats.depth,
      elapsedMs: slicedPorElapsedMs,
      partialOrderReduction: slicedPorResult.diagnostics?.partialOrderReduction
        ? {
            enabled: slicedPorResult.diagnostics.partialOrderReduction.enabled,
            skippedTransitions:
              slicedPorResult.diagnostics.partialOrderReduction
                .skippedTransitions,
            reducedStates:
              slicedPorResult.diagnostics.partialOrderReduction.reducedStates,
            cycleFallbackStates:
              slicedPorResult.diagnostics.partialOrderReduction
                .cycleFallbackStates,
          }
        : undefined,
    },
    ...(speedup !== undefined ? { speedup } : {}),
  };
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const fixture = process.argv.includes("--fixture")
    ? process.argv[process.argv.indexOf("--fixture") + 1]
    : "coffee-shaped";

  const result = runCheckPerformanceBenchmark(fixture);
  console.log(JSON.stringify(result, null, 2));
}
