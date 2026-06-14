import type { AbstractDomain, Value } from "./types.js";

export const UNMOUNTED = "__modality_unmounted__";

export function enumerateDomain(domain: AbstractDomain): Value[] {
  switch (domain.kind) {
    case "bool":
      return [false, true];
    case "enum":
      return [...domain.values];
    case "boundedInt":
      return Array.from({ length: domain.max - domain.min + 1 }, (_, i) => domain.min + i);
    case "option":
      return [null, ...enumerateDomain(domain.inner)];
    case "record": {
      const entries = Object.entries(domain.fields);
      return cartesian(entries.map(([, d]) => enumerateDomain(d))).map((values) =>
        Object.fromEntries(entries.map(([key], i) => [key, values[i]]))
      );
    }
    case "tagged": {
      return Object.entries(domain.variants).flatMap(([tagValue, recordDomain]) => {
        if (recordDomain.kind !== "record") {
          throw new Error(`Tagged variant ${tagValue} must be a record domain`);
        }
        return enumerateDomain(recordDomain).map((v) => ({ ...(v as object), [domain.tag]: tagValue }));
      });
    }
    case "tokens":
      return tokenNames(domain);
    case "lengthCat":
      return ["0", "1", "many"];
    case "boundedList": {
      const itemValues = enumerateDomain(domain.inner);
      const lists: Value[] = [[]];
      for (let len = 1; len <= domain.maxLen; len += 1) {
        for (const list of cartesian(Array.from({ length: len }, () => itemValues))) {
          lists.push(list);
        }
      }
      return lists;
    }
  }
}

export function validateValue(domain: AbstractDomain, value: Value): boolean {
  if (value === UNMOUNTED) return true;
  switch (domain.kind) {
    case "bool":
      return typeof value === "boolean";
    case "enum":
      return typeof value === "string" && domain.values.includes(value);
    case "boundedInt":
      return typeof value === "number" && Number.isInteger(value) && value >= domain.min && value <= domain.max;
    case "option":
      return value === null || validateValue(domain.inner, value);
    case "record":
      return isRecord(value) && Object.entries(domain.fields).every(([k, d]) => validateValue(d, value[k]));
    case "tagged":
      if (!isRecord(value) || typeof value[domain.tag] !== "string") return false;
      const tagValue = value[domain.tag] as string;
      return (
        Object.hasOwn(domain.variants, tagValue) &&
        validateValue(domain.variants[tagValue], value)
      );
    case "tokens":
      return typeof value === "string" && tokenNames(domain).includes(value);
    case "lengthCat":
      return value === "0" || value === "1" || value === "many";
    case "boundedList":
      return Array.isArray(value) && value.length <= domain.maxLen && value.every((v) => validateValue(domain.inner, v));
  }
}

export function tokenNames(domain: Extract<AbstractDomain, { kind: "tokens" }>): string[] {
  return domain.names ? [...domain.names] : Array.from({ length: domain.count }, (_, i) => `tok${i + 1}`);
}

export function domainFingerprint(domain: AbstractDomain): string {
  switch (domain.kind) {
    case "bool":
    case "lengthCat":
      return domain.kind;
    case "enum":
      return `enum(${domain.values.join("|")})`;
    case "boundedInt":
      return `int(${domain.min},${domain.max})`;
    case "option":
      return `option(${domainFingerprint(domain.inner)})`;
    case "record":
      return `record(${Object.entries(domain.fields)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${domainFingerprint(v)}`)
        .join(",")})`;
    case "tagged":
      return `tagged(${domain.tag}:${Object.entries(domain.variants)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}:${domainFingerprint(v)}`)
        .join(",")})`;
    case "tokens":
      return `tokens(${domain.count})`;
    case "boundedList":
      return `list(${domain.maxLen}:${domainFingerprint(domain.inner)})`;
  }
}

function cartesian<T>(sets: readonly (readonly T[])[]): T[][] {
  return sets.reduce<T[][]>((acc, set) => acc.flatMap((prefix) => set.map((item) => [...prefix, item])), [[]]);
}

function isRecord(value: Value): value is Record<string, Value> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
