import type { ExprIR, Model, Property } from "modality-ts/core";
import { evalStatePredicate, StatePredicateEvalError } from "modality-ts/core";
import { modelInitialStates } from "./model-api.js";
import type { PropertyVerdict } from "./types.js";

function isExprIR(value: unknown): value is ExprIR {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    typeof (value as { kind: unknown }).kind === "string"
  );
}

export function initialStateReachableVerdict(
  model: Model,
  property: Property,
): PropertyVerdict | undefined {
  if (property.kind !== "reachable") return undefined;
  if (!isExprIR(property.predicate)) return undefined;
  try {
    const initials = modelInitialStates(model);
    for (const state of initials) {
      if (evalStatePredicate(property.predicate, state)) {
        return {
          status: "reachable",
          property: property.name,
          trace: { steps: [] },
        };
      }
    }
  } catch (error) {
    if (error instanceof StatePredicateEvalError) return undefined;
    throw error;
  }
  return undefined;
}
