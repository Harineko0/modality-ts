import type {
  EffectIR,
  ExtractionCaveat,
  SourceAnchor,
  StateVarDecl,
  Value,
} from "modality-ts/core";
import type { SourceDecl, TypePlugin } from "modality-ts/extract/engine/spi";
import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { modelSlackCaveat } from "../../../lang/ts/driver/caveats.js";
import { compilerBackedTypeAliases } from "../../../lang/ts/driver/domains.js";
import { semanticSourceFileFor } from "../../../lang/ts/driver/semantic-source-file.js";
import {
  inferFieldDomain,
  isActionFunction,
  propertyNameFromMember,
} from "./domains.js";
import { storeVarId } from "./ids.js";
import {
  isCombineReducersCall,
  isConfigureStoreCall,
  isCreateStoreCall,
  resolveReduxImports,
} from "./imports.js";
import { discoverRtkQueryApis } from "./rtk-query.js";
import {
  collectActionCreators,
  collectSliceDefinitions,
  lowerSliceActionEffects,
  type ReduxSliceDefinition,
  registerSliceActionExports,
} from "./slices.js";
import { registerAsyncThunkLifecycle } from "./thunks.js";
import { metadataToRecord } from "./types.js";

export interface ReduxDiscoveryWarning {
  message: string;
  source?: SourceAnchor;
  caveat?: ExtractionCaveat;
}

export interface ReduxStoreInfo {
  storeName: string;
  sliceKeys: Map<string, string>;
  middleware: string[];
  hasThunk: boolean;
  source: SourceAnchor;
}

export interface DiscoverReduxResult {
  decls: SourceDecl[];
  warnings: ReduxDiscoveryWarning[];
  storeNames: Set<string>;
  storeInfos: Map<string, ReduxStoreInfo>;
  slices: Map<string, ReduxSliceDefinition>;
  sliceKeysByStore: Map<string, Map<string, string>>;
  storeFields: Map<string, Map<string, Set<string>>>;
  storeFieldInitials: Map<string, Map<string, Map<string, Value>>>;
  actionEffects: Map<string, EffectIR>;
  actionCreators: ReturnType<typeof collectActionCreators>;
  storeHandles: Set<string>;
  queryDecls: SourceDecl[];
}

export function discoverReduxStores(
  sourceText: string,
  fileName = "store.ts",
): SourceDecl[] {
  return discoverReduxStoresDetailed(sourceText, fileName).decls;
}

