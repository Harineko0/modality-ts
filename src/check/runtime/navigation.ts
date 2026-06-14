import { initialValues, UNMOUNTED } from "modality-ts/core";
import type { EffectIR, Model, ModelState, Value } from "modality-ts/core";
import type { EvalOptions } from "./expr.js";
import { evalExpr } from "./expr.js";

export function navigate(
  model: Model,
  state: ModelState,
  effect: Extract<EffectIR, { kind: "navigate" }>,
  options: EvalOptions,
): ModelState[] {
  const route = state["sys:route"];
  const history = Array.isArray(state["sys:history"])
    ? state["sys:history"]
    : [];
  if (effect.mode === "back") {
    const previous = history[history.length - 1];
    if (typeof previous !== "string") return [state];
    return resetRouteLocals(
      model,
      { ...state, "sys:route": previous, "sys:history": history.slice(0, -1) },
      route,
    );
  }
  const to = effect.to ? evalExpr(model, state, effect.to) : undefined;
  if (typeof to !== "string") return [state];
  const historyDecl = model.vars.find((decl) => decl.id === "sys:history");
  const historyCap =
    historyDecl?.domain.kind === "boundedList"
      ? historyDecl.domain.maxLen
      : undefined;
  if (
    effect.mode === "push" &&
    historyCap !== undefined &&
    history.length >= historyCap
  ) {
    options.onBoundHit?.("history cap saturated");
    return [];
  }
  const nextHistory =
    effect.mode === "push" && typeof route === "string"
      ? [...history, route]
      : history;
  return resetRouteLocals(
    model,
    { ...state, "sys:route": to, "sys:history": nextHistory },
    route,
  );
}

export function normalizeInitialRouteLocals(
  model: Model,
  state: ModelState,
): ModelState[] {
  return resetRouteLocals(model, state, undefined, { preserveMounted: true });
}

function resetRouteLocals(
  model: Model,
  state: ModelState,
  previousRoute: Value | undefined,
  options: { preserveMounted?: boolean } = {},
): ModelState[] {
  const currentRoute = state["sys:route"];
  if (previousRoute === currentRoute) return [state];
  let states = [state];
  for (const decl of model.vars) {
    if (decl.scope.kind !== "route-local") continue;
    if (decl.scope.route === currentRoute) {
      if (options.preserveMounted) continue;
      states = states.flatMap((candidate) =>
        initialValues(decl.domain, decl.initial).map((value) => ({
          ...candidate,
          [decl.id]: value,
        })),
      );
    } else {
      states = states.map((candidate) => ({
        ...candidate,
        [decl.id]: UNMOUNTED,
      }));
    }
  }
  return states;
}
