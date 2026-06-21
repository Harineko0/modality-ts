import * as ts from "typescript";
import type { EffectIR } from "modality-ts/core";
import type { ReduxResolvedImports } from "./imports.js";
import { isCreateAsyncThunkCall } from "./imports.js";
import { havocSliceVars } from "./reducers.js";
import type { ReducerLoweringContext } from "./reducers.js";
import type { DiscoverReduxResult } from "./store.js";
import { storeVarId } from "./ids.js";

export function discoverStaticThunks(
  source: ts.SourceFile,
  imports: ReduxResolvedImports,
  discovery: DiscoverReduxResult,
): Map<string, EffectIR> {
  const thunks = new Map<string, EffectIR>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      const effect = lowerStaticThunk(node.initializer, discovery);
      if (effect && effect !== "unsupported") {
        thunks.set(node.name.text, effect);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return thunks;
}

function lowerStaticThunk(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  discovery: DiscoverReduxResult,
): EffectIR | "unsupported" {
  const inner = unwrapThunkBody(fn);
  if (!inner) return "unsupported";
  const dispatchName =
    inner.parameters[0] && ts.isIdentifier(inner.parameters[0].name)
      ? inner.parameters[0].name.text
      : "dispatch";
  const body = inner.body;
  if (!ts.isBlock(body)) return "unsupported";
  const effects: EffectIR[] = [];
  for (const statement of body.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    if (!ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;
    if (!ts.isIdentifier(call.expression) || call.expression.text !== dispatchName) {
      return "unsupported";
    }
    const actionArg = call.arguments[0];
    const actionType = actionArg
      ? resolveThunkDispatchAction(actionArg, discovery)
      : undefined;
    const effect = actionType
      ? discovery.actionEffects.get(actionType)
      : undefined;
    if (effect) effects.push(effect);
    else return "unsupported";
  }
  if (effects.length === 0) return "unsupported";
  if (effects.length === 1) return effects[0] ?? "unsupported";
  return { kind: "seq", effects };
}

function unwrapThunkBody(
  fn: ts.ArrowFunction | ts.FunctionExpression,
): ts.ArrowFunction | ts.FunctionExpression | undefined {
  const body = fn.body;
  if (ts.isBlock(body)) return fn;
  if (
    ts.isArrowFunction(body) ||
    ts.isFunctionExpression(body)
  ) {
    return body;
  }
  if (ts.isParenthesizedExpression(body)) {
    const inner = body.expression;
    if (ts.isArrowFunction(inner) || ts.isFunctionExpression(inner)) {
      return inner;
    }
  }
  return undefined;
}

function resolveThunkDispatchAction(
  argument: ts.Expression,
  discovery: DiscoverReduxResult,
): string | undefined {
  if (ts.isCallExpression(argument) && ts.isIdentifier(argument.expression)) {
    const creator = discovery.actionCreators.get(argument.expression.text);
    if (creator) return creator.type;
    const effect = discovery.actionEffects.get(argument.expression.text);
    if (effect) return argument.expression.text;
  }
  return undefined;
}

export function registerAsyncThunkLifecycle(
  source: ts.SourceFile,
  imports: ReduxResolvedImports,
  discovery: DiscoverReduxResult,
): void {
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isCreateAsyncThunkCall(node.initializer, imports)
    ) {
      const prefixArg = node.initializer.arguments[0];
      if (!ts.isStringLiteral(prefixArg)) return;
      const prefix = prefixArg.text;
      for (const storeName of discovery.storeNames) {
        for (const [sliceKey] of discovery.sliceKeysByStore.get(storeName) ??
          []) {
          const fieldVarIds = new Map<string, string>();
          for (const field of discovery.storeFields.get(storeName)?.get(sliceKey) ??
            []) {
            fieldVarIds.set(field, storeVarId(storeName, `${sliceKey}.${field}`));
          }
          const ctx: ReducerLoweringContext = {
            storeName,
            sliceKey,
            fieldVarIds,
            fieldInitials: new Map(),
            immer: true,
          };
          for (const suffix of ["pending", "fulfilled", "rejected"] as const) {
            const type = `${prefix}/${suffix}`;
            if (!discovery.actionEffects.has(type)) {
              discovery.actionEffects.set(type, havocSliceVars(ctx));
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

export function thunkSafetyWarnings(
  source: ts.SourceFile,
  discovery: DiscoverReduxResult,
): string[] {
  const warnings: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      const inner = unwrapThunkBody(node.initializer);
      if (!inner) return;
      const body = inner.body;
      if (!ts.isBlock(body)) return;
      let hasDispatch = false;
      let hasUnsupported = false;
      for (const statement of body.statements) {
        if (
          ts.isExpressionStatement(statement) &&
          ts.isCallExpression(statement.expression) &&
          ts.isIdentifier(statement.expression.expression) &&
          statement.expression.expression.text === "dispatch"
        ) {
          hasDispatch = true;
          const actionArg = statement.expression.arguments[0];
          if (
            actionArg &&
            !resolveThunkDispatchAction(actionArg, discovery)
          ) {
            hasUnsupported = true;
          }
        }
        if (ts.isForStatement(statement) || ts.isWhileStatement(statement)) {
          hasUnsupported = true;
        }
      }
      if (hasUnsupported) {
        warnings.push(`Redux thunk ${node.name.text} contains unmodeled logic`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return warnings;
}