export function discoverReduxStoresDetailed(
  sourceText: string,
  fileName = "store.ts",
  types?: SemanticTypeContext,
  typePlugins?: readonly TypePlugin[],
): DiscoverReduxResult {
  const source = semanticSourceFileFor(
    sourceText,
    fileName,
    types,
    ts.ScriptKind.TSX,
  );
  const imports = resolveReduxImports(source, types);
  const hasReduxImports =
    imports.reactRedux.size > 0 ||
    imports.rtk.size > 0 ||
    imports.redux.size > 0 ||
    imports.rtkQuery.size > 0;
  if (!hasReduxImports) return emptyDiscoverResult();

  const typeAliases = compilerBackedTypeAliases(source, types);
  const warnings: ReduxDiscoveryWarning[] = [];
  const storeNames = new Set<string>();
  const storeInfos = new Map<string, ReduxStoreInfo>();
  const slices = collectSliceDefinitions(source, imports);
  const actionCreators = collectActionCreators(source, imports, slices);
  const actionEffects = new Map<string, EffectIR>();
  const storeFields = new Map<string, Map<string, Set<string>>>();
  const storeFieldInitials = new Map<string, Map<string, Map<string, Value>>>();
  const sliceKeysByStore = new Map<string, Map<string, string>>();
  const storeHandles = new Set<string>();
  const decls: SourceDecl[] = [];

  const queryDiscovery = discoverRtkQueryApis(
    sourceText,
    fileName,
    types,
    typePlugins,
  );
  decls.push(...queryDiscovery.decls);
  warnings.push(...queryDiscovery.warnings);

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (isConfigureStoreCall(node.initializer, imports) ||
        isCreateStoreCall(node.initializer, imports))
    ) {
      const storeName = node.name.text;
      storeNames.add(storeName);
      storeHandles.add(storeName);
      const origin = anchor(source, fileName, node);
      const reducerMap = resolveStoreReducerMap(
        node.initializer,
        imports,
        source,
        slices,
      );
      const middleware = extractMiddlewareNames(node.initializer);
      const hasThunk =
        middleware.length === 0 ||
        middleware.some((name) => name.includes("thunk"));
      const sliceKeys = new Map<string, string>();
      for (const [key, reducerRef] of reducerMap) {
        sliceKeys.set(key, reducerRef);
      }
      sliceKeysByStore.set(storeName, sliceKeys);
      storeInfos.set(storeName, {
        storeName,
        sliceKeys,
        middleware,
        hasThunk,
        source: origin,
      });
      emitStoreSliceVars(
        storeName,
        sliceKeys,
        slices,
        source,
        typeAliases,
        fileName,
        decls,
        storeFields,
        storeFieldInitials,
        warnings,
        types,
        typePlugins,
      );
      const fieldMaps = buildFieldMaps(
        storeName,
        sliceKeys,
        storeFields,
        storeFieldInitials,
      );
      for (const [sliceKey, sliceRef] of sliceKeys) {
        const slice = resolveSliceDefinition(sliceRef, slices, source);
        if (!slice) continue;
        const { fieldVarIds, fieldInitials } = fieldMaps.get(sliceKey) ?? {
          fieldVarIds: new Map<string, string>(),
          fieldInitials: new Map<string, Value>(),
        };
        const effects = lowerSliceActionEffects(
          slice,
          storeName,
          sliceKey,
          fieldVarIds,
          fieldInitials,
        );
        for (const [actionKey, effect] of effects) {
          actionEffects.set(`${storeName}:${actionKey}`, effect);
          actionEffects.set(actionKey, effect);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  registerAsyncThunkLifecycle(source, imports, {
    decls,
    warnings,
    storeNames,
    storeInfos,
    slices,
    sliceKeysByStore,
    storeFields,
    storeFieldInitials,
    actionEffects,
    actionCreators,
    storeHandles,
    queryDecls: queryDiscovery.decls,
  });
  registerSliceActionExports(source, slices, actionEffects);

  if (storeNames.size > 1) {
    warnings.push({
      message:
        "Multiple Redux stores detected; standard Redux apps use one store",
      caveat: modelSlackCaveat(
        "redux:multiple-stores",
        "Multiple Redux stores detected; modeling each separately",
      ),
    });
  }

  return {
    decls,
    warnings,
    storeNames,
    storeInfos,
    slices,
    sliceKeysByStore,
    storeFields,
    storeFieldInitials,
    actionEffects,
    actionCreators,
    storeHandles,
    queryDecls: queryDiscovery.decls,
  };
}

function emitStoreSliceVars(
  storeName: string,
  sliceKeys: Map<string, string>,
  slices: Map<string, ReduxSliceDefinition>,
  source: ts.SourceFile,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  fileName: string,
  decls: SourceDecl[],
  storeFields: Map<string, Map<string, Set<string>>>,
  storeFieldInitials: Map<string, Map<string, Map<string, Value>>>,
  warnings: ReduxDiscoveryWarning[],
  types?: SemanticTypeContext,
  typePlugins?: readonly TypePlugin[],
): void {
  const perStoreFields =
    storeFields.get(storeName) ?? new Map<string, Set<string>>();
  const perStoreInitials =
    storeFieldInitials.get(storeName) ?? new Map<string, Map<string, Value>>();

  for (const [sliceKey, sliceRef] of sliceKeys) {
    const slice = resolveSliceDefinition(sliceRef, slices, source);
    const initialState =
      slice?.initialState ?? initialStateFromReducerRef(sliceRef, source);
    if (!initialState) continue;
    const fields = perStoreFields.get(sliceKey) ?? new Set<string>();
    const initials = perStoreInitials.get(sliceKey) ?? new Map<string, Value>();
    emitFieldsFromInitialState(
      initialState,
      storeName,
      sliceKey,
      slice ?? {
        varName: sliceRef,
        sliceName: sliceKey,
        initialState,
        immer: false,
        reducerCases: new Map(),
        actionTypes: new Map(),
        actionCreators: new Map(),
        extraReducerCases: new Map(),
        asyncThunkPrefixes: [],
      },
      typeAliases,
      source,
      fileName,
      decls,
      fields,
      initials,
      warnings,
      types,
      typePlugins,
    );
    perStoreFields.set(sliceKey, fields);
    perStoreInitials.set(sliceKey, initials);
  }
  storeFields.set(storeName, perStoreFields);
  storeFieldInitials.set(storeName, perStoreInitials);
}

function emitFieldsFromInitialState(
  initialState: ts.ObjectLiteralExpression,
  storeName: string,
  sliceKey: string,
  slice: ReduxSliceDefinition,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  source: ts.SourceFile,
  fileName: string,
  decls: SourceDecl[],
  fields: Set<string>,
  initials: Map<string, Value>,
  warnings: ReduxDiscoveryWarning[],
  types?: SemanticTypeContext,
  typePlugins?: readonly TypePlugin[],
): void {
  for (const prop of initialState.properties) {
    if (ts.isSpreadAssignment(prop)) {
      warnings.push({
        message: "Redux spread initial state field unsupported",
        source: anchor(source, fileName, prop),
        caveat: modelSlackCaveat(
          `redux:${storeName}.${sliceKey}.spread`,
          "Redux spread initial state field unsupported",
          anchor(source, fileName, prop),
        ),
      });
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyNameFromMember(prop.name);
    if (!name) continue;
    if (isActionFunction(prop.initializer)) continue;
    const path = `${sliceKey}.${name}`;
    const varId = storeVarId(storeName, path);
    const fieldDomain = inferFieldDomain(
      prop.initializer,
      undefined,
      typeAliases,
      varId,
      source,
      types,
      typePlugins,
    );
    fields.add(name);
    initials.set(name, fieldDomain.initial);
    const origin = anchor(source, fileName, prop);
    const variable: StateVarDecl = {
      id: varId,
      domain: fieldDomain.domain,
      origin,
      scope: { kind: "global" },
      initial: fieldDomain.initial,
    };
    decls.push({
      id: varId,
      kind: "redux/slice-field",
      var: variable,
      origin,
      metadata: metadataToRecord({
        storeName,
        sliceKey,
        field: name,
        sliceName: slice.sliceName,
        immer: slice.immer,
      }),
    });
  }
}

function buildFieldMaps(
  storeName: string,
  sliceKeys: Map<string, string>,
  storeFields: Map<string, Map<string, Set<string>>>,
  storeFieldInitials: Map<string, Map<string, Map<string, Value>>>,
): Map<
  string,
  { fieldVarIds: Map<string, string>; fieldInitials: Map<string, Value> }
> {
  const result = new Map<
    string,
    { fieldVarIds: Map<string, string>; fieldInitials: Map<string, Value> }
  >();
  const perStoreFields = storeFields.get(storeName);
  const perStoreInitials = storeFieldInitials.get(storeName);
  for (const sliceKey of sliceKeys.keys()) {
    const fieldVarIds = new Map<string, string>();
    const fieldInitials = new Map<string, Value>();
    for (const field of perStoreFields?.get(sliceKey) ?? []) {
      fieldVarIds.set(field, storeVarId(storeName, `${sliceKey}.${field}`));
      const initial = perStoreInitials?.get(sliceKey)?.get(field);
      if (initial !== undefined) fieldInitials.set(field, initial);
    }
    result.set(sliceKey, { fieldVarIds, fieldInitials });
  }
  return result;
}

function resolveStoreReducerMap(
  storeCall: ts.CallExpression,
  imports: ReturnType<typeof resolveReduxImports>,
  _source: ts.SourceFile,
  _slices: Map<string, ReduxSliceDefinition>,
): Map<string, string> {
  const map = new Map<string, string>();
  const creator = ts.isIdentifier(storeCall.expression)
    ? imports.storeCreators.get(storeCall.expression.text)
    : undefined;
  if (creator === "configureStore") {
    const config = storeCall.arguments[0];
    if (!config || !ts.isObjectLiteralExpression(config)) return map;
    for (const prop of config.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = propertyNameFromMember(prop.name);
      if (name !== "reducer") continue;
      if (ts.isObjectLiteralExpression(prop.initializer)) {
        for (const reducerProp of prop.initializer.properties) {
          if (!ts.isPropertyAssignment(reducerProp)) continue;
          const key = propertyNameFromMember(reducerProp.name);
          if (!key) continue;
          map.set(key, reducerRefName(reducerProp.initializer));
        }
      } else if (isCombineReducersCall(prop.initializer, imports)) {
        const arg = prop.initializer.arguments[0];
        if (arg && ts.isObjectLiteralExpression(arg)) {
          for (const reducerProp of arg.properties) {
            if (!ts.isPropertyAssignment(reducerProp)) continue;
            const key = propertyNameFromMember(reducerProp.name);
            if (!key) continue;
            map.set(key, reducerRefName(reducerProp.initializer));
          }
        }
      } else if (ts.isIdentifier(prop.initializer)) {
        map.set("root", prop.initializer.text);
      }
    }
    return map;
  }
  if (creator === "createStore" || creator === "legacy_createStore") {
    const reducer = storeCall.arguments[0];
    if (reducer) {
      map.set("root", reducerRefName(reducer));
      const defaultState = defaultStateFromReducer(reducer);
      if (defaultState) {
        map.set("__defaultState:root", defaultState.getText());
      }
    }
  }
  return map;
}

function defaultStateFromReducer(
  reducer: ts.Expression,
): ts.Expression | undefined {
  if (
    (ts.isArrowFunction(reducer) || ts.isFunctionExpression(reducer)) &&
    reducer.parameters[0]?.initializer
  ) {
    return reducer.parameters[0].initializer;
  }
  return undefined;
}

function reducerRefName(expr: ts.Expression): string {
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "reducer") {
    if (ts.isIdentifier(expr.expression)) return expr.expression.text;
  }
  if (ts.isIdentifier(expr)) return expr.text;
  return "unknown";
}

function resolveSliceDefinition(
  ref: string,
  slices: Map<string, ReduxSliceDefinition>,
  source?: ts.SourceFile,
): ReduxSliceDefinition | undefined {
  const fromSlice = slices.get(ref);
  if (fromSlice) return fromSlice;
  if (!source) return undefined;
  const reducerFn = findReducerFunction(ref, source);
  if (!reducerFn) return undefined;
  const initial = defaultStateFromReducer(reducerFn);
  if (!initial || !ts.isObjectLiteralExpression(initial)) return undefined;
  return {
    varName: ref,
    sliceName: ref,
    initialState: initial,
    immer: false,
    reducerCases: new Map(),
    actionTypes: new Map(),
    actionCreators: new Map(),
    extraReducerCases: new Map(),
    asyncThunkPrefixes: [],
  };
}

function initialStateFromReducerRef(
  ref: string,
  source: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  const reducerFn = findReducerFunction(ref, source);
  if (!reducerFn) return undefined;
  const initial = defaultStateFromReducer(reducerFn);
  return initial && ts.isObjectLiteralExpression(initial) ? initial : undefined;
}

function findReducerFunction(
  ref: string,
  source: ts.SourceFile,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  let found: ts.ArrowFunction | ts.FunctionExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === ref &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      found = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function extractMiddlewareNames(storeCall: ts.CallExpression): string[] {
  const config = storeCall.arguments[0];
  if (!config || !ts.isObjectLiteralExpression(config)) return [];
  for (const prop of config.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyNameFromMember(prop.name);
    if (name !== "middleware") continue;
    if (ts.isArrayLiteralExpression(prop.initializer)) {
      return prop.initializer.elements
        .map((element) => (ts.isIdentifier(element) ? element.text : "custom"))
        .filter(Boolean);
    }
  }
  return [];
}

function anchor(
  source: ts.SourceFile,
  fileName: string,
  node: ts.Node,
): SourceAnchor {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { file: fileName, line: pos.line + 1, column: pos.character + 1 };
}

function emptyDiscoverResult(): DiscoverReduxResult {
  return {
    decls: [],
    warnings: [],
    storeNames: new Set(),
    storeInfos: new Map(),
    slices: new Map(),
    sliceKeysByStore: new Map(),
    storeFields: new Map(),
    storeFieldInitials: new Map(),
    actionEffects: new Map(),
    actionCreators: new Map(),
    storeHandles: new Set(),
    queryDecls: [],
  };
}

export { anchor };
