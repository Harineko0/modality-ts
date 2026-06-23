import { safeId } from "../../../engine/ts/ids.js";

export function safeKeyId(key: string): string {
  return (
    key
      .replace(/^\/+/, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "root"
  );
}

export function queryVarId(
  keyId: string,
  field:
    | "data"
    | "status"
    | "fetchStatus"
    | "stale"
    | "invalidated"
    | "failureCount"
    | "active"
    | "isFetching",
): string {
  return `tanstack-query:${keyId}:${field}`;
}

export function mutationVarId(
  mutationId: string,
  field:
    | "status"
    | "data"
    | "error"
    | "variables"
    | "failureCount"
    | "isMutating",
): string {
  return `tanstack-mutation:${mutationId}:${field}`;
}

export function queryKeyIdFromVarId(varId: string): string | undefined {
  const match = /^tanstack-query:([^:]+):/.exec(varId);
  return match?.[1];
}

export function mutationIdFromVarId(varId: string): string | undefined {
  const match = /^tanstack-mutation:([^:]+):/.exec(varId);
  return match?.[1];
}

export function fieldFromQueryVarId(varId: string): string | undefined {
  const match = /^tanstack-query:[^:]+:(.+)$/.exec(varId);
  return match?.[1];
}

export function fieldFromMutationVarId(varId: string): string | undefined {
  const match = /^tanstack-mutation:[^:]+:(.+)$/.exec(varId);
  return match?.[1];
}

export function mutationSiteId(
  fileName: string,
  line: number,
  column: number,
): string {
  return safeId(`${fileName}:${line}:${column}`);
}

export function filterAggregateId(
  filterId: string,
  kind: "isFetching" | "isMutating",
): string {
  return `tanstack-query:${filterId}:${kind}`;
}
