import type { AbstractDomain, Value } from "modality-ts/core";

export interface ReduxSliceMetadata {
  storeName: string;
  sliceKey: string;
  field: string;
  sliceName?: string;
  immer?: boolean;
}

export interface ReduxQueryMetadata {
  apiName: string;
  endpoint: string;
  keyId: string;
  reducerPath: string;
  op: "query" | "mutation" | "lazyQuery";
  payloadDomain: AbstractDomain;
  dynamicKey?: boolean;
}

export interface ReduxMutationMetadata {
  apiName: string;
  endpoint: string;
  siteId: string;
  reducerPath: string;
  payloadDomain: AbstractDomain;
}

export function metadataToRecord(
  metadata: ReduxSliceMetadata,
): Record<string, Value> {
  const record: Record<string, Value> = {
    storeName: metadata.storeName,
    sliceKey: metadata.sliceKey,
    field: metadata.field,
  };
  if (metadata.sliceName) record.sliceName = metadata.sliceName;
  if (metadata.immer !== undefined) record.immer = metadata.immer;
  return record;
}

export function sliceMetadataFromRecord(
  record: Record<string, Value> | undefined,
): ReduxSliceMetadata | undefined {
  if (!record || typeof record.storeName !== "string") return undefined;
  if (typeof record.sliceKey !== "string") return undefined;
  if (typeof record.field !== "string") return undefined;
  return {
    storeName: record.storeName,
    sliceKey: record.sliceKey,
    field: record.field,
    ...(typeof record.sliceName === "string"
      ? { sliceName: record.sliceName }
      : {}),
    ...(typeof record.immer === "boolean" ? { immer: record.immer } : {}),
  };
}

export function queryMetadataToRecord(
  metadata: ReduxQueryMetadata,
): Record<string, Value> {
  const record: Record<string, Value> = {
    apiName: metadata.apiName,
    endpoint: metadata.endpoint,
    keyId: metadata.keyId,
    reducerPath: metadata.reducerPath,
    op: metadata.op,
    payloadDomain: metadata.payloadDomain.kind,
  };
  if (metadata.dynamicKey) record.dynamicKey = metadata.dynamicKey;
  return record;
}

export function queryMetadataFromRecord(
  record: Record<string, Value> | undefined,
): ReduxQueryMetadata | undefined {
  if (!record || typeof record.apiName !== "string") return undefined;
  if (typeof record.endpoint !== "string") return undefined;
  if (typeof record.keyId !== "string") return undefined;
  if (typeof record.reducerPath !== "string") return undefined;
  const op = record.op;
  if (op !== "query" && op !== "mutation" && op !== "lazyQuery") {
    return undefined;
  }
  return {
    apiName: record.apiName,
    endpoint: record.endpoint,
    keyId: record.keyId,
    reducerPath: record.reducerPath,
    op,
    payloadDomain: { kind: "tokens", count: 1 },
    ...(record.dynamicKey === true ? { dynamicKey: true } : {}),
  };
}

export function mutationMetadataToRecord(
  metadata: ReduxMutationMetadata,
): Record<string, Value> {
  return {
    apiName: metadata.apiName,
    endpoint: metadata.endpoint,
    siteId: metadata.siteId,
    reducerPath: metadata.reducerPath,
    payloadDomain: metadata.payloadDomain.kind,
  };
}

export function mutationMetadataFromRecord(
  record: Record<string, Value> | undefined,
): ReduxMutationMetadata | undefined {
  if (!record || typeof record.apiName !== "string") return undefined;
  if (typeof record.endpoint !== "string") return undefined;
  if (typeof record.siteId !== "string") return undefined;
  if (typeof record.reducerPath !== "string") return undefined;
  return {
    apiName: record.apiName,
    endpoint: record.endpoint,
    siteId: record.siteId,
    reducerPath: record.reducerPath,
    payloadDomain: { kind: "tokens", count: 1 },
  };
}
