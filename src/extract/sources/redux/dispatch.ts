import type { EffectIR } from "modality-ts/core";
import type { CallSite, M0Ctx } from "modality-ts/extract/engine/spi";
import * as ts from "typescript";
import { storeVarId } from "./ids.js";
import type { ReduxResolvedImports } from "./imports.js";
import { isBindActionCreatorsCall } from "./imports.js";
import { havocSliceVars, type ReducerLoweringContext } from "./reducers.js";
import type { DiscoverReduxResult } from "./store.js";
import { anchor } from "./store.js";

export function resolveDispatchedActionType(
  argument: ts.Expression | undefined,
  discovery: DiscoverReduxResult,
): string | undefined {
  if (!argument) return undefined;
  if (ts.isCallExpression(argument)) {
    if (ts.isIdentifier(argument.expression)) {
      const creator = discovery.actionCreators.get(argument.expression.text);
      if (creator) return creator.type;
    }
    if (
      ts.isPropertyAccessExpression(argument.expression) &&
      argument.expression.name.text !== "type"
    ) {
      const creatorName = argument.expression.name.text;
      const effect = discovery.actionEffects.get(creatorName);
      if (effect) {
        const actionsExpr = argument.expression.expression;
        if (
          ts.isPropertyAccessExpression(actionsExpr) &&
          actionsExpr.name.text === "actions" &&
          ts.isIdentifier(actionsExpr.expression)
        ) {
          const slice = discovery.slices.get(actionsExpr.expression.text);
          const actionType = slice?.actionTypes.get(creatorName);
          if (actionType) return actionType;
        }
        return creatorName;
      }
    }
  }
  if (ts.isObjectLiteralExpression(argument)) {
    for (const prop of argument.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const name = prop.name.getText();
      if (name === "type" && ts.isStringLiteral(prop.initializer)) {
        return prop.initializer.text;
      }
    }
  }
  if (ts.isIdentifier(argument)) {
    const action = discovery.actionCreators.get(argument.text);
    if (action) return action.type;
  }
  return undefined;
}

export function effectForDispatchedAction(
  actionType: string | undefined,
  discovery: DiscoverReduxResult,
  storeName?: string,
): EffectIR | "unsupported" {
  if (!actionType) return "unsupported";
  const keyed = storeName ? `${storeName}:${actionType}` : undefined;
  const effect =
    (keyed ? discovery.actionEffects.get(keyed) : undefined) ??
    discovery.actionEffects.get(actionType);
  if (effect) return effect;
  if (storeName) {
    const storeInfo = discovery.storeInfos.get(storeName);
    if (storeInfo) {
      const ctxs: ReducerLoweringContext[] = [];
      for (const sliceKey of storeInfo.sliceKeys.keys()) {
        const fieldVarIds = new Map<string, string>();
        const fields = discovery.storeFields.get(storeName)?.get(sliceKey);
        for (const field of fields ?? []) {
          fieldVarIds.set(field, storeVarId(storeName, `${sliceKey}.${field}`));
        }
        ctxs.push({
          storeName,
          sliceKey,
          fieldVarIds,
          fieldInitials: new Map(),
          immer: true,
        });
      }
      if (ctxs.length === 1 && ctxs[0]) return havocSliceVars(ctxs[0]);
      const effects = ctxs.map((ctx) => havocSliceVars(ctx));
      return { kind: "seq", effects };
    }
  }
  return "unsupported";
}

