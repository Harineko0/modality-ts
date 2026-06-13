import type { HarnessCtx, HarnessHooks, ObservedRead } from "@modality/extraction/spi";
import type { Value } from "@modality/kernel";

export interface RouterHarnessHooks extends HarnessHooks {
  route: string;
  history: string[];
}

export function setup(ctx: HarnessCtx): RouterHarnessHooks {
  return {
    route: typeof ctx.initialState?.["sys:route"] === "string" ? ctx.initialState["sys:route"] : "/",
    history: Array.isArray(ctx.initialState?.["sys:history"]) ? [...ctx.initialState["sys:history"].filter(isString)] : []
  };
}

export function observe(handles: HarnessHooks, varId = "sys:route"): ObservedRead | "unobservable" {
  const router = handles as RouterHarnessHooks;
  if (varId === "sys:route") return { value: router.route };
  if (varId === "sys:history") return { value: router.history };
  return "unobservable";
}

export function navigate(handles: HarnessHooks, mode: "push" | "replace" | "back", to?: string): void {
  const router = handles as RouterHarnessHooks;
  if (mode === "back") {
    const previous = router.history.pop();
    if (previous !== undefined) router.route = previous;
    return;
  }
  if (!to) return;
  if (mode === "push") router.history.push(router.route);
  router.route = to;
}

function isString(value: Value): value is string {
  return typeof value === "string";
}
