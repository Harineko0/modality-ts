import type { Model, ModelState, Value } from "./types.js";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function canonicalState(model: Model, state: ModelState): string {
  const tokenMap = new Map<string, string>();
  let nextToken = 1;
  const encodeValue = (value: Value): unknown => {
    if (typeof value === "string" && /^tok\d+$/.test(value)) {
      const mapped = tokenMap.get(value) ?? `tok${nextToken++}`;
      tokenMap.set(value, mapped);
      return mapped;
    }
    if (Array.isArray(value)) return value.map(encodeValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, encodeValue(v)]));
    }
    return value;
  };
  return canonicalJson(model.vars.map((decl) => [decl.id, encodeValue(state[decl.id])]));
}

export function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortJson(v)]));
  }
  return value;
}
