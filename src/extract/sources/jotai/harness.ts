import type {
  HarnessCtx,
  HarnessHooks,
  ObservedRead,
  WitnessFactory,
} from "modality-ts/extract/engine/spi";
import type { AbstractDomain, ModelState, Value } from "modality-ts/core";
import { atomNameFromVarId, storeScopeFromVarId } from "./ids.js";

export interface JotaiHarnessHooks extends HarnessHooks {
  initialState: ModelState;
  atoms?: Record<string, unknown>;
  stores?: Record<string, { get(atom: unknown): Value }>;
  store?: {
    get(atom: unknown): Value;
  };
}

export function setup(
  ctx: HarnessCtx &
    Partial<Pick<JotaiHarnessHooks, "atoms" | "store" | "stores">>,
): JotaiHarnessHooks {
  return {
    initialState: ctx.initialState ?? {},
    ...(ctx.atoms ? { atoms: ctx.atoms } : {}),
    ...(ctx.store ? { store: ctx.store } : {}),
    ...(ctx.stores ? { stores: ctx.stores } : {}),
  };
}

export function observe(
  varId: string,
  handles: HarnessHooks,
): ObservedRead | "unobservable" {
  const jotai = handles as JotaiHarnessHooks;
  const atomName = atomNameFromVarId(varId);
  const storeScope = storeScopeFromVarId(varId);
  const atom =
    jotai.atoms?.[varId] ??
    jotai.atoms?.[atomName ?? ""] ??
    (atomName ? jotai.atoms?.[`atom:${atomName}`] : undefined);
  const store =
    (storeScope ? jotai.stores?.[storeScope] : undefined) ?? jotai.store;
  if (atom !== undefined && store) return { value: store.get(atom) };
  if (varId in jotai.initialState) {
    const initial = jotai.initialState[varId];
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
