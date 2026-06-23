export function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_") || "value";
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
