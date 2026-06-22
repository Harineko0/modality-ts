import { checkModel } from "./check-model.js";
import { modelInitialStates, modelSuccessors } from "./model-api.js";
import {
  canSliceAllProperties,
  canSliceProperty,
  propertySliceMode,
  sliceModel,
  sliceModelForCheckProperty,
  sliceModelForProperty,
  targetedAlwaysStepTransitionIds,
} from "./slicing/slice-model.js";

export type {
  CheckDiagnostics,
  CheckOptions,
  CheckProgress,
  CheckResult,
  MountScopeDependency,
  PendingQueueDependency,
  PropertyVerdict,
  SliceSummary,
} from "./types.js";
export {
  canSliceAllProperties,
  canSliceProperty,
  checkModel,
  modelInitialStates,
  modelSuccessors,
  propertySliceMode,
  sliceModel,
  sliceModelForCheckProperty,
  sliceModelForProperty,
  targetedAlwaysStepTransitionIds,
};

export const checkApi = {
  checkModel,
  modelInitialStates,
  modelSuccessors,
  sliceModel,
};
