import { initialValues } from "modality-ts/core";
import type { Model, ModelState } from "modality-ts/core";
import { normalizeInitialRouteLocals } from "../runtime/effects.js";

export function initialStates(model: Model): ModelState[] {
  return model.vars.reduce<ModelState[]>((states, decl) => {
    const initials = initialValues(decl.domain, decl.initial);
    return states.flatMap((state) => initials.map((value) => ({ ...state, [decl.id]: value })));
  }, [{}]).flatMap((state) => normalizeInitialRouteLocals(model, state));
}
