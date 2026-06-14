import * as ts from "typescript";
import { callName, componentNameFor, extractableHandlerInitializer, isExtractableHandler, isPropertyAccessLike, isUseEffectCall, isUseReducerCall, isUseRefCall, isUseStateCall, lineAndColumn, literalValue, propertyName, providerComponentNames } from "../../../engine/ts/ast.js";
import { componentDeclarations, calledCustomHook, customHookDeclarations, detectStatefulListComponents, handlerExpression, inlineCustomHookState, isCustomHookDeclaration, isForwardablePropName, isIntrinsicJsxAttribute, jsxTagName, listRenderedHandlerInfo } from "../../../engine/ts/components.js";
import { bindContextHookObjectDeclaration, discoverContextBindings, emptyContextBindings, setterBindingFromDecl, settersForComponent } from "../../../engine/ts/context.js";
import { safeId, tagStableIdKey, uniqueStrings, withStableTransitionIds } from "../../../engine/ts/ids.js";
import { inputTransitions } from "../../../engine/ts/input-transitions.js";
import { jsxRouteTarget, routeMountGuard, routeMountReads, routeTargetValue, templateRoutePattern } from "../../../engine/ts/routes.js";
import { staticNavigationTransitions } from "../../../engine/ts/static-navigation.js";
import { firstValue, inferUseStateDomain, initialValueForUseState, typeAliasDeclarations } from "../../../engine/ts/domains.js";
import { effectReads, effectWrites, type AbstractDomain, type EffectIR, type ExprIR, type Locator, type StateVarDecl, type Transition, type Value } from "modality-ts/core";
import type { CallSite, M0Ctx, RouterPlugin, StateSourcePlugin } from "../../../engine/spi/index.js";
import type { BoundExpr, ComponentDecl, ExtractableHandler, ExtractedModelSkeleton, ExtractionWarning, EffectSummary, SetterBinding, SetterCall, UseStateExtractionOptions, UseStateExtractionResult } from "../types.js";
import { effectWriteVars, settersWrittenIn, summarizeSetterCall, summarizeSetterStatement, uniqueSetters } from "./effects.js";
import { stateNameForVar } from "./handlers.js";

export function refSetterTaint(node: ts.Node, setters: Map<string, SetterBinding>): { varId: string; node: ts.Node } | undefined {
  if (ts.isVariableDeclaration(node) && node.initializer && isUseRefCall(node.initializer)) {
    const arg = node.initializer.arguments[0];
    if (arg && ts.isIdentifier(arg)) {
      const setter = setters.get(arg.text);
      if (setter) return { varId: setter.varId, node: arg };
    }
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(node.left) && node.left.name.text === "current" && ts.isIdentifier(node.right)) {
    const setter = setters.get(node.right.text);
    if (setter) return { varId: setter.varId, node: node.right };
  }
  return undefined;
}

export function timerSetterTaints(node: ts.Node, setters: Map<string, SetterBinding>): { varId: string; node: ts.Node }[] {
  if (!ts.isCallExpression(node)) return [];
  const name = callName(node.expression);
  if (name !== "setTimeout" && name !== "setInterval") return [];
  const callback = node.arguments[0];
  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) return [];
  if (timerCallbackSummaries(callback, setters)) return [];
  return uniqueSetters(settersWrittenIn(callback.body, setters)).map((setter) => ({ varId: setter.varId, node: callback }));
}

export function transitionsFromTimerCall(
  source: ts.SourceFile,
  fileName: string,
  node: ts.Node,
  setters: Map<string, SetterBinding>,
  component: string
): Transition[] {
  if (!ts.isCallExpression(node)) return [];
  const name = callName(node.expression);
  if (name !== "setTimeout" && name !== "setInterval") return [];
  const callback = node.arguments[0];
  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))) return [];
  const summaries = timerCallbackSummaries(callback, setters);
  if (!summaries || summaries.length === 0) return [];
  const effects = summaries.map((summary) => summary.effect);
  const writes = uniqueStrings(effects.flatMap(effectWriteVars));
  const suffix = writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_") || "callback";
  return [{
    id: `${component}.${name}.${suffix}`,
    cls: "env",
    label: { kind: "timer", key: `${component}.${name}.${suffix}` },
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: effects.length === 1 ? effects[0]! : { kind: "seq", effects },
    reads: uniqueStrings(summaries.flatMap((summary) => summary.reads)),
    writes,
    confidence: effects.some((effect) => effect.kind === "havoc") ? "over-approx" : "exact"
  }];
}

export function timerCallbackSummaries(callback: ExtractableHandler, setters: Map<string, SetterBinding>): EffectSummary[] | undefined {
  if (ts.isCallExpression(callback.body)) {
    const summary = summarizeSetterCall(callback.body, setters);
    return summary ? [summary] : undefined;
  }
  if (!ts.isBlock(callback.body) || callback.body.statements.length === 0) return undefined;
  const summaries: EffectSummary[] = [];
  for (const statement of callback.body.statements) {
    const summary = summarizeSetterStatement(statement, setters);
    if (!summary) return undefined;
    summaries.push(summary);
  }
  return summaries;
}

export function handlerSchedulesModeledTimer(attribute: ts.JsxAttribute, handlers: Map<string, ExtractableHandler>, setters: Map<string, SetterBinding>): boolean {
  if (!attribute.initializer) return false;
  const expression = ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : undefined;
  const handler = handlerExpression(expression, handlers);
  if (!handler) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      const callback = node.arguments[0];
      if (
        (name === "setTimeout" || name === "setInterval") &&
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        timerCallbackSummaries(callback, setters)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(handler.body);
  return found;
}
