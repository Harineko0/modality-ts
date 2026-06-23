import type {
  ValidityBenchmarkSlice,
  ValidityExperiment,
  ValidityExperimentId,
  ValidityRunContext,
} from "../types.js";
import { conformanceExperiment } from "./conformance.js";
import { mutationExperiment } from "./mutation.js";

export const validityExperiments: Record<
  ValidityExperimentId,
  () => ValidityExperiment
> = {
  conformance: () => conformanceExperiment(),
  mutation: () => mutationExperiment(),
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
