import type { Value } from "modality-ts/core";

export function readPath(
  value: Value | undefined,
  path: readonly string[],
): Value {
  let current: unknown = value;
  for (const segment of path) {
    if (Array.isArray(current)) current = current[Number(segment)];
    else if (current && typeof current === "object")
      current = (current as Record<string, Value>)[segment];
    else return undefined as unknown as Value;
  }
  return current as Value;
}

export function writePath(
  target: Value,
  path: readonly string[],
  value: Value,
): Value {
  if (path.length === 0) return value;
  const [head, ...tail] = path;
  if (Array.isArray(target)) {
    const copy = [...target];
    copy[Number(head)] = writePath(copy[Number(head)], tail, value);
    return copy;
  }
  const base = target && typeof target === "object" ? target : {};
  return {
    ...base,
    [head]: writePath((base as Record<string, Value>)[head], tail, value),
  };
}
