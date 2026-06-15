import * as ts from "typescript";
import { callName, lineAndColumn, literalValue } from "../ast.js";
import { safeId, uniqueStrings } from "../ids.js";
import {
  normalizeRouteTarget,
  routeMountGuard,
  routeMountReads,
  routeTargetValue,
} from "../routes.js";
import type { EffectIR, Locator, Transition } from "modality-ts/core";
import type { NavigationAdapter } from "../../spi/index.js";
import type { BoundExpr, SetterBinding } from "../types.js";
import { effectWriteVars } from "./effects.js";
import { callArgumentValue } from "./plugin-calls.js";

export function navigationTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  _locator: Locator | undefined,
  adapter: NavigationAdapter | undefined,
  routePatterns: readonly string[] = [],
): Transition | undefined {
  const navigation = navigationCall(call, adapter, routePatterns);
  if (!navigation) return undefined;
  const routeId = navigation.to ? safeId(navigation.to) : "back";
  return {
    id: `${component}.${attr}.navigate.${routeId}`,
    cls: "nav",
    label: {
      kind: "navigate",
      mode: navigation.mode === "replace" ? "push" : navigation.mode,
      ...(navigation.to ? { to: navigation.to } : {}),
    },
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: {
      kind: "navigate",
      mode: navigation.mode,
      ...(navigation.to ? { to: { kind: "lit", value: navigation.to } } : {}),
    },
    reads:
      navigation.mode === "push" || navigation.mode === "back"
        ? ["sys:route", "sys:history"]
        : ["sys:history"],
    writes: ["sys:route", "sys:history"],
    confidence: "exact",
  };
}

export function navigationCall(
  call: ts.CallExpression,
  adapter: NavigationAdapter | undefined,
  routePatterns: readonly string[] = [],
): { mode: "push" | "replace" | "back"; to?: string } | undefined {
  const name = callName(call.expression);
  if (!name || !adapter) return undefined;
  const classified = adapter.classifyNavigationCall(
    name,
    call.arguments.map(callArgumentValue),
  );
  if (!classified || classified === "unsupported") return undefined;
  const to =
    classified.to !== undefined
      ? normalizeRouteTarget(classified.to, routePatterns)
      : undefined;
  return { mode: classified.mode, ...(to !== undefined ? { to } : {}) };
}

export function navigationJsxTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.Node,
  component: string,
  routePatterns: readonly string[],
  adapter: NavigationAdapter | undefined,
  routePattern: string | undefined,
): Transition | undefined {
  if (
    !adapter?.classifyNavigationJsx ||
    (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node))
  )
    return undefined;
  const tag = node.tagName.getText(source);
  const attrs = jsxLiteralAttrs(source, node, routePatterns);
  const classified = adapter.classifyNavigationJsx(tag, attrs);
  if (!classified || classified === "unsupported") return undefined;
  const to =
    classified.to !== undefined
      ? normalizeRouteTarget(classified.to, routePatterns)
      : undefined;
  if (classified.mode !== "back" && !to) return undefined;
  const routeId = to ? safeId(to) : "back";
  return {
    id: `${component}.${tag}.navigate.${routeId}`,
    cls: "nav",
    label: {
      kind: "navigate",
      mode: classified.mode === "replace" ? "push" : classified.mode,
      ...(to ? { to } : {}),
    },
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: routeMountGuard(routePattern),
    effect: {
      kind: "navigate",
      mode: classified.mode,
      ...(to ? { to: { kind: "lit", value: to } } : {}),
    },
    reads: routeMountReads(routePattern),
    writes: ["sys:route", "sys:history"],
    confidence: "exact",
  };
}

export function isNavigationJsxTag(
  adapter: NavigationAdapter | undefined,
  tag: string,
): boolean {
  if (!adapter?.classifyNavigationJsx) return false;
  return ["to", "href"].some(
    (attr) =>
      adapter.classifyNavigationJsx?.(tag, new Map([[attr, ""]])) !==
      "unsupported",
  );
}

export function navigationRouteJsxAttribute(
  adapter: NavigationAdapter,
  tag: string,
  properties: ts.NodeArray<ts.JsxAttributeLike>,
): ts.JsxAttribute | undefined {
  for (const property of properties) {
    if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name))
      continue;
    const probe = new Map<string, unknown>([[property.name.text, ""]]);
    if (adapter.classifyNavigationJsx?.(tag, probe) !== "unsupported")
      return property;
  }
  return undefined;
}

function jsxLiteralAttrs(
  source: ts.SourceFile,
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  routePatterns: readonly string[],
): Map<string, unknown> {
  const attrs = new Map<string, unknown>();
  for (const property of node.attributes.properties) {
    if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name))
      continue;
    const name = property.name.text;
    if (!property.initializer) {
      attrs.set(name, true);
      continue;
    }
    if (ts.isStringLiteral(property.initializer)) {
      attrs.set(name, property.initializer.text);
      continue;
    }
    if (
      ts.isJsxExpression(property.initializer) &&
      property.initializer.expression
    ) {
      const routeValue = routeTargetValue(
        property.initializer.expression,
        routePatterns,
      );
      if (routeValue !== undefined) {
        attrs.set(name, routeValue);
        continue;
      }
      const literal = literalValue(property.initializer.expression);
      if (literal !== undefined) attrs.set(name, literal);
    }
  }
  return attrs;
}

export function escapedSetters(
  call: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
): SetterBinding[] {
  return call.arguments
    .filter(ts.isIdentifier)
    .map((arg) => setters.get(arg.text) ?? locals.get(arg.text)?.setter)
    .filter((setter): setter is SetterBinding => Boolean(setter));
}

export function firstNavigationInStatements(
  statements: readonly ts.Statement[],
  adapter: NavigationAdapter | undefined,
  routePatterns: readonly string[],
): { mode: "push" | "replace" | "back"; to?: string } | undefined {
  for (const statement of statements) {
    let found: { mode: "push" | "replace" | "back"; to?: string } | undefined;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isCallExpression(node))
        found = navigationCall(node, adapter, routePatterns);
      ts.forEachChild(node, visit);
    };
    visit(statement);
    if (found) return found;
  }
  return undefined;
}

export function navigationEffect(navigation: {
  mode: "push" | "replace" | "back";
  to?: string;
}): EffectIR {
  return {
    kind: "navigate",
    mode: navigation.mode,
    ...(navigation.to ? { to: { kind: "lit", value: navigation.to } } : {}),
  };
}

export function appendEffect(
  transition: Transition,
  effect: EffectIR,
): Transition {
  const current =
    transition.effect.kind === "seq"
      ? transition.effect.effects
      : [transition.effect];
  const writes = uniqueStrings([
    ...transition.writes,
    ...effectWriteVars(effect),
  ]);
  const reads = uniqueStrings([
    ...transition.reads,
    ...(effect.kind === "navigate" ? ["sys:route", "sys:history"] : []),
  ]);
  return {
    ...transition,
    effect: { kind: "seq", effects: [...current, effect] },
    reads,
    writes,
  };
}
