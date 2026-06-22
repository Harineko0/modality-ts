import type { Value } from "modality-ts/core";
import type {
  HarnessCtx,
  HarnessHooks,
  ObservedRead,
} from "modality-ts/extract/engine/spi";

export interface NextHarnessHooks extends HarnessHooks {
  route: string;
  history: string[];
  routeTree: Record<string, Value>;
}

export function setup(ctx: HarnessCtx): NextHarnessHooks {
  const routeTree: Record<string, Value> = {};
  for (const [key, value] of Object.entries(ctx.initialState ?? {})) {
    if (key.startsWith("sys:next:")) routeTree[key] = value;
  }
  return {
    route:
      typeof ctx.initialState?.["sys:route"] === "string"
        ? ctx.initialState["sys:route"]
        : "/",
    history: Array.isArray(ctx.initialState?.["sys:history"])
      ? [...ctx.initialState["sys:history"].filter(isString)]
      : [],
    routeTree,
  };
}

export function observe(
  handles: HarnessHooks,
  varId = "sys:route",
): ObservedRead | "unobservable" {
  const next = handles as NextHarnessHooks;
  if (varId === "sys:route") return { value: next.route };
  if (varId === "sys:history") return { value: next.history };
  if (varId in next.routeTree) return { value: next.routeTree[varId]! };
  return "unobservable";
}

export function navigate(
  handles: HarnessHooks,
  mode: "push" | "replace" | "back",
  to?: string,
): void {
  const next = handles as NextHarnessHooks;
  if (mode === "back") {
    const previous = next.history.pop();
    if (previous !== undefined) next.route = previous;
    return;
  }
  if (!to) return;
  if (mode === "push") next.history.push(next.route);
  next.route = to;
}

function isString(value: Value): value is string {
  return typeof value === "string";
}
