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
import { stateVarForName } from "./expressions.js";
import { labelForEvent } from "./ui.js";

export function pluginWriteTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>,
  sourcePlugins: readonly StateSourcePlugin[],
  locator: Locator | undefined
): Transition | undefined {
  const callee = callName(call.expression);
  if (!callee) return undefined;
  const ctx: M0Ctx = {
    read: (name, path) => {
      const local = locals.get(name);
      if (local?.expr.kind === "read") {
        return { kind: "read", var: local.expr.var, path: [...(local.expr.path ?? []), ...(path ?? [])] };
      }
      const varId = stateVarForName(name, setters) ?? name;
      return { kind: "read", var: varId, ...(path && path.length > 0 ? { path } : {}) };
    },
    locator
  };
  const callSite: CallSite = {
    callee,
    arguments: call.arguments.map(callArgumentValue),
    source: { file: fileName, ...lineAndColumn(source, call) }
  };
  for (const plugin of sourcePlugins) {
    const summary = plugin.summarizeWrite?.(callSite, ctx);
    if (!summary || summary === "unsupported") continue;
    const reads = [...effectReads(summary)].sort();
    const writes = [...effectWrites(summary)].sort();
    return {
      id: `${component}.${attr}.${safeId(plugin.id)}.${safeId(callee)}`,
      cls: "user",
      label: labelForEvent(attr, locator),
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard: { kind: "lit", value: true },
      effect: summary,
      reads,
      writes,
      confidence: "exact"
    };
  }
  return undefined;
}

export function callArgumentValue(argument: ts.Expression): unknown {
  const literal = literalValue(argument);
  if (literal !== undefined) return literal;
  if (ts.isIdentifier(argument)) return argument.text;
  if (ts.isObjectLiteralExpression(argument)) {
    const fields: Record<string, unknown> = {};
    for (const property of argument.properties) {
      if (!ts.isPropertyAssignment(property)) return argument.getText();
      const name = propertyName(property.name);
      if (!name) return argument.getText();
      fields[name] = callArgumentValue(property.initializer);
    }
    return fields;
  }
  return argument.getText();
}

export function swrMutateTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  locator: Locator | undefined
): Transition | undefined {
  if (!ts.isIdentifier(call.expression) || call.expression.text !== "mutate") return undefined;
  return {
    id: `${component}.${attr}.mutate`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "seq", effects: [] },
    reads: [],
    writes: [],
    confidence: "exact"
  };
}

export function noopCallTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  locator: Locator | undefined
): Transition | undefined {
  const name = callName(call.expression) ?? call.expression.getText(source);
  if (!isKnownPureUiCall(name)) return undefined;
  return {
    id: `${component}.${attr}.${safeId(name)}.noop`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "seq", effects: [] },
    reads: [],
    writes: [],
    confidence: "exact"
  };
}

export function isKnownPureUiCall(name: string): boolean {
  return name.endsWith(".click") || name === "confirm" || name === "navigator.clipboard.writeText" || name.endsWith(".writeText");
}
