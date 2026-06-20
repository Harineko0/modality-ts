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
  mutationIdFromVarId,
  queryKeyIdFromVarId,
} from "./ids.js";

export interface TanstackQueryHarnessHooks extends HarnessHooks {
  initialState: ModelState;
  queryClient?: TanstackQueryClientLike;
}

export interface TanstackQueryClientLike {
  getQueryData(queryKey: readonly unknown[]): unknown;
  getQueryState(
    queryKey: readonly unknown[],
  ): TanstackQueryStateLike | undefined;
  getMutationCache?(): {
    findAll(filters?: {
      mutationKey?: readonly unknown[];
    }): readonly TanstackMutationLike[];
  };
}

export interface TanstackQueryStateLike {
  status?: string;
  fetchStatus?: string;
  data?: unknown;
  error?: unknown;
  isStale?: boolean;
  failureCount?: number;
}

export interface TanstackMutationLike {
  state?: {
    status?: string;
    data?: unknown;
    error?: unknown;
    variables?: unknown;
    failureCount?: number;
  };
}

export function setup(
  ctx: HarnessCtx & { queryClient?: TanstackQueryClientLike },
): TanstackQueryHarnessHooks {
  return {
    initialState: ctx.initialState ?? {},
    ...(ctx.queryClient ? { queryClient: ctx.queryClient } : {}),
  };
}

export function observe(
  varId: string,
  handles: HarnessHooks,
): ObservedRead | "unobservable" {
  const hooks = handles as TanstackQueryHarnessHooks;
  const queryKeyId = queryKeyIdFromVarId(varId);
  const mutationId = mutationIdFromVarId(varId);
  const field = queryKeyId
    ? fieldFromQueryVarId(varId)
    : fieldFromMutationVarId(varId);

  if (hooks.queryClient && queryKeyId && field) {
    const queryKey = queryKeyId.split("_");
    const state = hooks.queryClient.getQueryState(queryKey);
    const data = hooks.queryClient.getQueryData(queryKey);
    const value = observeQueryField(field, state, data);
    if (value !== undefined) return { value };
  }

  if (hooks.queryClient && mutationId && field) {
    const cache = hooks.queryClient.getMutationCache?.();
    const mutations = cache?.findAll() ?? [];
    const latest = mutations[mutations.length - 1];
    const value = observeMutationField(field, latest);
    if (value !== undefined) return { value };
  }

  if (varId in hooks.initialState) {
    const initial = hooks.initialState[varId];
    if (initial !== undefined) return { value: initial };
  }
  return "unobservable";
}

function observeQueryField(
  field: string,
  state: TanstackQueryStateLike | undefined,
  data: unknown,
): Value | undefined {
  if (!state && data === undefined) return undefined;
  switch (field) {
    case "data":
      return (data ?? null) as Value;
    case "status":
      return (state?.status ?? "pending") as Value;
    case "fetchStatus":
      return (state?.fetchStatus ?? "idle") as Value;
    case "stale":
      return state?.isStale === true;
    case "invalidated":
      return state?.isStale === true;
    case "failureCount":
      return String(Math.min(state?.failureCount ?? 0, 2)) as Value;
    case "isFetching":
      return state?.fetchStatus === "fetching" ? "1" : "0";
    default:
      return undefined;
  }
}

function observeMutationField(
  field: string,
  mutation: TanstackMutationLike | undefined,
): Value | undefined {
  if (!mutation?.state) return undefined;
  switch (field) {
    case "status":
      return (mutation.state.status ?? "idle") as Value;
    case "data":
      return (mutation.state.data ?? null) as Value;
    case "error":
      return (
        mutation.state.error !== undefined && mutation.state.error !== null
      );
    case "variables":
      return (mutation.state.variables ?? "token:0") as Value;
    case "failureCount":
      return String(Math.min(mutation.state.failureCount ?? 0, 2)) as Value;
    case "isMutating":
      return mutation.state.status === "pending" ? "1" : "0";
    default:
      return undefined;
  }
}

export function witness(
  _domain: AbstractDomain,
  _varId: string,
): WitnessFactory | undefined {
  return undefined;
}

export function createQueryClientProviderWrapper(
  queryClient: TanstackQueryClientLike,
): { wrap(children: unknown): unknown } {
  return {
    wrap(children: unknown) {
      return {
        type: "QueryClientProvider",
        props: { client: queryClient },
        children,
      };
    },
  };
}
