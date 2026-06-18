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

export { checkModel };
export { modelInitialStates, modelSuccessors };
export {
  canSliceAllProperties,
  canSliceProperty,
  propertySliceMode,
  sliceModel,
  sliceModelForCheckProperty,
  sliceModelForProperty,
  targetedAlwaysStepTransitionIds,
};
export type {
  CheckDiagnostics,
  CheckOptions,
  CheckProgress,
  CheckResult,
  PropertyVerdict,
  SliceSummary,
} from "./types.js";

export const checkApi = {
  checkModel,
  modelInitialStates,
  modelSuccessors,
  sliceModel,
};
