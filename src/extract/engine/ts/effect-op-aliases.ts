import { resolve } from "node:path";

export type EffectOpAliases = ReadonlyMap<
  string,
  ReadonlyMap<string, string>
>;

export function normalizeSourcePath(fileName: string): string {
  return resolve(fileName).split("\\").join("/");
}

export function canonicalEffectOp(
  op: string,
  fileName: string,
  aliases: EffectOpAliases,
): string {
  return aliases.get(normalizeSourcePath(fileName))?.get(op) ?? op;
}

export function allEffectOpAliasLocalNames(
  aliases: EffectOpAliases,
): string[] {
  const names = new Set<string>();
  for (const perFile of aliases.values()) {
    for (const local of perFile.keys()) names.add(local);
  }
  return [...names];
}

export function allEffectOpAliasCanonicalIds(
  aliases: EffectOpAliases,
): string[] {
  const ids = new Set<string>();
  for (const perFile of aliases.values()) {
    for (const canonical of perFile.values()) ids.add(canonical);
  }
  return [...ids];
}

export function isEffectOpAliasesPopulated(
  aliases: EffectOpAliases | undefined,
): aliases is EffectOpAliases {
  if (!aliases || aliases.size === 0) return false;
  for (const perFile of aliases.values()) {
    if (perFile.size > 0) return true;
  }
  return false;
}
