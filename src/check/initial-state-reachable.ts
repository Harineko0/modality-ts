import type { Model, Property } from "modality-ts/core";
import type { PropertyVerdict } from "./types.js";

// This fast-path was used for the old `reachable` property kind.
// With the CTL engine handling EF via global labeling after BFS,
// it is no longer needed and always returns undefined.
export function initialStateReachableVerdict(
  _model: Model,
  _property: Property,
): PropertyVerdict | undefined {
  return undefined;
}
