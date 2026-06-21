import type {
  StateVarDecl,
  TemplateFragment,
  Transition,
  Value,
} from "modality-ts/core";
import type { SourceDecl } from "modality-ts/extract/engine/spi";
import { queryVarId, mutationVarId } from "./ids.js";
import {
  mutationMetadataFromRecord,
  queryMetadataFromRecord,
} from "./types.js";

export function templateForReduxDecl(decl: SourceDecl): TemplateFragment {
  if (decl.kind === "redux-query/useMutation") {
    const metadata = mutationMetadataFromRecord(decl.metadata);
    if (!metadata) return { vars: [], transitions: [] };
    return createReduxMutationTemplate(metadata);
  }
  const metadata = queryMetadataFromRecord(decl.metadata);
  if (!metadata) return { vars: [], transitions: [] };
  return createReduxQueryTemplate(metadata);
}

export function createReduxQueryTemplate(
  metadata: NonNullable<ReturnType<typeof queryMetadataFromRecord>>,
): TemplateFragment {
  const vars: StateVarDecl[] = [
    queryVar("status", metadata, "pending"),
    queryVar("data", metadata, null),
    queryVar("error", metadata, false),
    queryVar("isFetching", metadata, false),
    queryVar("isSuccess", metadata, false),
    queryVar("isError", metadata, false),
  ];
  const source =
    declOriginFile(metadata) !== undefined
      ? [{ file: declOriginFile(metadata)! }]
      : [];
  const statusVar = queryVarId(metadata.apiName, metadata.endpoint, metadata.keyId, "status");
  const dataVar = queryVarId(metadata.apiName, metadata.endpoint, metadata.keyId, "data");
  const fetchVar = queryVarId(
    metadata.apiName,
    metadata.endpoint,
    metadata.keyId,
    "isFetching",
  );
  const transitions: Transition[] = [
    {
      id: `redux-query:${metadata.apiName}:${metadata.endpoint}:fetch`,
      cls: "env",
      label: { kind: "internal", text: `fetch ${metadata.endpoint}` },
      source,
      guard: { kind: "lit", value: true },
      effect: {
        kind: "seq",
        effects: [
          { kind: "assign", var: statusVar, expr: { kind: "lit", value: "pending" } },
          { kind: "assign", var: fetchVar, expr: { kind: "lit", value: true } },
        ],
      },
      reads: [],
      writes: [statusVar, fetchVar],
      confidence: "over-approx",
    },
    {
      id: `redux-query:${metadata.apiName}:${metadata.endpoint}:resolve`,
      cls: "env",
      label: { kind: "internal", text: `resolve ${metadata.endpoint}` },
      source,
      guard: { kind: "lit", value: true },
      effect: {
        kind: "seq",
        effects: [
          { kind: "assign", var: statusVar, expr: { kind: "lit", value: "fulfilled" } },
          { kind: "assign", var: dataVar, expr: { kind: "freshToken", domainOf: dataVar } },
          { kind: "assign", var: fetchVar, expr: { kind: "lit", value: false } },
        ],
      },
      reads: [],
      writes: [statusVar, dataVar, fetchVar],
      confidence: "over-approx",
    },
  ];
  return { vars, transitions };
}

export function createReduxMutationTemplate(
  metadata: NonNullable<ReturnType<typeof mutationMetadataFromRecord>>,
): TemplateFragment {
  const vars: StateVarDecl[] = [
    mutationVarDecl("status", metadata, "idle"),
    mutationVarDecl("data", metadata, null),
    mutationVarDecl("error", metadata, false),
    mutationVarDecl("variables", metadata, null),
  ];
  const statusVar = mutationVarId(
    metadata.apiName,
    metadata.endpoint,
    metadata.siteId,
    "status",
  );
  const transitions: Transition[] = [
    {
      id: `redux-mutation:${metadata.apiName}:${metadata.endpoint}:pending`,
      cls: "env",
      label: { kind: "internal", text: `mutate ${metadata.endpoint}` },
      source: [],
      guard: { kind: "lit", value: true },
      effect: {
        kind: "assign",
        var: statusVar,
        expr: { kind: "lit", value: "pending" },
      },
      reads: [],
      writes: [statusVar],
      confidence: "over-approx",
    },
  ];
  return { vars, transitions };
}

function queryVar(
  field: string,
  metadata: NonNullable<ReturnType<typeof queryMetadataFromRecord>>,
  initial: Value,
): StateVarDecl {
  const id = queryVarId(metadata.apiName, metadata.endpoint, metadata.keyId, field);
  return {
    id,
    domain:
      field === "status"
        ? { kind: "enum", values: ["pending", "fulfilled", "rejected"] }
        : field === "data"
          ? metadata.payloadDomain
          : { kind: "bool" },
    origin: "library-template",
    scope: { kind: "global" },
    initial,
  };
}

function mutationVarDecl(
  field: string,
  metadata: NonNullable<ReturnType<typeof mutationMetadataFromRecord>>,
  initial: Value,
): StateVarDecl {
  const id = mutationVarId(
    metadata.apiName,
    metadata.endpoint,
    metadata.siteId,
    field,
  );
  return {
    id,
    domain:
      field === "status"
        ? { kind: "enum", values: ["idle", "pending", "fulfilled", "rejected"] }
        : metadata.payloadDomain,
    origin: "library-template",
    scope: { kind: "global" },
    initial,
  };
}

function declOriginFile(
  _metadata: NonNullable<ReturnType<typeof queryMetadataFromRecord>>,
): string | undefined {
  return undefined;
}
