import * as ts from "typescript";

export const JOTAI_CORE_MODULES = new Set([
  "jotai",
  "jotai/react",
  "jotai/vanilla",
]);

export const JOTAI_UTIL_MODULES = new Set([
  "jotai/utils",
  "jotai/vanilla/utils",
  "jotai-family",
]);

export const JOTAI_MODULES = new Set([
  ...JOTAI_CORE_MODULES,
  ...JOTAI_UTIL_MODULES,
]);

export const ATOM_CREATOR_SYMBOLS = new Set([
  "atom",
  "atomWithStorage",
  "atomWithLazy",
  "atomWithReset",
  "atomWithDefault",
  "atomWithRefresh",
  "loadable",
  "unwrap",
  "atomWithObservable",
  "atomFamily",
]);

export const HOOK_SYMBOLS = new Set([
  "useAtom",
  "useSetAtom",
  "useStore",
  "useHydrateAtoms",
  "useResetAtom",
]);

export const STORE_SYMBOLS = new Set(["createStore", "getDefaultStore"]);

export interface JotaiResolvedImports {
  atomCreators: Map<string, string>;
  hooks: Map<string, string>;
  storeCreators: Map<string, string>;
  utils: Map<string, string>;
  resetSymbol: string | undefined;
  providerTag: string | undefined;
}

export function resolveJotaiImports(
  source: ts.SourceFile,
): JotaiResolvedImports {
  const atomCreators = new Map<string, string>();
  const hooks = new Map<string, string>();
  const storeCreators = new Map<string, string>();
  const utils = new Map<string, string>();
  let resetSymbol: string | undefined;
  let providerTag: string | undefined;

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleName = moduleSpecifierText(statement.moduleSpecifier);
    if (!moduleName || !JOTAI_MODULES.has(moduleName)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      const local = specifier.name.text;
      if (ATOM_CREATOR_SYMBOLS.has(imported)) {
        atomCreators.set(local, imported);
      }
      if (HOOK_SYMBOLS.has(imported)) {
        hooks.set(local, imported);
      }
      if (STORE_SYMBOLS.has(imported)) {
        storeCreators.set(local, imported);
      }
      if (
        imported === "createJSONStorage" ||
        imported === "RESET" ||
        imported === "Provider"
      ) {
        utils.set(local, imported);
      }
      if (imported === "RESET") resetSymbol = local;
      if (imported === "Provider") providerTag = local;
    }
  }
  return {
    atomCreators,
    hooks,
    storeCreators,
    utils,
    resetSymbol,
    providerTag,
  };
}

export function isJotaiModuleSpecifier(
  moduleSpecifier: ts.Expression,
): boolean {
  const text = moduleSpecifierText(moduleSpecifier);
  return text !== undefined && JOTAI_MODULES.has(text);
}

export function moduleSpecifierText(
  moduleSpecifier: ts.Expression,
): string | undefined {
  return ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : undefined;
}

export function isAtomCreatorCall(
  node: ts.Expression,
  atomCreators: ReadonlyMap<string, string>,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    atomCreators.has(node.expression.text)
  );
}

export function atomCreatorName(
  call: ts.CallExpression,
  atomCreators: ReadonlyMap<string, string>,
): string | undefined {
  if (!ts.isIdentifier(call.expression)) return undefined;
  return atomCreators.get(call.expression.text);
}

export function isHookCall(
  node: ts.Expression,
  hooks: ReadonlyMap<string, string>,
  importedName: string,
): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression))
    return false;
  return hooks.get(node.expression.text) === importedName;
}

export function hookImportedName(
  node: ts.CallExpression,
  hooks: ReadonlyMap<string, string>,
): string | undefined {
  if (!ts.isIdentifier(node.expression)) return undefined;
  return hooks.get(node.expression.text);
}
