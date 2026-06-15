import type { Value } from "modality-ts/core";

export interface ZustandStoreMetadata {
  storeName: string;
  field: string;
  middleware?: string;
  storageKind?: string;
  immer?: boolean;
  warning?: string;
}

export function metadataToRecord(
  metadata: ZustandStoreMetadata,
): Record<string, Value> {
  const record: Record<string, Value> = {
    storeName: metadata.storeName,
    field: metadata.field,
  };
  if (metadata.middleware) record.middleware = metadata.middleware;
  if (metadata.storageKind) record.storageKind = metadata.storageKind;
  if (metadata.immer !== undefined) record.immer = metadata.immer;
  if (metadata.warning) record.warning = metadata.warning;
  return record;
}

export function metadataFromRecord(
  record: Record<string, Value> | undefined,
): ZustandStoreMetadata | undefined {
  if (!record || typeof record.storeName !== "string") return undefined;
  if (typeof record.field !== "string") return undefined;
  return {
    storeName: record.storeName,
    field: record.field,
    ...(typeof record.middleware === "string"
      ? { middleware: record.middleware }
      : {}),
    ...(typeof record.storageKind === "string"
      ? { storageKind: record.storageKind }
      : {}),
    ...(typeof record.immer === "boolean" ? { immer: record.immer } : {}),
    ...(typeof record.warning === "string" ? { warning: record.warning } : {}),
  };
}
