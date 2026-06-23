import type { Value } from "modality-ts/core";
import type {
  HarnessCtx,
  HarnessHooks,
  ObservedRead,
} from "modality-ts/extract/engine/spi";
import { TANSTACK_BRANCH_NONE, tanstackBranchVarId } from "./routes.js";

export interface TanstackRouterHarnessHooks extends HarnessHooks {
  route: string;
  history: string[];
  branch: string;
  search: Record<string, string>;
}

export function setup(ctx: HarnessCtx): TanstackRouterHarnessHooks {
  const search: Record<string, string> = {};
  for (const [key, value] of Object.entries(ctx.initialState ?? {})) {
    if (key.startsWith("sys:tanstack:search:") && typeof value === "string") {
      search[key] = value;
    }
  }
  return {
    route:
      typeof ctx.initialState?.["sys:route"] === "string"
        ? ctx.initialState["sys:route"]
        : "/",
    history: Array.isArray(ctx.initialState?.["sys:history"])
      ? [...ctx.initialState["sys:history"].filter(isString)]
      : [],
    branch: (() => {
      const value = ctx.initialState?.[tanstackBranchVarId()];
      return typeof value === "string" ? value : TANSTACK_BRANCH_NONE;
    })(),
    search,
  };
}

export function observe(
  handles: HarnessHooks,
  varId = "sys:route",
): ObservedRead | "unobservable" {
  const router = handles as TanstackRouterHarnessHooks;
  if (varId === "sys:route") return { value: router.route };
  if (varId === "sys:history") return { value: router.history };
  if (varId === tanstackBranchVarId()) return { value: router.branch };
  if (varId in router.search) return { value: router.search[varId]! };
  return "unobservable";
}

export function navigate(
  handles: HarnessHooks,
  mode: "push" | "replace" | "back",
  to?: string,
): void {
  const router = handles as TanstackRouterHarnessHooks;
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
