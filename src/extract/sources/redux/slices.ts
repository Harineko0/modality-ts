import type { EffectIR } from "modality-ts/core";
import * as ts from "typescript";
import { literalValue } from "../../engine/ts/ast.js";
import { propertyNameFromMember } from "./domains.js";
import type { ReduxResolvedImports } from "./imports.js";
import {
  isCreateActionCall,
  isCreateAsyncThunkCall,
  isCreateReducerCall,
  isCreateSliceCall,
} from "./imports.js";
import type { ReducerLoweringContext } from "./reducers.js";
import { havocSliceVars, lowerReducerCase } from "./reducers.js";

export interface ReduxSliceDefinition {
  varName: string;
  sliceName: string;
  initialState: ts.ObjectLiteralExpression | undefined;
  immer: boolean;
  reducerCases: Map<string, ts.ArrowFunction | ts.FunctionExpression>;
  actionTypes: Map<string, string>;
  actionCreators: Map<string, string>;
  extraReducerCases: Map<string, ts.ArrowFunction | ts.FunctionExpression>;
  asyncThunkPrefixes: string[];
}

export interface ReduxActionDefinition {
  type: string;
  creatorName?: string;
  payloadDomain?: import("modality-ts/core").AbstractDomain;
}

export function collectSliceDefinitions(
  source: ts.SourceFile,
  imports: ReduxResolvedImports,
): Map<string, ReduxSliceDefinition> {
  const slices = new Map<string, ReduxSliceDefinition>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCreateSliceCall(node.initializer, imports)
    ) {
      const slice = parseCreateSlice(node.name.text, node.initializer, imports);
      if (slice) slices.set(node.name.text, slice);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCreateReducerCall(node.initializer, imports)
    ) {
      const slice = parseCreateReducer(node.name.text, node.initializer);
      if (slice) slices.set(node.name.text, slice);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return slices;
}

