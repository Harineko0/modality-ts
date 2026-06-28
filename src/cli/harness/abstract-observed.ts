import type { AbstractDomain, ModelState, Value } from "modality-ts/core";

export function abstractObservedState(
  domainsById: ReadonlyMap<string, AbstractDomain>,
  observed: ModelState,
): ModelState {
  return Object.fromEntries(
    Object.entries(observed).map(([varId, value]) => {
      const domain = domainsById.get(varId);
      return [varId, domain ? abstractObservedValue(domain, value) : value];
    }),
  );
}

export function abstractObservedValue(
  domain: AbstractDomain,
  value: Value,
): Value {
  switch (domain.kind) {
    case "bool":
      return Boolean(value);
    case "enum":
      return domain.values.includes(String(value)) ? String(value) : value;
    case "boundedInt":
      return abstractBoundedInt(domain, value);
    case "intSet":
      return abstractIntSet(domain, value);
    case "option":
      return value === null || value === undefined
        ? null
        : abstractObservedValue(domain.inner, value);
    case "record":
      return abstractRecord(domain.fields, value);
    case "tagged":
      return abstractTagged(domain, value);
    case "tokens":
      return abstractToken(domain, value);
    case "lengthCat":
      return abstractLengthCat(value);
    case "boundedList":
      return Array.isArray(value)
        ? value
            .slice(0, domain.maxLen)
            .map((item) => abstractObservedValue(domain.inner, item))
        : value;
  }
}

function abstractBoundedInt(
  domain: Extract<AbstractDomain, { kind: "boundedInt" }>,
  value: Value,
): Value {
  const number = toFiniteNumber(value);
  if (number === undefined) return value;
  const integer = Math.trunc(number);
  if (integer >= domain.min && integer <= domain.max) return integer;
  if (domain.overflow === "wrap") {
    const size = domain.max - domain.min + 1;
    if (size <= 0) return value;
    return ((((integer - domain.min) % size) + size) % size) + domain.min;
  }
  return Math.min(domain.max, Math.max(domain.min, integer));
}

function abstractIntSet(
  domain: Extract<AbstractDomain, { kind: "intSet" }>,
  value: Value,
): Value {
  const number = toFiniteNumber(value);
  if (number === undefined || domain.values.length === 0) return value;
  const integer = Math.trunc(number);
  if (domain.values.includes(integer)) return integer;
  return domain.values.reduce((nearest, candidate) =>
    Math.abs(candidate - integer) < Math.abs(nearest - integer)
      ? candidate
      : nearest,
  );
}

function abstractRecord(
  fields: Record<string, AbstractDomain>,
  value: Value,
): Value {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [
      key,
      abstractObservedValue(field, value[key] ?? null),
    ]),
  );
}

function abstractTagged(
  domain: Extract<AbstractDomain, { kind: "tagged" }>,
  value: Value,
): Value {
  if (!isRecord(value)) return value;
  const tagValue = value[domain.tag];
  if (typeof tagValue !== "string") return value;
  const variant = domain.variants[tagValue];
  if (!variant) return value;
  const abstracted = abstractObservedValue(variant, value);
  return isRecord(abstracted)
    ? { ...abstracted, [domain.tag]: tagValue }
    : abstracted;
}

function abstractToken(
  domain: Extract<AbstractDomain, { kind: "tokens" }>,
  value: Value,
): Value {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" && domain.names?.includes(value)) return value;
  if (typeof value === "string" && !domain.names) return value;
  if (domain.count === 1 || domain.names?.length === 1)
    return domain.names?.[0] ?? "tok1";
  return value;
}

function abstractLengthCat(value: Value): Value {
  const length =
    typeof value === "string" || Array.isArray(value)
      ? value.length
      : undefined;
  if (length === undefined) return value;
  if (length === 0) return "0";
  if (length === 1) return "1";
  return "many";
}

function toFiniteNumber(value: Value): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) ? number : undefined;
}

function isRecord(value: Value): value is Record<string, Value> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
