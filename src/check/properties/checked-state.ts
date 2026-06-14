import type { Model, ModelState, Property } from "modality-ts/core";
import { enabledTransitionVars } from "../slicing/slice-model.js";

export function checkedState(model: Model, property: Property, state: ModelState, context: string): ModelState {
  if (property.reads === undefined) return state;
  const allowed = allowedPropertyReads(model, property);
  return new Proxy(state, {
    get(target, key, receiver) {
      if (typeof key === "string" && !allowed.has(key)) {
        throw new Error(`${property.name}: ${context} read undeclared var ${key}`);
      }
      return Reflect.get(target, key, receiver) as unknown;
    }
  });
}

function allowedPropertyReads(model: Model, property: Pick<Property, "reads" | "enabledTransitions">): Set<string> {
  return new Set([...(property.reads ?? []), ...enabledTransitionVars(model, new Set(property.enabledTransitions ?? []))]);
}