export function collectActionCreators(
  source: ts.SourceFile,
  imports: ReduxResolvedImports,
  slices: Map<string, ReduxSliceDefinition>,
): Map<string, ReduxActionDefinition> {
  const actions = new Map<string, ReduxActionDefinition>();
  for (const slice of slices.values()) {
    for (const [creatorName, actionType] of slice.actionCreators) {
      actions.set(creatorName, { type: actionType });
      actions.set(actionType, { type: actionType, creatorName });
    }
    for (const [caseName] of slice.reducerCases) {
      const type = slice.actionTypes.get(caseName);
      if (type) actions.set(type, { type, creatorName: caseName });
    }
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCreateActionCall(node.initializer, imports)
    ) {
      const typeArg = node.initializer.arguments[0];
      if (ts.isStringLiteral(typeArg)) {
        actions.set(node.name.text, {
          type: typeArg.text,
          creatorName: node.name.text,
        });
        actions.set(typeArg.text, {
          type: typeArg.text,
          creatorName: node.name.text,
        });
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCreateAsyncThunkCall(node.initializer, imports)
    ) {
      const prefix = node.initializer.arguments[0];
      if (ts.isStringLiteral(prefix)) {
        for (const suffix of ["pending", "fulfilled", "rejected"] as const) {
          const type = `${prefix.text}/${suffix}`;
          actions.set(type, { type });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return actions;
}

export function lowerSliceActionEffects(
  slice: ReduxSliceDefinition,
  storeName: string,
  sliceKey: string,
  fieldVarIds: ReadonlyMap<string, string>,
  fieldInitials: ReadonlyMap<string, Value>,
): Map<string, EffectIR> {
  const effects = new Map<string, EffectIR>();
  const ctx: ReducerLoweringContext = {
    storeName,
    sliceKey,
    fieldVarIds,
    fieldInitials,
    immer: slice.immer,
    warnings: [],
  };
  for (const [caseName, caseFn] of slice.reducerCases) {
    const actionType =
      slice.actionTypes.get(caseName) ?? `${slice.sliceName}/${caseName}`;
    const effect = lowerReducerCase(caseFn, ctx);
    if (effect !== "unsupported") {
      effects.set(actionType, effect);
      effects.set(caseName, effect);
    } else {
      effects.set(actionType, havocSliceVars(ctx));
      effects.set(caseName, havocSliceVars(ctx));
    }
  }
  for (const [actionType, caseFn] of slice.extraReducerCases) {
    const effect = lowerReducerCase(caseFn, ctx);
    effects.set(
      actionType,
      effect === "unsupported" ? havocSliceVars(ctx) : effect,
    );
  }
  return effects;
}

type Value = import("modality-ts/core").Value;

function parseCreateSlice(
  varName: string,
  call: ts.CallExpression,
  _imports: ReduxResolvedImports,
): ReduxSliceDefinition | undefined {
  const config = call.arguments[0];
  if (!config || !ts.isObjectLiteralExpression(config)) return undefined;
  let sliceName = varName;
  let initialState: ts.ObjectLiteralExpression | undefined;
  const reducerCases = new Map<
    string,
    ts.ArrowFunction | ts.FunctionExpression
  >();
  const actionTypes = new Map<string, string>();
  const actionCreators = new Map<string, string>();
  const extraReducerCases = new Map<
    string,
    ts.ArrowFunction | ts.FunctionExpression
  >();
  const asyncThunkPrefixes: string[] = [];

  for (const prop of config.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyNameFromMember(prop.name);
    if (!name) continue;
    if (name === "name" && ts.isStringLiteral(prop.initializer)) {
      sliceName = prop.initializer.text;
    }
    if (
      name === "initialState" &&
      ts.isObjectLiteralExpression(prop.initializer)
    ) {
      initialState = prop.initializer;
    }
    if (name === "reducers") {
      parseReducersObject(
        prop.initializer,
        sliceName,
        reducerCases,
        actionTypes,
      );
    }
    if (name === "extraReducers") {
      parseExtraReducers(prop.initializer, extraReducerCases);
    }
  }

  return {
    varName,
    sliceName,
    initialState,
    immer: true,
    reducerCases,
    actionTypes,
    actionCreators,
    extraReducerCases,
    asyncThunkPrefixes,
  };
}

function parseCreateReducer(
  varName: string,
  call: ts.CallExpression,
): ReduxSliceDefinition | undefined {
  const initial = call.arguments[0];
  const builder = call.arguments[1];
  const initialState = ts.isObjectLiteralExpression(initial)
    ? initial
    : undefined;
  const extraReducerCases = new Map<
    string,
    ts.ArrowFunction | ts.FunctionExpression
  >();
  if (builder) parseExtraReducers(builder, extraReducerCases);
  return {
    varName,
    sliceName: varName,
    initialState,
    immer: true,
    reducerCases: new Map(),
    actionTypes: new Map(),
    actionCreators: new Map(),
    extraReducerCases,
    asyncThunkPrefixes: [],
  };
}

function parseReducersObject(
  expr: ts.Expression,
  sliceName: string,
  reducerCases: Map<string, ts.ArrowFunction | ts.FunctionExpression>,
  actionTypes: Map<string, string>,
): void {
  if (ts.isObjectLiteralExpression(expr)) {
    for (const prop of expr.properties) {
      let caseName: string | undefined;
      let caseFn: ts.ArrowFunction | ts.FunctionExpression | undefined;
      if (ts.isPropertyAssignment(prop)) {
        caseName = propertyNameFromMember(prop.name);
        if (
          ts.isArrowFunction(prop.initializer) ||
          ts.isFunctionExpression(prop.initializer)
        ) {
          caseFn = prop.initializer;
        }
      } else if (ts.isMethodDeclaration(prop) && prop.name) {
        caseName = propertyNameFromMember(prop.name);
        if (
          prop.body &&
          (ts.isArrowFunction(prop as unknown as ts.ArrowFunction) ||
            ts.isBlock(prop.body))
        ) {
          caseFn = ts.factory.createArrowFunction(
            undefined,
            undefined,
            prop.parameters,
            prop.type,
            ts.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
            prop.body,
          );
        }
      }
      if (caseName && caseFn) {
        reducerCases.set(caseName, caseFn);
        actionTypes.set(caseName, `${sliceName}/${caseName}`);
      }
    }
    return;
  }
  if (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "create" &&
    expr.arguments[0] &&
    (ts.isArrowFunction(expr.arguments[0]) ||
      ts.isFunctionExpression(expr.arguments[0]))
  ) {
    const callback = expr.arguments[0];
    const body = callback.body;
    if (ts.isObjectLiteralExpression(body)) {
      parseReducersObject(body, sliceName, reducerCases, actionTypes);
    }
  }
}

function parseExtraReducers(
  expr: ts.Expression,
  extraReducerCases: Map<string, ts.ArrowFunction | ts.FunctionExpression>,
): void {
  if (
    (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) &&
    ts.isBlock(expr.body)
  ) {
    for (const statement of expr.body.statements) {
      if (!ts.isExpressionStatement(statement)) continue;
      if (!ts.isCallExpression(statement.expression)) continue;
      parseBuilderChain(statement.expression, extraReducerCases);
    }
    return;
  }
  if (ts.isCallExpression(expr)) {
    parseBuilderChain(expr, extraReducerCases);
  }
}

function parseBuilderChain(
  call: ts.CallExpression,
  extraReducerCases: Map<string, ts.ArrowFunction | ts.FunctionExpression>,
): void {
  let current: ts.CallExpression | undefined = call;
  while (current) {
    if (
      ts.isPropertyAccessExpression(current.expression) &&
      current.expression.name.text === "addCase"
    ) {
      const actionArg = current.arguments[0];
      const reducerArg = current.arguments[1];
      const actionType = resolveActionType(actionArg);
      if (
        actionType &&
        reducerArg &&
        (ts.isArrowFunction(reducerArg) || ts.isFunctionExpression(reducerArg))
      ) {
        extraReducerCases.set(actionType, reducerArg);
      }
    }
    if (
      ts.isCallExpression(current.expression) &&
      ts.isPropertyAccessExpression(current.expression.expression) &&
      current.expression.expression.name.text === "addCase"
    ) {
      current = current.expression.expression.expression as ts.CallExpression;
      continue;
    }
    if (ts.isCallExpression(current.expression)) {
      current = current.expression;
      continue;
    }
    break;
  }
}

function resolveActionType(
  expr: ts.Expression | undefined,
): string | undefined {
  if (!expr) return undefined;
  if (ts.isStringLiteral(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    if (expr.name.text === "type") {
      return `${expr.expression.text}.type`;
    }
    if (
      expr.name.text === "pending" ||
      expr.name.text === "fulfilled" ||
      expr.name.text === "rejected"
    ) {
      return `${expr.expression.text}/${expr.name.text}`;
    }
  }
  if (ts.isIdentifier(expr)) return `${expr.text}.type`;
  const lit = literalValue(expr);
  if (typeof lit === "string") return lit;
  return undefined;
}

export function registerSliceActionExports(
  source: ts.SourceFile,
  slices: Map<string, ReduxSliceDefinition>,
  actionEffects: Map<string, EffectIR>,
): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isPropertyAccessExpression(node.initializer) &&
      node.initializer.name.text === "actions"
    ) {
      const sliceVar = node.initializer.expression;
      if (!ts.isIdentifier(sliceVar)) return;
      const slice = slices.get(sliceVar.text);
      if (!slice) return;
      for (const element of node.name.elements) {
        if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) {
          continue;
        }
        const actionName = element.name.text;
        const actionType = slice.actionTypes.get(actionName);
        if (!actionType) continue;
        const effect = actionEffects.get(actionType);
        if (effect) actionEffects.set(actionName, effect);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
