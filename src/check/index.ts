import { checkModel } from "./engine/check-model.js";
import { modelInitialStates, modelSuccessors } from "./engine/model-api.js";
import { sliceModel } from "./slicing/slice-model.js";

export { checkModel };
export { modelInitialStates, modelSuccessors };
export { sliceModel };
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
