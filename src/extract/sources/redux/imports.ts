import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { collectSemanticNamedImports } from "../../engine/ts/semantic-imports.js";

export const REACT_REDUX_MODULES = new Set(["react-redux"]);

export const RTK_MODULES = new Set(["@reduxjs/toolkit"]);

export const REDUX_MODULES = new Set(["redux"]);

export const RTK_QUERY_MODULES = new Set([
  "@reduxjs/toolkit/query",
  "@reduxjs/toolkit/query/react",
]);

export const REACT_REDUX_SYMBOLS = new Set([
  "Provider",
  "useSelector",
  "useDispatch",
  "useStore",
  "connect",
  "shallowEqual",
]);

export const RTK_SYMBOLS = new Set([
  "configureStore",
  "createSlice",
  "createReducer",
  "createAction",
  "createAsyncThunk",
  "combineSlices",
  "createListenerMiddleware",
  "createEntityAdapter",
  "createSerializableStateInvariantMiddleware",
  "combineReducers",
]);

export const REDUX_CORE_SYMBOLS = new Set([
  "combineReducers",
  "createStore",
  "legacy_createStore",
  "bindActionCreators",
  "applyMiddleware",
  "compose",
]);

export const RTK_QUERY_SYMBOLS = new Set(["createApi", "fetchBaseQuery"]);

export const ALL_REDUX_MODULES = new Set([
  ...REACT_REDUX_MODULES,
  ...RTK_MODULES,
  ...REDUX_MODULES,
  ...RTK_QUERY_MODULES,
]);

export interface ReduxResolvedImports {
  reactRedux: Map<string, string>;
  rtk: Map<string, string>;
  redux: Map<string, string>;
  rtkQuery: Map<string, string>;
  storeCreators: Map<string, string>;
  sliceCreators: Map<string, string>;
  actionCreators: Map<string, string>;
  asyncThunkCreators: Map<string, string>;
  apiCreators: Map<string, string>;
  selectors: Map<string, string>;
  dispatchHooks: Map<string, string>;
  providers: Map<string, string>;
}

const ALL_ALLOWED_EXPORTS = new Set([
  ...REACT_REDUX_SYMBOLS,
  ...RTK_SYMBOLS,
  ...REDUX_CORE_SYMBOLS,
  ...RTK_QUERY_SYMBOLS,
]);

export function resolveReduxImports(
  source: ts.SourceFile,
  types?: SemanticTypeContext,
): ReduxResolvedImports {
  if (types?.checker) {
    return resolveReduxImportsSemantic(source, types);
  }
  return resolveReduxImportsSyntax(source);
}

function emptyImports(): ReduxResolvedImports {
  return {
    reactRedux: new Map(),
    rtk: new Map(),
    redux: new Map(),
    rtkQuery: new Map(),
    storeCreators: new Map(),
    sliceCreators: new Map(),
    actionCreators: new Map(),
    asyncThunkCreators: new Map(),
    apiCreators: new Map(),
    selectors: new Map(),
    dispatchHooks: new Map(),
    providers: new Map(),
  };
}

function resolveReduxImportsSemantic(
  source: ts.SourceFile,
  types: SemanticTypeContext,
): ReduxResolvedImports {
  const result = emptyImports();
  for (const resolved of collectSemanticNamedImports(
    source,
    ALL_REDUX_MODULES,
    ALL_ALLOWED_EXPORTS,
    types,
  )) {
    registerImport(result, resolved.localName, resolved.exportedName);
  }
  return result;
}

function resolveReduxImportsSyntax(
  source: ts.SourceFile,
): ReduxResolvedImports {
  const result = emptyImports();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleName = moduleSpecifierText(statement.moduleSpecifier);
    if (!moduleName || !ALL_REDUX_MODULES.has(moduleName)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      registerImport(result, specifier.name.text, imported);
    }
  }
  return result;
}

function registerImport(
  result: ReduxResolvedImports,
  local: string,
  exported: string,
): void {
  if (REACT_REDUX_SYMBOLS.has(exported)) {
    result.reactRedux.set(local, exported);
    if (exported === "useSelector") result.selectors.set(local, exported);
    if (exported === "useDispatch") result.dispatchHooks.set(local, exported);
    if (exported === "Provider") result.providers.set(local, exported);
  }
  if (RTK_SYMBOLS.has(exported)) {
    result.rtk.set(local, exported);
    if (exported === "configureStore" || exported === "createStore") {
      result.storeCreators.set(local, exported);
    }
    if (exported === "createSlice") result.sliceCreators.set(local, exported);
    if (exported === "createAction") result.actionCreators.set(local, exported);
    if (exported === "createAsyncThunk") {
      result.asyncThunkCreators.set(local, exported);
    }
    if (exported === "combineReducers") {
      result.redux.set(local, exported);
    }
  }
  if (REDUX_CORE_SYMBOLS.has(exported)) {
    result.redux.set(local, exported);
    if (exported === "createStore" || exported === "legacy_createStore") {
      result.storeCreators.set(local, exported);
    }
    if (exported === "bindActionCreators") {
      result.redux.set(local, exported);
    }
  }
  if (RTK_QUERY_SYMBOLS.has(exported)) {
    result.rtkQuery.set(local, exported);
    if (exported === "createApi") result.apiCreators.set(local, exported);
  }
}

export function moduleSpecifierText(
  moduleSpecifier: ts.Expression,
): string | undefined {
  return ts.isStringLiteral(moduleSpecifier) ? moduleSpecifier.text : undefined;
}

export function isConfigureStoreCall(
  node: ts.Expression,
  imports: ReduxResolvedImports,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    imports.storeCreators.get(node.expression.text) === "configureStore"
  );
}

export function isCreateStoreCall(
  node: ts.Expression,
  imports: ReduxResolvedImports,
): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  if (!ts.isIdentifier(node.expression)) return false;
  const name = imports.storeCreators.get(node.expression.text);
  return name === "createStore" || name === "legacy_createStore";
}

export function isCreateSliceCall(
  node: ts.Expression,
  imports: ReduxResolvedImports,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    imports.sliceCreators.get(node.expression.text) === "createSlice"
  );
}

export function isCreateReducerCall(
  node: ts.Expression,
  imports: ReduxResolvedImports,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    imports.rtk.get(node.expression.text) === "createReducer"
  );
}

export function isCreateActionCall(
  node: ts.Expression,
  imports: ReduxResolvedImports,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    imports.actionCreators.get(node.expression.text) === "createAction"
  );
}

export function isCreateAsyncThunkCall(
  node: ts.Expression,
  imports: ReduxResolvedImports,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    imports.asyncThunkCreators.get(node.expression.text) === "createAsyncThunk"
  );
}

export function isCreateApiCall(
  node: ts.Expression,
  imports: ReduxResolvedImports,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    imports.apiCreators.get(node.expression.text) === "createApi"
  );
}

export function isUseSelectorCall(
  node: ts.Expression,
  imports: ReduxResolvedImports,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    imports.selectors.has(node.expression.text)
  );
}

export function isUseDispatchCall(
  node: ts.Expression,
  imports: ReduxResolvedImports,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    imports.dispatchHooks.has(node.expression.text)
  );
}

export function isCombineReducersCall(
  node: ts.Expression,
  imports: ReduxResolvedImports,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    (imports.redux.get(node.expression.text) === "combineReducers" ||
      imports.rtk.get(node.expression.text) === "combineReducers")
  );
}

export function isBindActionCreatorsCall(
  node: ts.Expression,
  imports: ReduxResolvedImports,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    imports.redux.get(node.expression.text) === "bindActionCreators"
  );
}
