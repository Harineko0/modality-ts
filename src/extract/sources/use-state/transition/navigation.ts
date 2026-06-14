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
import { effectWriteVars } from "./effects.js";
import { callArgumentValue } from "./plugin-calls.js";

export function navigationTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  locator: Locator | undefined,
  routerPlugin: RouterPlugin | undefined,
  routePatterns: readonly string[] = []
): Transition | undefined {
  const navigation = navigationCall(call, routerPlugin, routePatterns);
  if (!navigation) return undefined;
  const routeId = navigation.to ? safeId(navigation.to) : "back";
  return {
    id: `${component}.${attr}.navigate.${routeId}`,
    cls: "nav",
    label: {
      kind: "navigate",
      mode: navigation.mode === "replace" ? "push" : navigation.mode,
      ...(navigation.to ? { to: navigation.to } : {})
    },
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: {
      kind: "navigate",
      mode: navigation.mode,
      ...(navigation.to ? { to: { kind: "lit", value: navigation.to } } : {})
    },
    reads: navigation.mode === "push" || navigation.mode === "back" ? ["sys:route", "sys:history"] : ["sys:history"],
    writes: ["sys:route", "sys:history"],
    confidence: "exact"
  };
}

export function navigationCall(call: ts.CallExpression, routerPlugin: RouterPlugin | undefined, routePatterns: readonly string[] = []): { mode: "push" | "replace" | "back"; to?: string } | undefined {
  const name = callName(call.expression);
  if (!name) return undefined;
  const pluginNavigation = routerPlugin?.navigationCall(name, call.arguments.map(callArgumentValue));
  if (pluginNavigation && pluginNavigation !== "unsupported") return pluginNavigation;
  if (name === "navigate" && call.arguments.length === 1) {
    const to = routeTargetValue(call.arguments[0], routePatterns);
    return typeof to === "string" ? { mode: "push", to } : undefined;
  }
  if ((name.endsWith(".push") || name.endsWith(".replace")) && call.arguments.length === 1) {
    const to = routeTargetValue(call.arguments[0], routePatterns);
    if (typeof to !== "string") return undefined;
    return { mode: name.endsWith(".replace") ? "replace" : "push", to };
  }
  if (name.endsWith(".back") && call.arguments.length === 0) {
    return { mode: "back" };
  }
  return undefined;
}

export function linkNavigationTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.Node,
  component: string,
  routePatterns: readonly string[]
): Transition | undefined {
  if ((!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) || node.tagName.getText(source) !== "Link") return undefined;
  const toAttr = node.attributes.properties.find((property): property is ts.JsxAttribute =>
    ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === "to"
  );
  if (!toAttr) return undefined;
  const to = jsxRouteTarget(toAttr, routePatterns);
  if (!to) return undefined;
  return {
    id: `${component}.Link.navigate.${safeId(to)}`,
    cls: "nav",
    label: { kind: "navigate", mode: "push", to },
    source: [{ file: fileName, ...lineAndColumn(source, toAttr) }],
    guard: routeMountGuard(component, routePatterns),
    effect: { kind: "navigate", mode: "push", to: { kind: "lit", value: to } },
    reads: routeMountReads(component, routePatterns),
    writes: ["sys:route", "sys:history"],
    confidence: "exact"
  };
}












export function escapedSetters(call: ts.CallExpression, setters: Map<string, SetterBinding>, locals: Map<string, BoundExpr> = new Map()): SetterBinding[] {
  return call.arguments
    .filter(ts.isIdentifier)
    .map((arg) => setters.get(arg.text) ?? locals.get(arg.text)?.setter)
    .filter((setter): setter is SetterBinding => Boolean(setter));
}

export function firstNavigationInStatements(statements: readonly ts.Statement[], routePatterns: readonly string[]): { mode: "push" | "replace" | "back"; to?: string } | undefined {
  for (const statement of statements) {
    let found: { mode: "push" | "replace" | "back"; to?: string } | undefined;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isCallExpression(node)) found = navigationCall(node, undefined, routePatterns);
      ts.forEachChild(node, visit);
    };
    visit(statement);
    if (found) return found;
  }
  return undefined;
}

export function navigationEffect(navigation: { mode: "push" | "replace" | "back"; to?: string }): EffectIR {
  return {
    kind: "navigate",
    mode: navigation.mode,
    ...(navigation.to ? { to: { kind: "lit", value: navigation.to } } : {})
  };
}

export function appendEffect(transition: Transition, effect: EffectIR): Transition {
  const current = transition.effect.kind === "seq" ? transition.effect.effects : [transition.effect];
  const writes = uniqueStrings([...transition.writes, ...effectWriteVars(effect)]);
  const reads = uniqueStrings([...transition.reads, ...(effect.kind === "navigate" ? ["sys:route", "sys:history"] : [])]);
  return {
    ...transition,
    effect: { kind: "seq", effects: [...current, effect] },
    reads,
    writes
  };
}
