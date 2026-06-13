import type { HarnessCtx, HarnessHooks, ObservedRead, WitnessFactory } from "modality-ts/extraction/spi";
import type { AbstractDomain, ModelState, Value } from "modality-ts/kernel";

export interface SwrHarnessHooks extends HarnessHooks {
  initialState: ModelState;
  cache: Map<string, Value>;
}

export function setup(ctx: HarnessCtx & { cache?: Map<string, Value> | Record<string, Value> }): SwrHarnessHooks {
  return {
    initialState: ctx.initialState ?? {},
    cache: ctx.cache instanceof Map ? ctx.cache : new Map(Object.entries(ctx.cache ?? {}))
  };
}

export function observe(varId: string, handles: HarnessHooks): ObservedRead | "unobservable" {
  const swr = handles as SwrHarnessHooks;
  if (swr.cache.has(varId)) return { value: swr.cache.get(varId)! };
  const key = cacheKeyForVar(varId);
  if (key && swr.cache.has(key)) return { value: swr.cache.get(key)! };
  if (varId in swr.initialState) return { value: swr.initialState[varId]! };
  return "unobservable";
}

export function witness(_domain: AbstractDomain, _varId: string): WitnessFactory | undefined {
  return undefined;
}

function cacheKeyForVar(varId: string): string | undefined {
  const match = /^swr:(.+):data$/.exec(varId);
  return match?.[1];
}
