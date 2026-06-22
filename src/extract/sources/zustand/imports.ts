import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { collectSemanticNamedImports } from "../../engine/ts/semantic-imports.js";

export const ZUSTAND_CORE_MODULES = new Set([
  "zustand",
  "zustand/react",
  "zustand/vanilla",
  "zustand/traditional",
]);

export const ZUSTAND_MIDDLEWARE_MODULES = new Set([
  "zustand/middleware",
  "zustand/middleware/immer",
]);

export const ZUSTAND_MODULES = new Set([
  ...ZUSTAND_CORE_MODULES,
  ...ZUSTAND_MIDDLEWARE_MODULES,
]);

export const STORE_CREATOR_SYMBOLS = new Set([
  "create",
  "createStore",
  "createWithEqualityFn",
]);

export const MIDDLEWARE_SYMBOLS = new Set([
  "persist",
  "combine",
  "redux",
  "subscribeWithSelector",
  "devtools",
  "immer",
]);

export interface ZustandResolvedImports {
  storeCreators: Map<string, string>;
  middlewares: Map<string, string>;
}

const ZUSTAND_ALLOWED_EXPORTS = new Set([
  ...STORE_CREATOR_SYMBOLS,
  ...MIDDLEWARE_SYMBOLS,
]);

export function resolveZustandImports(
  source: ts.SourceFile,
  types?: SemanticTypeContext,
): ZustandResolvedImports {
  if (types?.checker) {
    return resolveZustandImportsSemantic(source, types);
  }
  return resolveZustandImportsSyntax(source);
}

function resolveZustandImportsSemantic(
  source: ts.SourceFile,
  types: SemanticTypeContext,
): ZustandResolvedImports {
  const storeCreators = new Map<string, string>();
  const middlewares = new Map<string, string>();

  for (const resolved of collectSemanticNamedImports(
    source,
    ZUSTAND_MODULES,
    ZUSTAND_ALLOWED_EXPORTS,
    types,
  )) {
    const { localName, exportedName } = resolved;
    if (STORE_CREATOR_SYMBOLS.has(exportedName)) {
      storeCreators.set(localName, exportedName);
    }
    if (MIDDLEWARE_SYMBOLS.has(exportedName)) {
      middlewares.set(localName, exportedName);
    }
  }
  return { storeCreators, middlewares };
}

function resolveZustandImportsSyntax(
  source: ts.SourceFile,
): ZustandResolvedImports {
  const storeCreators = new Map<string, string>();
  const middlewares = new Map<string, string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleName = moduleSpecifierText(statement.moduleSpecifier);
    if (!moduleName || !ZUSTAND_MODULES.has(moduleName)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      const local = specifier.name.text;
      if (STORE_CREATOR_SYMBOLS.has(imported)) {
        storeCreators.set(local, imported);
      }
      if (MIDDLEWARE_SYMBOLS.has(imported)) {
        middlewares.set(local, imported);
      }
    }
  }
  return { storeCreators, middlewares };
}

export function moduleSpecifierText(
  moduleSpecifier: ts.Expression,
): string | undefined {
  return ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : undefined;
}

export function isStoreCreatorCall(
  node: ts.Expression,
  storeCreators: ReadonlyMap<string, string>,
): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  if (ts.isIdentifier(node.expression)) {
    return storeCreators.has(node.expression.text);
  }
  if (
    ts.isCallExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    storeCreators.has(node.expression.expression.text)
  ) {
    return true;
  }
  return false;
}

export function storeCreatorName(
  call: ts.CallExpression,
  storeCreators: ReadonlyMap<string, string>,
): string | undefined {
  if (ts.isIdentifier(call.expression)) {
    return storeCreators.get(call.expression.text);
  }
  if (
    ts.isCallExpression(call.expression) &&
    ts.isIdentifier(call.expression.expression)
  ) {
    return storeCreators.get(call.expression.expression.text);
  }
  return undefined;
}

export function isMiddlewareCall(
  node: ts.Expression,
  middlewares: ReadonlyMap<string, string>,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    middlewares.has(node.expression.text)
  );
}

export function middlewareName(
  call: ts.CallExpression,
  middlewares: ReadonlyMap<string, string>,
): string | undefined {
  if (!ts.isIdentifier(call.expression)) return undefined;
  return middlewares.get(call.expression.text);
}
