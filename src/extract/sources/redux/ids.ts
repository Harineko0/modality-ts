export { safeId } from "../../engine/ts/ids.js";

export function storeVarId(storeName: string, path: string): string {
  return `redux:${storeName}.${path}`;
}

export function queryVarId(
  apiName: string,
  endpoint: string,
  keyId: string,
  field: string,
): string {
  return `redux-query:${apiName}:${endpoint}:${keyId}:${field}`;
}

export function mutationVarId(
  apiName: string,
  endpoint: string,
  siteId: string,
  field: string,
): string {
  return `redux-mutation:${apiName}:${endpoint}:${siteId}:${field}`;
}

export function pathFromVarId(varId: string): string | undefined {
  const match = /^redux:[^.]+\.(.+)$/.exec(varId);
  return match?.[1];
}

export function storeNameFromVarId(varId: string): string | undefined {
  const match = /^redux:([^.]+)\./.exec(varId);
  return match?.[1];
}

export function queryKeyIdFromVarId(varId: string): string | undefined {
  const match = /^redux-query:[^:]+:[^:]+:([^:]+):/.exec(varId);
  return match?.[1];
}

export function mutationSiteIdFromVarId(varId: string): string | undefined {
  const match = /^redux-mutation:[^:]+:[^:]+:([^:]+):/.exec(varId);
  return match?.[1];
}

export function fieldFromQueryVarId(varId: string): string | undefined {
  const match = /^redux-query:[^:]+:[^:]+:[^:]+:(.+)$/.exec(varId);
  return match?.[1];
}

export function fieldFromMutationVarId(varId: string): string | undefined {
  const match = /^redux-mutation:[^:]+:[^:]+:[^:]+:(.+)$/.exec(varId);
  return match?.[1];
}

export function safeKeyId(key: string): string {
  return (
    key
      .replace(/^\/+/, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "root"
  );
}
