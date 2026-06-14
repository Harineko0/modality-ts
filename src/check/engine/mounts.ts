import type { Model, ModelState, Transition } from "modality-ts/core";

export function routeLocalMounted(model: Model, transition: Transition, state: ModelState): boolean {
  const currentRoute = state["sys:route"];
  const touched = new Set([...transition.reads, ...transition.writes]);
  for (const decl of model.vars) {
    if (decl.scope.kind === "route-local" && touched.has(decl.id) && decl.scope.route !== currentRoute) {
      return false;
    }
  }
  return true;
}
