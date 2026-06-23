export function atomVarId(atomName: string, storeScope?: string): string {
  if (!storeScope) return `atom:${atomName}`;
  return `atom:${atomName}@store:${storeScope}`;
}

export function familyVarId(familyName: string, param: string): string {
  return `atom-family:${familyName}:${sanitizeFamilyParam(param)}`;
}

export function providerStoreScope(componentName: string): string {
  return `provider:${componentName}`;
}

export function sanitizeFamilyParam(param: string): string {
  return JSON.stringify(param);
}

export function atomNameFromVarId(varId: string): string | undefined {
  const match = /^(?:atom|atom-family):([^@]+)/.exec(varId);
  return match?.[1];
}

export function storeScopeFromVarId(varId: string): string | undefined {
  const match = /@store:(.+)$/.exec(varId);
  return match?.[1];
}
