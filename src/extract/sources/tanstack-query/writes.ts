import type { EffectIR, Value } from "modality-ts/core";
import type {
  CallSite,
  ExtractionWarning,
  M0Ctx,
  WriteChannel,
} from "modality-ts/extract/engine/spi";
import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { modelSlackCaveat } from "../../engine/ts/caveats.js";
import { semanticSourceFileFor } from "../../engine/ts/semantic-source-file.js";
import { discoverTanstackQueryDetailed } from "./discover.js";
import {
  mutationFiltersFromExpression,
  queryFiltersFromExpression,
  queryKeyFromExpression,
  queryKeysMatch,
} from "./filters.js";
import { filterAggregateId, mutationVarId, queryVarId } from "./ids.js";
import { resolveTanstackQueryImports } from "./imports.js";
import { queryMetadataFromRecord } from "./types.js";

const QUERY_CLIENT_METHODS = new Set([
  "invalidateQueries",
  "refetchQueries",
  "cancelQueries",
  "removeQueries",
  "resetQueries",
  "setQueryData",
  "setQueriesData",
  "fetchQuery",
  "prefetchQuery",
  "ensureQueryData",
]);

export function discoverTanstackQuerySafetyWarnings(
  sourceText: string,
  fileName = "App.tsx",
  types?: SemanticTypeContext,
): ExtractionWarning[] {
  return discoverTanstackQueryWritesDetailed(sourceText, fileName, types)
    .warnings;
}

export function discoverTanstackQueryWriteChannels(
  sourceText: string,
  fileName = "App.tsx",
  types?: SemanticTypeContext,
): WriteChannel[] {
  return discoverTanstackQueryWritesDetailed(sourceText, fileName, types)
    .channels;
}

export interface TanstackQueryWriteDiscovery {
  channels: WriteChannel[];
  warnings: ExtractionWarning[];
}

