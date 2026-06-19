import { variable, type Variable } from "./operand.js";

export type ComponentLike =
  | { name?: string }
  | ((...args: readonly unknown[]) => unknown);

export function s(
  component: ComponentLike,
  idOverride?: string,
): Record<string, Variable> {
  const componentId = idOverride ?? component.name ?? "Anonymous";
  return new Proxy({} as Record<string, Variable>, {
    get(_target, field) {
      if (typeof field !== "string" || field === "then") return undefined;
      return variable(`local:${componentId}.${field}`);
    },
  });
}
