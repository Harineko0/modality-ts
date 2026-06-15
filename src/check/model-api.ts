import type { Model, ModelState, TraceStep } from "modality-ts/core";
import { runRustInitialStates, runRustSuccessors } from "./native.js";

export function modelInitialStates(model: Model): ModelState[] {
  return runRustInitialStates(model);
}

export function modelSuccessors(model: Model, pre: ModelState): TraceStep[] {
  return runRustSuccessors(model, pre);
}
