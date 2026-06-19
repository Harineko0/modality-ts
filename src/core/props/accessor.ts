import { var as stateVar, type VarHandle } from "./operand.js";

export type ComponentLike =
  | { name?: string }
  | ((...args: readonly unknown[]) => unknown);

export function s(
  component: ComponentLike,
  idOverride?: string,
): Record<string, VarHandle> {
  const componentId = idOverride ?? component.name ?? "Anonymous";
  return new Proxy({} as Record<string, VarHandle>, {
    get(_target, field) {
      if (typeof field !== "string" || field === "then") return undefined;
      return stateVar(`local:${componentId}.${field}`);
    },
  });
}
