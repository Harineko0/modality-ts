import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { collectSemanticNamedImports } from "../../../engine/ts/semantic-imports.js";

export const TANSTACK_QUERY_MODULE = "@tanstack/react-query";

export const QUERY_HOOK_SYMBOLS = new Set([
  "useQuery",
  "useSuspenseQuery",
  "useInfiniteQuery",
  "useSuspenseInfiniteQuery",
  "useQueries",
  "useSuspenseQueries",
]);

export const MUTATION_HOOK_SYMBOLS = new Set([
  "useMutation",
  "useIsMutating",
  "useMutationState",
]);

export const AGGREGATE_HOOK_SYMBOLS = new Set(["useIsFetching"]);

export const CLIENT_SYMBOLS = new Set([
  "useQueryClient",
  "QueryClient",
  "QueryClientProvider",
]);

export const OPTIONS_SYMBOLS = new Set([
  "queryOptions",
  "infiniteQueryOptions",
  "mutationOptions",
]);

export const ALL_ALLOWED_EXPORTS = new Set([
  ...QUERY_HOOK_SYMBOLS,
  ...MUTATION_HOOK_SYMBOLS,
  ...AGGREGATE_HOOK_SYMBOLS,
  ...CLIENT_SYMBOLS,
  ...OPTIONS_SYMBOLS,
]);

export interface TanstackQueryResolvedImports {
  queryHooks: Map<string, string>;
  mutationHooks: Map<string, string>;
  aggregateHooks: Map<string, string>;
  clients: Map<string, string>;
  optionsHelpers: Map<string, string>;
}

export function resolveTanstackQueryImports(
  source: ts.SourceFile,
  types?: SemanticTypeContext,
): TanstackQueryResolvedImports {
  if (types?.checker) {
    return resolveTanstackQueryImportsSemantic(source, types);
  }
  return resolveTanstackQueryImportsSyntax(source);
}

function resolveTanstackQueryImportsSemantic(
  source: ts.SourceFile,
  types: SemanticTypeContext,
): TanstackQueryResolvedImports {
  const queryHooks = new Map<string, string>();
  const mutationHooks = new Map<string, string>();
  const aggregateHooks = new Map<string, string>();
  const clients = new Map<string, string>();
  const optionsHelpers = new Map<string, string>();

  for (const resolved of collectSemanticNamedImports(
    source,
    new Set([TANSTACK_QUERY_MODULE]),
    ALL_ALLOWED_EXPORTS,
    types,
  )) {
    const { localName, exportedName } = resolved;
    if (QUERY_HOOK_SYMBOLS.has(exportedName)) {
      queryHooks.set(localName, exportedName);
    } else if (MUTATION_HOOK_SYMBOLS.has(exportedName)) {
      mutationHooks.set(localName, exportedName);
    } else if (AGGREGATE_HOOK_SYMBOLS.has(exportedName)) {
      aggregateHooks.set(localName, exportedName);
    } else if (CLIENT_SYMBOLS.has(exportedName)) {
      clients.set(localName, exportedName);
    } else if (OPTIONS_SYMBOLS.has(exportedName)) {
      optionsHelpers.set(localName, exportedName);
    }
  }
  return { queryHooks, mutationHooks, aggregateHooks, clients, optionsHelpers };
}

function resolveTanstackQueryImportsSyntax(
  source: ts.SourceFile,
): TanstackQueryResolvedImports {
  const queryHooks = new Map<string, string>();
  const mutationHooks = new Map<string, string>();
  const aggregateHooks = new Map<string, string>();
  const clients = new Map<string, string>();
  const optionsHelpers = new Map<string, string>();

  for (const statement of source.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== TANSTACK_QUERY_MODULE
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      const local = specifier.name.text;
      if (QUERY_HOOK_SYMBOLS.has(imported)) queryHooks.set(local, imported);
      else if (MUTATION_HOOK_SYMBOLS.has(imported))
        mutationHooks.set(local, imported);
      else if (AGGREGATE_HOOK_SYMBOLS.has(imported))
        aggregateHooks.set(local, imported);
      else if (CLIENT_SYMBOLS.has(imported)) clients.set(local, imported);
      else if (OPTIONS_SYMBOLS.has(imported))
        optionsHelpers.set(local, imported);
    }
  }
  return { queryHooks, mutationHooks, aggregateHooks, clients, optionsHelpers };
}

export function isQueryHookCall(
  call: ts.CallExpression,
  queryHooks: ReadonlyMap<string, string>,
): string | undefined {
  if (!ts.isIdentifier(call.expression)) return undefined;
  return queryHooks.get(call.expression.text);
}

export function isMutationHookCall(
  call: ts.CallExpression,
  mutationHooks: ReadonlyMap<string, string>,
): string | undefined {
  if (!ts.isIdentifier(call.expression)) return undefined;
  return mutationHooks.get(call.expression.text);
}

export function isOptionsHelperCall(
  call: ts.CallExpression,
  optionsHelpers: ReadonlyMap<string, string>,
): string | undefined {
  if (!ts.isIdentifier(call.expression)) return undefined;
  return optionsHelpers.get(call.expression.text);
}

export function moduleSpecifierText(
  moduleSpecifier: ts.Expression,
): string | undefined {
  return ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : undefined;
}
