import type {
  HarnessCtx,
  HarnessHooks,
  ObservedRead,
  WitnessFactory,
} from "modality-ts/extract/engine/spi";
import type { AbstractDomain, ModelState, Value } from "modality-ts/core";

export interface UseStateHarnessHooks extends HarnessHooks {
  initialState: ModelState;
  probes: Record<string, () => Value>;
}

export function setup(
  ctx: HarnessCtx & { probes?: Record<string, () => Value> },
): UseStateHarnessHooks {
  return {
    initialState: ctx.initialState ?? {},
    probes: ctx.probes ?? {},
  };
}

export function observe(
  varId: string,
  handles: HarnessHooks,
): ObservedRead | "unobservable" {
  const useState = handles as UseStateHarnessHooks;
  const probe = useState.probes[varId];
  if (probe) return { value: probe() };
  if (varId in useState.initialState)
    return { value: useState.initialState[varId]! };
  return "unobservable";
}

export function witness(
  _domain: AbstractDomain,
  _varId: string,
): WitnessFactory | undefined {
  return undefined;
}
