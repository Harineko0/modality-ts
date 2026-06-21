function isValidIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/u.test(value);
}

export function varHandleNaming(
  varId: string,
): { exportName: string; path: string[] } | undefined {
  const colon = varId.indexOf(":");
  if (colon < 0) return undefined;
  const rest = varId.slice(colon + 1);
  if (!rest) return undefined;
  const segments = rest.split(/[.:]/u).filter((segment) => segment.length > 0);
  const exportName = segments[0];
  if (!exportName || !isValidIdentifier(exportName)) return undefined;
  return { exportName, path: segments.slice(1) };
}
