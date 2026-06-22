export function normalizePackageNames(
  packageNames: readonly string[],
  pluginId: string,
): readonly string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const name of packageNames) {
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(
        `Invalid plugin ${pluginId}: packageNames must be non-empty strings`,
      );
    }
    if (seen.has(name)) {
      throw new Error(
        `Invalid plugin ${pluginId}: duplicate package name ${name}`,
      );
    }
    seen.add(name);
    normalized.push(name);
  }
  return normalized.sort();
}

export function validatePluginId(
  id: unknown,
  kind: string,
): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`Invalid ${kind}: id must be a non-empty string`);
  }
}

export function validatePluginVersion(
  version: unknown,
  pluginId: string,
  kind: string,
): void {
  if (version !== undefined && typeof version !== "string") {
    throw new Error(`Invalid ${kind} ${pluginId}: version must be a string`);
  }
}

export function validateCommonPluginShape(
  plugin: { id?: unknown; packageNames?: unknown; version?: unknown },
  kind: string,
): void {
  validatePluginId(plugin.id, kind);
  const id = plugin.id;
  validatePluginVersion(plugin.version, id, kind);
  if (
    !Array.isArray(plugin.packageNames) ||
    !plugin.packageNames.every(
      (name) => typeof name === "string" && name.length > 0,
    )
  ) {
    throw new Error(
      `Invalid ${kind} ${id}: packageNames must be non-empty strings`,
    );
  }
  normalizePackageNames(plugin.packageNames, id);
}

export function sortedUnique(
  values: readonly string[],
  kind: string,
): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${kind} ${value}`);
    seen.add(value);
  }
  return [...values].sort();
}
