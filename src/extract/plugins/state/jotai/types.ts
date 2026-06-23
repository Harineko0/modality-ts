import type { Value } from "modality-ts/core";

export type AtomConfigKind =
  | "primitive"
  | "readOnlyDerived"
  | "readWriteDerived"
  | "writeOnlyDerived"
  | "storage"
  | "lazy"
  | "resettable"
  | "defaultResettable"
  | "refreshable"
  | "asyncWrapper"
  | "family"
  | "familyInstance";

export interface JotaiAtomMetadata {
  atomName: string;
  configKind: AtomConfigKind;
  creator?: string;
  storageKey?: string;
  storageKind?: string;
  getOnInit?: boolean;
  resettableInitial?: Value;
  readDependencies?: readonly string[];
  familyFactory?: string;
  familyParam?: string;
  loadableState?: boolean;
  asyncDerived?: boolean;
  warning?: string;
}

export function metadataToRecord(
  metadata: JotaiAtomMetadata,
): Record<string, Value> {
  const record: Record<string, Value> = {
    atomName: metadata.atomName,
    configKind: metadata.configKind,
  };
  if (metadata.creator) record.creator = metadata.creator;
  if (metadata.storageKey) record.storageKey = metadata.storageKey;
  if (metadata.storageKind) record.storageKind = metadata.storageKind;
  if (metadata.getOnInit !== undefined) record.getOnInit = metadata.getOnInit;
  if (metadata.resettableInitial !== undefined)
    record.resettableInitial = metadata.resettableInitial;
  if (metadata.readDependencies)
    record.readDependencies = metadata.readDependencies.join(",");
  if (metadata.familyFactory) record.familyFactory = metadata.familyFactory;
  if (metadata.familyParam) record.familyParam = metadata.familyParam;
  if (metadata.loadableState !== undefined)
    record.loadableState = metadata.loadableState;
  if (metadata.asyncDerived !== undefined)
    record.asyncDerived = metadata.asyncDerived;
  if (metadata.warning) record.warning = metadata.warning;
  return record;
}

export function metadataFromRecord(
  record: Record<string, Value> | undefined,
): JotaiAtomMetadata | undefined {
  if (!record || typeof record.atomName !== "string") return undefined;
  const configKind = record.configKind;
  if (typeof configKind !== "string") return undefined;
  return {
    atomName: record.atomName,
    configKind: configKind as AtomConfigKind,
    ...(typeof record.creator === "string" ? { creator: record.creator } : {}),
    ...(typeof record.storageKey === "string"
      ? { storageKey: record.storageKey }
      : {}),
    ...(typeof record.storageKind === "string"
      ? { storageKind: record.storageKind }
      : {}),
    ...(typeof record.getOnInit === "boolean"
      ? { getOnInit: record.getOnInit }
      : {}),
    ...(record.resettableInitial !== undefined
      ? { resettableInitial: record.resettableInitial as Value }
      : {}),
    ...(typeof record.readDependencies === "string"
      ? { readDependencies: record.readDependencies.split(",") }
      : {}),
    ...(typeof record.familyFactory === "string"
      ? { familyFactory: record.familyFactory }
      : {}),
    ...(typeof record.familyParam === "string"
      ? { familyParam: record.familyParam }
      : {}),
    ...(typeof record.loadableState === "boolean"
      ? { loadableState: record.loadableState }
      : {}),
    ...(typeof record.asyncDerived === "boolean"
      ? { asyncDerived: record.asyncDerived }
      : {}),
    ...(typeof record.warning === "string" ? { warning: record.warning } : {}),
  };
}

export function isResettableKind(kind: AtomConfigKind): boolean {
  return (
    kind === "resettable" ||
    kind === "defaultResettable" ||
    kind === "storage" ||
    kind === "refreshable"
  );
}

export function isWritableAtomKind(kind: AtomConfigKind): boolean {
  return (
    kind === "primitive" ||
    kind === "readWriteDerived" ||
    kind === "storage" ||
    kind === "lazy" ||
    kind === "resettable" ||
    kind === "defaultResettable" ||
    kind === "refreshable" ||
    kind === "familyInstance"
  );
}
