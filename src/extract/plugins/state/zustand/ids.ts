export { safeId } from "../../../engine/ts/ids.js";

export function storeVarId(storeName: string, field: string): string {
  return `zustand:${storeName}.${field}`;
}

export function fieldFromVarId(varId: string): string | undefined {
  const match = /^zustand:[^.]+\.(.+)$/.exec(varId);
  return match?.[1];
}

export function storeNameFromVarId(varId: string): string | undefined {
  const match = /^zustand:([^.]+)\./.exec(varId);
  return match?.[1];
}