export function discoverTanstackQueryWritesDetailed(
  sourceText: string,
  fileName = "App.tsx",
  types?: SemanticTypeContext,
): TanstackQueryWriteDiscovery {
  const source = semanticSourceFileFor(
    sourceText,
    fileName,
    types,
    ts.ScriptKind.TSX,
  );
  const imports = resolveTanstackQueryImports(source, types);
  const discovery = discoverTanstackQueryDetailed(sourceText, fileName, types);
  const channels: WriteChannel[] = [];
  const warnings: ExtractionWarning[] = [...discovery.warnings];
  const knownKeys = new Map<string, string>();
  for (const decl of discovery.decls) {
    const metadata = queryMetadataFromRecord(decl.metadata);
    if (metadata)
      knownKeys.set(metadata.queryKey.id, metadata.queryKey.display);
  }

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression)
    ) {
      const hookName = imports.queryHooks.get(node.initializer.expression.text);
      if (hookName === "useQuery" || hookName === "useSuspenseQuery") {
        const optionsExpr = node.initializer.arguments[0];
        const key =
          optionsExpr && ts.isObjectLiteralExpression(optionsExpr)
            ? queryKeyFromOptions(optionsExpr)
            : undefined;
        if (key) {
          for (const element of node.name.elements) {
            if (!ts.isIdentifier(element.name)) continue;
            const property =
              element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text
                : element.name.text;
            mapQueryReadChannel(
              channels,
              key.id,
              property,
              element.name.text,
              fileName,
              source,
              node,
            );
          }
        }
      }
      const mutationHook = imports.mutationHooks.get(
        node.initializer.expression.text,
      );
      if (mutationHook === "useMutation") {
        const pos = lineAndColumn(source, node);
        const mutationId = `mutation:${pos.line}:${pos.column}`;
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const property =
            element.propertyName && ts.isIdentifier(element.propertyName)
              ? element.propertyName.text
              : element.name.text;
          if (property === "mutate" || property === "mutateAsync") {
            channels.push({
              id: `tanstack-mutation:${mutationId}.${property}`,
              varId: mutationVarId(mutationId, "status"),
              symbolName: element.name.text,
              source: { file: fileName, ...pos },
            });
          }
          if (property === "reset") {
            channels.push({
              id: `tanstack-mutation:${mutationId}.reset`,
              varId: mutationVarId(mutationId, "status"),
              symbolName: element.name.text,
              source: { file: fileName, ...pos },
            });
          }
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      QUERY_CLIENT_METHODS.has(node.expression.name.text) &&
      ts.isIdentifier(node.expression.expression) &&
      discovery.queryClientBindings.has(node.expression.expression.text)
    ) {
      const method = node.expression.name.text;
      const clientName = node.expression.expression.text;
      const filter =
        method === "setQueryData"
          ? undefined
          : queryFiltersFromExpression(node.arguments[0]);
      const directKey =
        method === "setQueryData" ||
        method === "fetchQuery" ||
        method === "prefetchQuery" ||
        method === "ensureQueryData"
          ? queryKeyFromExpression(node.arguments[0])
          : undefined;
      if (filter?.hasPredicate) {
        warnings.push(predicateWarning(fileName, source, node));
      }
      const matchedKeyIds = matchKeyIds(knownKeys, directKey, filter);
      for (const keyId of matchedKeyIds) {
        channels.push({
          id: `tanstack-query:${clientName}.${method}.${keyId}`,
          varId: queryVarId(keyId, methodEffectVar(method)),
          symbolName: `${clientName}.${method}`,
          source: { file: fileName, ...lineAndColumn(source, node) },
        });
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      imports.aggregateHooks.get(node.expression.text) === "useIsFetching"
    ) {
      const filter = queryFiltersFromExpression(node.arguments[0]);
      const filterId = filter?.id ?? "all";
      channels.push({
        id: `tanstack-query:aggregate.isFetching.${filterId}`,
        varId: filterAggregateId(filterId, "isFetching"),
        symbolName: "useIsFetching",
        source: { file: fileName, ...lineAndColumn(source, node) },
      });
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      imports.mutationHooks.get(node.expression.text) === "useIsMutating"
    ) {
      const filter = mutationFiltersFromExpression(node.arguments[0]);
      const filterId = filter?.id ?? "all";
      channels.push({
        id: `tanstack-query:aggregate.isMutating.${filterId}`,
        varId: filterAggregateId(filterId, "isMutating"),
        symbolName: "useIsMutating",
        source: { file: fileName, ...lineAndColumn(source, node) },
      });
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  return { channels, warnings };
}

function mapQueryReadChannel(
  channels: WriteChannel[],
  keyId: string,
  property: string,
  symbolName: string,
  fileName: string,
  source: ts.SourceFile,
  node: ts.Node,
): void {
  const pos = lineAndColumn(source, node);
  const readFields: Record<
    string,
    "data" | "status" | "fetchStatus" | "stale"
  > = {
    data: "data",
    status: "status",
    error: "status",
    fetchStatus: "fetchStatus",
    isFetching: "fetchStatus",
    isPending: "status",
    isLoading: "status",
    isSuccess: "status",
    isError: "status",
    isStale: "stale",
    isRefetching: "fetchStatus",
    isPaused: "fetchStatus",
  };
  const field = readFields[property];
  if (field) {
    channels.push({
      id: `tanstack-query:${keyId}.${property}.read`,
      varId: queryVarId(keyId, field),
      symbolName,
      source: { file: fileName, ...pos },
    });
  }
  if (property === "refetch") {
    channels.push({
      id: `tanstack-query:${keyId}.refetch`,
      varId: queryVarId(keyId, "fetchStatus"),
      symbolName,
      source: { file: fileName, ...pos },
    });
  }
}

function queryKeyFromOptions(
  options: ts.ObjectLiteralExpression,
): { id: string } | undefined {
  for (const prop of options.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      ts.isIdentifier(prop.name) &&
      prop.name.text === "queryKey"
    ) {
      const key = queryKeyFromExpression(prop.initializer);
      if (key) return key;
    }
  }
  return undefined;
}

function matchKeyIds(
  knownKeys: ReadonlyMap<string, string>,
  directKey: ReturnType<typeof queryKeyFromExpression> | undefined,
  filter: ReturnType<typeof queryFiltersFromExpression> | undefined,
): string[] {
  if (directKey) return [directKey.id];
  const ids: string[] = [];
  for (const [id, display] of knownKeys) {
    if (queryKeysMatch(filter?.queryKey, display, filter?.exact)) {
      ids.push(id);
    }
  }
  return ids.length > 0 ? ids : ["unknown"];
}

function methodEffectVar(
  method: string,
): "data" | "status" | "fetchStatus" | "stale" | "invalidated" {
  switch (method) {
    case "setQueryData":
    case "setQueriesData":
      return "data";
    case "invalidateQueries":
      return "stale";
    case "removeQueries":
    case "resetQueries":
      return "status";
    case "cancelQueries":
      return "fetchStatus";
    default:
      return "fetchStatus";
  }
}

function predicateWarning(
  fileName: string,
  source: ts.SourceFile,
  node: ts.Node,
): ExtractionWarning {
  const src = { file: fileName, ...lineAndColumn(source, node) };
  const caveat = modelSlackCaveat(
    "tanstack-query:predicate-filter",
    "TanStack Query predicate filter is unsupported; matched query data is over-approximated",
    src,
    "over-approx",
  );
  return {
    message: caveat.reason,
    source: src,
    caveat,
    confidence: "over-approx",
    producer: { kind: "state-source", id: "tanstack-query" },
  };
}

export function summarizeTanstackQueryWrite(
  call: CallSite,
  _ctx: M0Ctx,
): EffectIR | "unsupported" {
  const methodMatch =
    /\.(invalidateQueries|setQueryData|setQueriesData|removeQueries|resetQueries|refetchQueries|cancelQueries|fetchQuery|prefetchQuery|ensureQueryData)$/.exec(
      call.callee,
    );
  if (!methodMatch) return "unsupported";
  const method = methodMatch[1]!;
  if (method === "setQueryData" || method === "setQueriesData") {
    const value = call.arguments[1];
    const keyId = queryKeyIdFromCallArg(call.arguments[0]);
    if (
      (typeof value === "string" &&
        !value.includes("=>") &&
        !value.startsWith("function")) ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      return {
        kind: "seq",
        effects: [
          {
            kind: "assign",
            var: queryVarId(keyId, "data"),
            expr: { kind: "lit", value: value as Value },
          },
          {
            kind: "assign",
            var: queryVarId(keyId, "status"),
            expr: { kind: "lit", value: "success" },
          },
          {
            kind: "assign",
            var: queryVarId(keyId, "stale"),
            expr: { kind: "lit", value: false },
          },
        ],
      };
    }
    return { kind: "havoc", var: queryVarId("unknown", "data") };
  }
  if (method === "invalidateQueries") {
    return {
      kind: "seq",
      effects: [
        {
          kind: "assign",
          var: queryVarId("unknown", "stale"),
          expr: { kind: "lit", value: true },
        },
        {
          kind: "assign",
          var: queryVarId("unknown", "invalidated"),
          expr: { kind: "lit", value: true },
        },
      ],
    };
  }
  if (method === "removeQueries") {
    return {
      kind: "seq",
      effects: [
        {
          kind: "assign",
          var: queryVarId("unknown", "data"),
          expr: { kind: "lit", value: null },
        },
        {
          kind: "assign",
          var: queryVarId("unknown", "status"),
          expr: { kind: "lit", value: "pending" },
        },
      ],
    };
  }
  if (method === "resetQueries" || method === "refetchQueries") {
    return {
      kind: "assign",
      var: queryVarId("unknown", "fetchStatus"),
      expr: { kind: "lit", value: "fetching" },
    };
  }
  if (method === "cancelQueries") {
    return {
      kind: "assign",
      var: queryVarId("unknown", "fetchStatus"),
      expr: { kind: "lit", value: "idle" },
    };
  }
  if (method === "refetch") {
    return {
      kind: "assign",
      var: queryVarId("unknown", "fetchStatus"),
      expr: { kind: "lit", value: "fetching" },
    };
  }
  return "unsupported";
}

function lineAndColumn(
  source: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}

function queryKeyIdFromCallArg(arg: unknown): string {
  if (typeof arg === "string")
    return arg.replace(/[^A-Za-z0-9]+/g, "_") || "root";
  if (Array.isArray(arg)) {
    return arg
      .map((part) => String(part))
      .join(":")
      .replace(/[^A-Za-z0-9:]+/g, "_");
  }
  return "unknown";
}
