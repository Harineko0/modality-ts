import type { AbstractDomain, ModelState, Value } from "modality-ts/core";
import type {
  HarnessCtx,
  HarnessHooks,
  ObservedRead,
  WitnessFactory,
} from "modality-ts/extract/engine/spi";

export interface SwrHarnessHooks extends HarnessHooks {
  initialState: ModelState;
  cache: Map<string, Value>;
}

export function setup(
  ctx: HarnessCtx & { cache?: Map<string, Value> | Record<string, Value> },
): SwrHarnessHooks {
  return {
    initialState: ctx.initialState ?? {},
    cache:
      ctx.cache instanceof Map
        ? ctx.cache
        : new Map(Object.entries(ctx.cache ?? {})),
  };
}

export function observe(
  varId: string,
  handles: HarnessHooks,
): ObservedRead | "unobservable" {
  const swr = handles as SwrHarnessHooks;
  const cached = swr.cache.get(varId);
  if (cached !== undefined) return { value: cached };
  const key = cacheKeyForVar(varId);
  if (key) {
    const keyed = swr.cache.get(key);
    if (keyed !== undefined) return { value: keyed };
  }
  if (varId in swr.initialState) {
    const initial = swr.initialState[varId];
    if (initial !== undefined) return { value: initial };
  }
  return "unobservable";
}

export function witness(
  _domain: AbstractDomain,
  _varId: string,
): WitnessFactory | undefined {
  return undefined;
}

function cacheKeyForVar(varId: string): string | undefined {
  const match = /^swr:(.+):data$/.exec(varId);
  return match?.[1];
}
