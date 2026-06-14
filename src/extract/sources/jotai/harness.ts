import type { HarnessCtx, HarnessHooks, ObservedRead, WitnessFactory } from "modality-ts/extract/engine/spi";
import type { AbstractDomain, ModelState, Value } from "modality-ts/core";

export interface JotaiHarnessHooks extends HarnessHooks {
  initialState: ModelState;
  atoms?: Record<string, unknown>;
  store?: {
    get(atom: unknown): Value;
  };
}

export function setup(ctx: HarnessCtx & Partial<Pick<JotaiHarnessHooks, "atoms" | "store">>): JotaiHarnessHooks {
  return {
    initialState: ctx.initialState ?? {},
    ...(ctx.atoms ? { atoms: ctx.atoms } : {}),
    ...(ctx.store ? { store: ctx.store } : {})
  };
}

export function observe(varId: string, handles: HarnessHooks): ObservedRead | "unobservable" {
  const jotai = handles as JotaiHarnessHooks;
  const atom = jotai.atoms?.[varId] ?? jotai.atoms?.[varId.replace(/^atom:/, "")];
  if (atom !== undefined && jotai.store) return { value: jotai.store.get(atom) };
  if (varId in jotai.initialState) return { value: jotai.initialState[varId]! };
  return "unobservable";
}

export function witness(_domain: AbstractDomain, _varId: string): WitnessFactory | undefined {
  return undefined;
}
