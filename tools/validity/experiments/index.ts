import type { ValidityExperiment, ValidityExperimentId } from "../types.js";
import { conformanceExperiment } from "./conformance.js";
import { metamorphicExperiment } from "./metamorphic.js";
import { mutationExperiment } from "./mutation.js";

export const validityExperiments: Record<
  ValidityExperimentId,
  () => ValidityExperiment
> = {
  conformance: () => conformanceExperiment(),
  mutation: () => mutationExperiment(),
  metamorphic: () => metamorphicExperiment(),
};
