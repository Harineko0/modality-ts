import type {
  ExtractionWarning,
  SourceDecl,
  TypePlugin,
} from "modality-ts/extract/engine/spi";
import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { modelSlackCaveat } from "../../../lang/ts/driver/caveats.js";
import { compilerBackedTypeAliases } from "../../../lang/ts/driver/domains.js";
import { collectSemanticNamedImports } from "../../../lang/ts/driver/semantic-imports.js";
import { semanticSourceFileFor } from "../../../lang/ts/driver/semantic-source-file.js";
import {
  domainFromInitialData,
  inferInfinitePageDomain,
  inferMutationDataDomain,
  inferMutationVariablesDomain,
  inferQueryPayloadDomain,
} from "./domains.js";
import { queryKeyFromExpression } from "./filters.js";
import { mutationSiteId } from "./ids.js";
import {
  isMutationHookCall,
  isOptionsHelperCall,
  isQueryHookCall,
  resolveTanstackQueryImports,
  TANSTACK_QUERY_MODULE,
} from "./imports.js";
import type { MutationOptionsMetadata, QueryOptionsMetadata } from "./types.js";
import { metadataToRecord } from "./types.js";

export interface TanstackQueryDiscovery {
  decls: SourceDecl[];
  warnings: ExtractionWarning[];
  queryClientBindings: Set<string>;
  knownQueryKeyIds: Set<string>;
}

export function discoverTanstackQueryHooks(
  sourceText: string,
  fileName = "App.tsx",
  types?: SemanticTypeContext,
  typePlugins?: readonly TypePlugin[],
): SourceDecl[] {
  return discoverTanstackQueryDetailed(sourceText, fileName, types, typePlugins)
    .decls;
}

