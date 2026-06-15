import type {
  HarnessCtx,
  HarnessHooks,
  ObservedRead,
  WitnessFactory,
} from "modality-ts/extract/engine/spi";
import type { AbstractDomain, ModelState, Value } from "modality-ts/core";
import { fieldFromVarId, storeNameFromVarId } from "./ids.js";

export interface ZustandHarnessHooks extends HarnessHooks {
  initialState: ModelState;
  stores?: Record<string, { getState(): Record<string, Value> }>;
  store?: { getState(): Record<string, Value> };
}

export function setup(
  ctx: HarnessCtx & Partial<Pick<ZustandHarnessHooks, "store" | "stores">>,
): ZustandHarnessHooks {
  return {
    initialState: ctx.initialState ?? {},
    ...(ctx.store ? { store: ctx.store } : {}),
    ...(ctx.stores ? { stores: ctx.stores } : {}),
  };
}

export function observe(
  varId: string,
  handles: HarnessHooks,
): ObservedRead | "unobservable" {
  const zustand = handles as ZustandHarnessHooks;
  const storeName = storeNameFromVarId(varId);
  const field = fieldFromVarId(varId);
  const store =
    (storeName ? zustand.stores?.[storeName] : undefined) ?? zustand.store;
  if (store && field !== undefined) {
    const state = store.getState();
    if (field in state) return { value: state[field] as Value };
  }
  if (varId in zustand.initialState) {
    const initial = zustand.initialState[varId];
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