export function discoverDispatchBindings(
  source: ts.SourceFile,
  _fileName: string,
  imports: ReduxResolvedImports,
  discovery: DiscoverReduxResult,
): Map<string, EffectIR> {
  const bindings = new Map<string, EffectIR>(discovery.actionEffects);
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isBindActionCreatorsCall(node.initializer, imports)
    ) {
      const actionsArg = node.initializer.arguments[0];
      if (actionsArg && ts.isIdentifier(actionsArg)) {
        const slice = discovery.slices.get(actionsArg.text);
        if (slice) {
          for (const [caseName] of slice.reducerCases) {
            const actionType = slice.actionTypes.get(caseName);
            if (!actionType) continue;
            const effect = discovery.actionEffects.get(actionType);
            if (effect) bindings.set(`${node.name.text}.${caseName}`, effect);
          }
        }
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isPropertyAccessExpression(node.initializer) &&
      node.initializer.name.text === "actions"
    ) {
      const sliceVar = node.initializer.expression;
      if (!ts.isIdentifier(sliceVar)) return;
      const slice = discovery.slices.get(sliceVar.text);
      if (!slice) return;
      for (const element of node.name.elements) {
        if (!ts.isBindingElement(element) || !ts.isIdentifier(element.name)) {
          continue;
        }
        const actionType = slice.actionTypes.get(element.name.text);
        if (!actionType) continue;
        const effect = discovery.actionEffects.get(actionType);
        if (effect) bindings.set(element.name.text, effect);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bindings;
}

export function summarizeReduxDispatch(
  call: CallSite,
  _ctx: M0Ctx,
  discovery?: DiscoverReduxResult,
): EffectIR | "unsupported" {
  if (!discovery) return "unsupported";
  const callee = call.callee;
  if (callee !== "dispatch" && !callee.endsWith(".dispatch")) {
    return "unsupported";
  }
  const arg = call.arguments[0];
  if (typeof arg === "string") {
    const effect = effectForDispatchArgument(arg, discovery);
    if (effect) return effect;
  }
  if (arg && typeof arg === "object" && !Array.isArray(arg) && "type" in arg) {
    const actionType = (arg as { type: unknown }).type;
    if (typeof actionType === "string") {
      return effectForDispatchedAction(actionType, discovery);
    }
  }
  const storeName = [...discovery.storeNames][0];
  if (storeName) {
    const fallback = effectForDispatchedAction(undefined, discovery, storeName);
    if (fallback !== "unsupported") return fallback;
  }
  return "unsupported";
}

function effectForDispatchArgument(
  arg: string,
  discovery: DiscoverReduxResult,
): EffectIR | undefined {
  const actionName = arg.replace(/\(\).*$/, "").trim();
  const creatorName = actionName.includes(".")
    ? (actionName.split(".").at(-1) ?? actionName)
    : actionName;
  const direct =
    discovery.actionEffects.get(actionName) ??
    discovery.actionEffects.get(creatorName) ??
    discovery.actionEffects.get(arg);
  if (direct) return direct;
  const actionDef =
    discovery.actionCreators.get(creatorName) ??
    discovery.actionCreators.get(actionName);
  if (actionDef) {
    const effect = effectForDispatchedAction(actionDef.type, discovery);
    if (effect !== "unsupported") return effect;
  }
  return undefined;
}

export function discoverMapDispatchChannels(
  source: ts.SourceFile,
  fileName: string,
  discovery: DiscoverReduxResult,
): import("modality-ts/extract/engine/spi").WriteChannel[] {
  const channels: import("modality-ts/extract/engine/spi").WriteChannel[] = [];
  const visit = (node: ts.Node): void => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) {
      ts.forEachChild(node, visit);
      return;
    }
    if (node.expression.text !== "connect") {
      ts.forEachChild(node, visit);
      return;
    }
    const dispatchMapper = node.arguments[1];
    if (!dispatchMapper || !ts.isObjectLiteralExpression(dispatchMapper)) {
      ts.forEachChild(node, visit);
      return;
    }
    for (const prop of dispatchMapper.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) {
        continue;
      }
      const actionName = prop.initializer.getText();
      const effect = discovery.actionEffects.get(actionName);
      if (!effect) continue;
      channels.push({
        id: `redux:connect.${prop.name.text}.dispatch`,
        varId: primaryWrittenVar(effect) ?? `redux:unknown`,
        symbolName: prop.name.text,
        source: anchor(source, fileName, node),
      });
    }
  };
  visit(source);
  return channels;
}

function primaryWrittenVar(effect: EffectIR): string | undefined {
  if (effect.kind === "assign") return effect.var;
  if (effect.kind === "seq") {
    for (const child of effect.effects) {
      const target = primaryWrittenVar(child);
      if (target) return target;
    }
  }
  if (effect.kind === "havoc") return effect.var;
  return undefined;
}
