import type { AbstractDomain, ExprIR, StateVarScope, Value } from "./types.js";

export const UNMOUNTED = "__modality_unmounted__";

export function isLocalScopedScope(scope: StateVarScope): boolean {
  return scope.kind === "mount-local";
}

export function mountGuardForScope(scope: StateVarScope): ExprIR | undefined {
  switch (scope.kind) {
    case "global":
      return undefined;
    case "mount-local":
      return scope.when;
  }
}

const CARDINALITY_CAP = Number.MAX_SAFE_INTEGER;

/** Cardinality above which havoc/multi-initial over numeric domains emits a warning. */
export const WIDE_NUMERIC_DOMAIN_THRESHOLD = 256;

function clamp(n: number): number {
  return Math.min(n, CARDINALITY_CAP);
}

export function domainCardinality(domain: AbstractDomain): number {
  switch (domain.kind) {
    case "bool":
      return 2;
    case "enum":
      return clamp(domain.values.length);
    case "boundedInt":
      return clamp(domain.max - domain.min + 1);
    case "intSet":
      return clamp(domain.values.length);
    case "option":
      return clamp(1 + domainCardinality(domain.inner));
    case "record": {
      const entries = Object.entries(domain.fields);
      if (entries.length === 0) return 1;
      return entries.reduce(
        (acc, [, d]) => clamp(acc * domainCardinality(d)),
        1,
      );
    }
    case "tagged":
      return clamp(
        Object.values(domain.variants).reduce(
          (acc, d) => clamp(acc + domainCardinality(d)),
          0,
        ),
      );
    case "tokens":
      return clamp(domain.names?.length ?? domain.count);
    case "lengthCat":
      return 3;
    case "boundedList": {
      const inner = domainCardinality(domain.inner);
      let sum = 1;
      let power = 1;
      for (let len = 1; len <= domain.maxLen; len += 1) {
        power = clamp(power * inner);
        sum = clamp(sum + power);
      }
      return sum;
    }
  }
}

export function enumerateDomain(domain: AbstractDomain): Value[] {
  switch (domain.kind) {
    case "bool":
      return [false, true];
    case "enum":
      return [...domain.values];
    case "boundedInt":
      return Array.from(
        { length: domain.max - domain.min + 1 },
        (_, i) => domain.min + i,
      );
    case "intSet":
      return [...domain.values];
    case "option":
      return [null, ...enumerateDomain(domain.inner)];
    case "record": {
      const entries = Object.entries(domain.fields);
      return cartesian(entries.map(([, d]) => enumerateDomain(d))).map(
        (values) =>
          Object.fromEntries(entries.map(([key], i) => [key, values[i]])),
      );
    }
    case "tagged": {
      return Object.entries(domain.variants).flatMap(
        ([tagValue, recordDomain]) => {
          if (recordDomain.kind !== "record") {
            throw new Error(
              `Tagged variant ${tagValue} must be a record domain`,
            );
          }
          return enumerateDomain(recordDomain).map((v) => ({
            ...(v as object),
            [domain.tag]: tagValue,
          }));
        },
      );
    }
    case "tokens":
      return tokenNames(domain);
    case "lengthCat":
      return ["0", "1", "many"];
    case "boundedList": {
      const itemValues = enumerateDomain(domain.inner);
      const lists: Value[] = [[]];
      for (let len = 1; len <= domain.maxLen; len += 1) {
        for (const list of cartesian(
          Array.from({ length: len }, () => itemValues),
        )) {
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
      return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= domain.min &&
        value <= domain.max
      );
    case "intSet":
      return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        domain.values.includes(value)
      );
    case "option":
      return value === null || validateValue(domain.inner, value);
    case "record":
      return (
        isRecord(value) &&
        Object.entries(domain.fields).every(([k, d]) =>
          validateValue(d, value[k]),
        )
      );
    case "tagged": {
      if (!isRecord(value) || typeof value[domain.tag] !== "string")
        return false;
      const tagValue = value[domain.tag] as string;
      return (
        Object.hasOwn(domain.variants, tagValue) &&
        validateValue(domain.variants[tagValue], value)
      );
    }
    case "tokens":
      return typeof value === "string" && tokenNames(domain).includes(value);
    case "lengthCat":
      return value === "0" || value === "1" || value === "many";
    case "boundedList":
      return (
        Array.isArray(value) &&
        value.length <= domain.maxLen &&
        value.every((v) => validateValue(domain.inner, v))
      );
  }
}

export function tokenNames(
  domain: Extract<AbstractDomain, { kind: "tokens" }>,
): string[] {
  return domain.names
    ? [...domain.names]
    : Array.from({ length: domain.count }, (_, i) => `tok${i + 1}`);
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
    case "intSet":
      return `intSet(${domain.values.join(",")})`;
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

export function collectTokenDomainPaths(domain: AbstractDomain): string[] {
  const paths: string[] = [];

  function collect(current: AbstractDomain, prefix: string): void {
    switch (current.kind) {
      case "tokens":
        paths.push(prefix);
        break;
      case "bool":
      case "enum":
      case "boundedInt":
      case "intSet":
      case "lengthCat":
        break;
      case "option":
        collect(current.inner, prefix);
        break;
      case "record":
        for (const [field, fieldDomain] of Object.entries(current.fields)) {
          collect(fieldDomain, prefix ? `${prefix}.${field}` : field);
        }
        break;
      case "tagged":
        for (const [variant, variantDomain] of Object.entries(
          current.variants,
        )) {
          collect(
            variantDomain,
            prefix ? `${prefix}#${variant}` : `#${variant}`,
          );
        }
        break;
      case "boundedList":
        collect(current.inner, `${prefix}[]`);
        break;
    }
  }

  collect(domain, "");
  return [...new Set(paths)].sort();
}

function cartesian<T>(sets: readonly (readonly T[])[]): T[][] {
  return sets.reduce<T[][]>(
    (acc, set) => acc.flatMap((prefix) => set.map((item) => [...prefix, item])),
    [[]],
  );
}

function isRecord(value: Value): value is Record<string, Value> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function exceedsWideCardinalityThreshold(
  domain: AbstractDomain,
): boolean {
  return domainCardinality(domain) > WIDE_NUMERIC_DOMAIN_THRESHOLD;
}

export function exceedsWideNumericThreshold(domain: AbstractDomain): boolean {
  switch (domain.kind) {
    case "boundedInt":
    case "intSet":
      return domainCardinality(domain) > WIDE_NUMERIC_DOMAIN_THRESHOLD;
    case "record":
      return Object.values(domain.fields).some(exceedsWideNumericThreshold);
    case "option":
      return exceedsWideNumericThreshold(domain.inner);
    case "tagged":
      return Object.values(domain.variants).some(exceedsWideNumericThreshold);
    case "boundedList":
      return exceedsWideNumericThreshold(domain.inner);
    default:
      return false;
  }
}
