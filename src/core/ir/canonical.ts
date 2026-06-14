import type { AbstractDomain, Model, ModelState, Value } from "./types.js";

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function canonicalState(model: Model, state: ModelState): string {
  const tokenMap = new Map<string, string>();
  let nextToken = 1;
  const encodeValue = (
    domain: AbstractDomain,
    value: Value | undefined,
  ): unknown => {
    if (domain.kind === "tokens" && typeof value === "string") {
      const mapped = tokenMap.get(value) ?? `tok${nextToken++}`;
      tokenMap.set(value, mapped);
      return mapped;
    }
    if (domain.kind === "option") {
      return value === null || value === undefined
        ? null
        : encodeValue(domain.inner, value);
    }
    if (
      domain.kind === "record" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      return Object.fromEntries(
        Object.entries(domain.fields)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, inner]) => [
            key,
            encodeValue(inner, (value as Record<string, Value>)[key]),
          ]),
      );
    }
    if (
      domain.kind === "tagged" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      const record = value as Record<string, Value>;
      const tag = record[domain.tag];
      const variant =
        typeof tag === "string" ? domain.variants[tag] : undefined;
      return Object.fromEntries(
        Object.entries(record)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [
            key,
            key === domain.tag || !variant || variant.kind !== "record"
              ? item
              : encodeValue(
                  variant.fields[key] ?? { kind: "enum", values: [] },
                  item,
                ),
          ]),
      );
    }
    if (domain.kind === "boundedList" && Array.isArray(value)) {
      return value.map((item) => encodeValue(domain.inner, item));
    }
    if (Array.isArray(value)) return value.map((item) => sortJson(item));
    if (value && typeof value === "object") {
      return sortJson(value);
    }
    return value;
  };
  return canonicalJson(
    model.vars.map((decl) => [
      decl.id,
      encodeValue(decl.domain, state[decl.id]),
    ]),
  );
}

export function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortJson(v)]),
    );
  }
  return value;
}