export function discoverTanstackQueryDetailed(
  sourceText: string,
  fileName = "App.tsx",
  types?: SemanticTypeContext,
  typePlugins?: readonly TypePlugin[],
): TanstackQueryDiscovery {
  const source = semanticSourceFileFor(
    sourceText,
    fileName,
    types,
    ts.ScriptKind.TSX,
  );
  const imports = resolveTanstackQueryImports(source, types);
  if (
    imports.queryHooks.size === 0 &&
    imports.mutationHooks.size === 0 &&
    imports.aggregateHooks.size === 0 &&
    imports.clients.size === 0
  ) {
    return emptyDiscovery();
  }

  const typeAliases = compilerBackedTypeAliases(source, types);
  const decls: SourceDecl[] = [];
  const warnings: ExtractionWarning[] = [];
  const queryClientBindings = new Set<string>();
  const knownQueryKeyIds = new Set<string>();
  const localOptions = new Map<string, ts.ObjectLiteralExpression>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      if (
        ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        imports.clients.get(node.initializer.expression.text) ===
          "useQueryClient"
      ) {
        queryClientBindings.add(node.name.text);
      }
      if (
        ts.isNewExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) &&
        imports.clients.get(node.initializer.expression.text) === "QueryClient"
      ) {
        queryClientBindings.add(node.name.text);
      }
      const optionsExpr = resolveOptionsInitializer(
        node.initializer,
        imports.optionsHelpers,
        localOptions,
      );
      if (optionsExpr && ts.isObjectLiteralExpression(optionsExpr)) {
        localOptions.set(node.name.text, optionsExpr);
      }
    }

    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const hookKind = isQueryHookCall(node, imports.queryHooks);
      if (hookKind && isModeledQueryHook(hookKind)) {
        const optionsExpr = resolveHookOptions(
          node,
          imports.optionsHelpers,
          localOptions,
        );
        const metadata = parseQueryOptions(
          optionsExpr,
          hookKind,
          node.typeArguments?.[0],
          typeAliases,
          types,
          source,
          typePlugins,
        );
        if (metadata) {
          if (metadata.queryKey.dynamic) {
            warnings.push(dynamicKeyWarning(fileName, source, node, metadata));
          }
          knownQueryKeyIds.add(metadata.queryKey.id);
          const origin = { file: fileName, ...lineAndColumn(source, node) };
          decls.push({
            id: `tanstack-query:${metadata.queryKey.id}`,
            kind: `tanstack-query/${hookKind}`,
            origin,
            metadata: metadataToRecord(metadata),
          });
        } else {
          warnings.push(unresolvedWrapperWarning(fileName, source, node));
        }
      }

      const mutationHook = isMutationHookCall(node, imports.mutationHooks);
      if (mutationHook === "useMutation") {
        const optionsExpr = resolveHookOptions(
          node,
          imports.optionsHelpers,
          localOptions,
        );
        const metadata = parseMutationOptions(
          optionsExpr,
          node,
          typeAliases,
          types,
          source,
          typePlugins,
          fileName,
        );
        if (metadata) {
          const origin = { file: fileName, ...lineAndColumn(source, node) };
          decls.push({
            id: `tanstack-mutation:${metadata.mutationId}`,
            kind: "tanstack-query/useMutation",
            origin,
            metadata: metadataToRecord(metadata),
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);

  return { decls, warnings, queryClientBindings, knownQueryKeyIds };
}

function parseQueryOptions(
  optionsExpr: ts.ObjectLiteralExpression | undefined,
  hookKind: QueryOptionsMetadata["hookKind"],
  typeArg: ts.TypeNode | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  types: SemanticTypeContext | undefined,
  source: ts.SourceFile,
  typePlugins: readonly TypePlugin[] | undefined,
): QueryOptionsMetadata | undefined {
  if (!optionsExpr) return undefined;
  let queryKeyExpr: ts.Expression | undefined;
  let queryFnExpr: ts.Expression | undefined;
  let enabled: boolean | undefined;
  let staleTime: QueryOptionsMetadata["staleTime"] = "default";
  let retry: boolean | number | undefined;
  let refetchOnMount: boolean | undefined;
  let refetchOnWindowFocus: boolean | undefined = true;
  let refetchOnReconnect: boolean | undefined = true;
  let refetchInterval: boolean | undefined;
  let hasInitialData = false;
  let hasPlaceholderData = false;
  let selectProjection: string | undefined;
  let initialDataExpr: ts.Expression | undefined;

  for (const prop of optionsExpr.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    const name = prop.name.text;
    if (name === "queryKey") queryKeyExpr = prop.initializer;
    if (name === "queryFn") queryFnExpr = prop.initializer;
    if (
      name === "enabled" &&
      prop.initializer.kind === ts.SyntaxKind.FalseKeyword
    ) {
      enabled = false;
    }
    if (
      name === "enabled" &&
      prop.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      enabled = true;
    }
    if (
      name === "staleTime" &&
      (prop.initializer.kind === ts.SyntaxKind.TrueKeyword ||
        (ts.isStringLiteral(prop.initializer) &&
          prop.initializer.text === "static"))
    ) {
      staleTime = "static";
    }
    if (
      name === "staleTime" &&
      ts.isIdentifier(prop.initializer) &&
      prop.initializer.text === "Infinity"
    ) {
      staleTime = "infinity";
    }
    if (
      name === "retry" &&
      prop.initializer.kind === ts.SyntaxKind.FalseKeyword
    ) {
      retry = false;
    }
    if (name === "retry" && ts.isNumericLiteral(prop.initializer)) {
      retry = Number(prop.initializer.text);
    }
    if (
      name === "retry" &&
      prop.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      retry = true;
    }
    if (
      name === "refetchOnMount" &&
      prop.initializer.kind === ts.SyntaxKind.FalseKeyword
    ) {
      refetchOnMount = false;
    }
    if (
      name === "refetchOnWindowFocus" &&
      prop.initializer.kind === ts.SyntaxKind.FalseKeyword
    ) {
      refetchOnWindowFocus = false;
    }
    if (
      name === "refetchOnReconnect" &&
      prop.initializer.kind === ts.SyntaxKind.FalseKeyword
    ) {
      refetchOnReconnect = false;
    }
    if (name === "refetchInterval" && !isFalseLiteral(prop.initializer)) {
      refetchInterval = true;
    }
    if (name === "initialData") {
      hasInitialData = true;
      initialDataExpr = prop.initializer;
    }
    if (name === "placeholderData") {
      hasPlaceholderData = true;
    }
    if (name === "select") {
      if (ts.isPropertyAccessExpression(prop.initializer)) {
        selectProjection = prop.initializer.name.text;
      } else if (
        (ts.isArrowFunction(prop.initializer) ||
          ts.isFunctionExpression(prop.initializer)) &&
        ts.isPropertyAccessExpression(prop.initializer.body)
      ) {
        selectProjection = prop.initializer.body.name.text;
      }
    }
  }

  const queryKey = queryKeyFromExpression(queryKeyExpr);
  if (!queryKey) return undefined;

  let payloadDomain = inferQueryPayloadDomain(
    typeArg,
    typeAliases,
    types,
    source,
    typePlugins,
  );
  const initialDomain = domainFromInitialData(initialDataExpr, typeAliases);
  if (initialDomain) payloadDomain = initialDomain;
  const queryFnDomain = domainFromQueryFn(queryFnExpr, typeAliases);
  if (queryFnDomain) payloadDomain = queryFnDomain;

  const infinite =
    hookKind === "useInfiniteQuery" || hookKind === "useSuspenseInfiniteQuery";
  if (infinite) {
    payloadDomain = inferInfinitePageDomain(payloadDomain);
  }

  return {
    queryKey,
    ...(enabled !== undefined ? { enabled } : {}),
    staleTime,
    ...(retry !== undefined ? { retry } : {}),
    ...(refetchOnMount !== undefined ? { refetchOnMount } : {}),
    refetchOnWindowFocus,
    refetchOnReconnect,
    ...(refetchInterval ? { refetchInterval } : {}),
    hasInitialData,
    hasPlaceholderData,
    payloadDomain,
    op: `QUERY ${queryKey.display}`,
    hookKind,
    ...(infinite ? { infinite: true } : {}),
    ...(selectProjection ? { selectProjection } : {}),
  };
}

function parseMutationOptions(
  _optionsExpr: ts.ObjectLiteralExpression | undefined,
  call: ts.CallExpression,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  types: SemanticTypeContext | undefined,
  source: ts.SourceFile,
  typePlugins: readonly TypePlugin[] | undefined,
  fileName: string,
): MutationOptionsMetadata | undefined {
  const pos = lineAndColumn(source, call);
  const mutationId = mutationSiteId(fileName, pos.line, pos.column);
  const dataDomain = inferMutationDataDomain(
    call.typeArguments?.[0],
    typeAliases,
    types,
    source,
    typePlugins,
  );
  const variablesDomain = inferMutationVariablesDomain(
    call.typeArguments?.[1],
    typeAliases,
  );
  return {
    mutationId,
    payloadDomain: dataDomain,
    variablesDomain,
    op: `MUTATION ${mutationId}`,
  };
}

function resolveHookOptions(
  call: ts.CallExpression,
  optionsHelpers: ReadonlyMap<string, string>,
  localOptions: ReadonlyMap<string, ts.ObjectLiteralExpression>,
): ts.ObjectLiteralExpression | undefined {
  const arg = call.arguments[0];
  if (!arg) return undefined;
  if (ts.isObjectLiteralExpression(arg)) return arg;
  if (ts.isIdentifier(arg)) {
    const local = localOptions.get(arg.text);
    if (local) return local;
  }
  if (ts.isCallExpression(arg)) {
    const helper = isOptionsHelperCall(arg, optionsHelpers);
    if (
      helper &&
      arg.arguments[0] &&
      ts.isObjectLiteralExpression(arg.arguments[0])
    ) {
      return arg.arguments[0];
    }
  }
  return undefined;
}

function resolveOptionsInitializer(
  expr: ts.Expression,
  optionsHelpers: ReadonlyMap<string, string>,
  localOptions: ReadonlyMap<string, ts.ObjectLiteralExpression>,
): ts.ObjectLiteralExpression | undefined {
  if (ts.isCallExpression(expr)) {
    const helper = isOptionsHelperCall(expr, optionsHelpers);
    if (
      helper &&
      expr.arguments[0] &&
      ts.isObjectLiteralExpression(expr.arguments[0])
    ) {
      return expr.arguments[0];
    }
  }
  if (ts.isIdentifier(expr)) return localOptions.get(expr.text);
  return undefined;
}

function isModeledQueryHook(
  hook: string,
): hook is QueryOptionsMetadata["hookKind"] {
  return (
    hook === "useQuery" ||
    hook === "useSuspenseQuery" ||
    hook === "useInfiniteQuery" ||
    hook === "useSuspenseInfiniteQuery"
  );
}

function dynamicKeyWarning(
  fileName: string,
  source: ts.SourceFile,
  node: ts.Node,
  metadata: QueryOptionsMetadata,
): ExtractionWarning {
  const src = { file: fileName, ...lineAndColumn(source, node) };
  const caveat = modelSlackCaveat(
    `tanstack-query:${metadata.queryKey.id}`,
    `TanStack Query dynamic or unbounded query key at ${metadata.queryKey.display}`,
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

function unresolvedWrapperWarning(
  fileName: string,
  source: ts.SourceFile,
  node: ts.Node,
): ExtractionWarning {
  const src = { file: fileName, ...lineAndColumn(source, node) };
  const caveat = modelSlackCaveat(
    `tanstack-query:unresolved-wrapper`,
    "TanStack Query hook options could not be resolved statically",
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

function emptyDiscovery(): TanstackQueryDiscovery {
  return {
    decls: [],
    warnings: [],
    queryClientBindings: new Set(),
    knownQueryKeyIds: new Set(),
  };
}

function isFalseLiteral(expr: ts.Expression): boolean {
  return expr.kind === ts.SyntaxKind.FalseKeyword;
}

function domainFromQueryFn(
  expr: ts.Expression | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): import("modality-ts/core").AbstractDomain | undefined {
  if (!expr) return undefined;
  const body =
    (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) &&
    (ts.isBlock(expr.body)
      ? expr.body.statements.find(ts.isReturnStatement)?.expression
      : expr.body);
  if (!body) return undefined;
  return domainFromInitialData(body, typeAliases);
}

function lineAndColumn(
  source: ts.SourceFile,
  node: ts.Node,
): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}

export { collectSemanticNamedImports, TANSTACK_QUERY_MODULE };
