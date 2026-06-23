import type {
  ValidityBenchmarkSlice,
  ValidityExperiment,
  ValidityExperimentId,
  ValidityRunContext,
} from "../types.js";

export const validityExperiments: Record<
  ValidityExperimentId,
  () => ValidityExperiment
> = {
  conformance: () => stubExperiment("conformance"),
  mutation: () => stubExperiment("mutation"),
  metamorphic: () => stubExperiment("metamorphic"),
};

function stubExperiment(id: ValidityExperimentId): ValidityExperiment {
  return {
    id,
    async run(ctx: ValidityRunContext) {
      const headline = `${id} not yet implemented`;
      return {
        experiment: id,
        status: "skipped",
        headline,
        perBenchmark: ctx.manifest.benchmarks.map(
          (benchmark): ValidityBenchmarkSlice => ({
            benchmarkId: benchmark.id,
            framework: benchmark.framework,
            status: "skipped",
            headline,
            metrics: {},
            messages: [headline],
          }),
        ),
        messages: [headline],
      };
    },
  };
}
