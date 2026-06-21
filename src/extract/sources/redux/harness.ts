import type {
  HarnessCtx,
  HarnessHooks,
  ObservedRead,
  WitnessFactory,
} from "modality-ts/extract/engine/spi";
import type { AbstractDomain, ModelState, Value } from "modality-ts/core";
import {
  fieldFromMutationVarId,
  fieldFromQueryVarId,
  mutationSiteIdFromVarId,
  pathFromVarId,
  queryKeyIdFromVarId,
  storeNameFromVarId,
} from "./ids.js";

export interface ReduxHarnessHooks extends HarnessHooks {
  initialState: ModelState;
  stores?: Record<
    string,
    { getState(): unknown; dispatch?: (...args: unknown[]) => unknown }
  >;
  store?: { getState(): unknown; dispatch?: (...args: unknown[]) => unknown };
  providerStore?: unknown;
}

export function setup(
  ctx: HarnessCtx &
    Partial<Pick<ReduxHarnessHooks, "store" | "stores" | "providerStore">>,
): ReduxHarnessHooks {
  return {
    initialState: ctx.initialState ?? {},
    ...(ctx.store ? { store: ctx.store } : {}),
    ...(ctx.stores ? { stores: ctx.stores } : {}),
    ...(ctx.providerStore ? { providerStore: ctx.providerStore } : {}),
  };
}

export function observe(
  varId: string,
  handles: HarnessHooks,
): ObservedRead | "unobservable" {
  const redux = handles as ReduxHarnessHooks;
  if (varId.startsWith("redux-query:")) {
    return observeRtkQueryVar(varId, redux);
  }
  if (varId.startsWith("redux-mutation:")) {
    return observeRtkMutationVar(varId, redux);
  }
  const storeName = storeNameFromVarId(varId);
  const path = pathFromVarId(varId);
  const store =
    (storeName ? redux.stores?.[storeName] : undefined) ??
    redux.store;
  if (store && path) {
    const value = readPath(store.getState(), path.split("."));
    if (value !== undefined) return { value: value as Value };
  }
  if (varId in redux.initialState) {
    const initial = redux.initialState[varId];
    if (initial !== undefined) return { value: initial };
  }
  return "unobservable";
}

function observeRtkQueryVar(
  varId: string,
  redux: ReduxHarnessHooks,
): ObservedRead | "unobservable" {
  const field = fieldFromQueryVarId(varId);
  if (!field) return "unobservable";
  if (varId in redux.initialState) {
    const initial = redux.initialState[varId];
    if (initial !== undefined) return { value: initial };
  }
  const store = redux.store ?? Object.values(redux.stores ?? {})[0];
  if (!store) return "unobservable";
  const state = store.getState() as Record<string, unknown>;
  const queries = findRtkQueryState(state);
  if (!queries) return "unobservable";
  const keyId = queryKeyIdFromVarId(varId);
  if (!keyId) return "unobservable";
  for (const entry of Object.values(queries)) {
    if (entry && typeof entry === "object" && field in entry) {
      return { value: (entry as Record<string, Value>)[field] as Value };
    }
  }
  return "unobservable";
}

function observeRtkMutationVar(
  varId: string,
  redux: ReduxHarnessHooks,
): ObservedRead | "unobservable" {
  const field = fieldFromMutationVarId(varId);
  if (!field) return "unobservable";
  if (varId in redux.initialState) {
    const initial = redux.initialState[varId];
    if (initial !== undefined) return { value: initial };
  }
  const siteId = mutationSiteIdFromVarId(varId);
  if (siteId && redux.initialState[`redux-mutation-site:${siteId}:${field}`]) {
    return {
      value: redux.initialState[`redux-mutation-site:${siteId}:${field}`] as Value,
    };
  }
  return "unobservable";
}

function findRtkQueryState(
  state: Record<string, unknown>,
): Record<string, unknown> | undefined {
  for (const value of Object.values(state)) {
    if (
      value &&
      typeof value === "object" &&
      "queries" in value &&
      typeof (value as { queries?: unknown }).queries === "object"
    ) {
      return (value as { queries: Record<string, unknown> }).queries;
    }
  }
  return undefined;
}

function readPath(value: unknown, parts: string[]): Value | undefined {
  let current: unknown = value;
  for (const part of parts) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current as Value | undefined;
}

export function witness(
  _domain: AbstractDomain,
  _varId: string,
): WitnessFactory | undefined {
  return undefined;
}

export const providerWrapperMetadata = {
  component: "Provider",
  storeProp: "store",
};
