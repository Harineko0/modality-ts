import {
  type EffectIR,
  type ExprIR,
  effectReads,
  type Locator,
  type Transition,
  type Value,
} from "modality-ts/core";
import * as ts from "typescript";
import type {
  NavIntent,
  RouteInventory,
  RoutePlugin,
} from "../../spi/index.js";
import { callName, lineAndColumn, literalValue, propertyName } from "../ast.js";
import { safeId, uniqueStrings } from "../ids.js";
import {
  normalizeRouteTarget,
  routeMountGuard,
  routeTargetValue,
} from "../routes.js";
import type { BoundExpr, SetterBinding } from "../types.js";
import { effectWriteVars } from "./effects.js";
import { callArgumentValue } from "./plugin-calls.js";

const DEFAULT_HISTORY_CAP = 4;
const HISTORY_UNROLL_THRESHOLD = 512;

function readVar(varId: string, path?: readonly string[]): ExprIR {
  return path
    ? { kind: "read", var: varId, path }
    : { kind: "read", var: varId };
}

function readPreVar(varId: string): ExprIR {
  return { kind: "readPre", var: varId };
}

function litValue(value: Value): ExprIR {
  return { kind: "lit", value };
}

function eqExpr(left: ExprIR, right: ExprIR): ExprIR {
  return { kind: "eq", args: [left, right] };
}

function neqExpr(left: ExprIR, right: ExprIR): ExprIR {
  return { kind: "neq", args: [left, right] };
}

function conjIr(left: ExprIR, right: ExprIR): ExprIR {
  return { kind: "and", args: [left, right] };
}

function disjIr(left: ExprIR, right: ExprIR): ExprIR {
  return { kind: "or", args: [left, right] };
}

function orMany(parts: readonly ExprIR[]): ExprIR {
  if (parts.length === 0) return litValue(false);
  return parts
    .slice(1)
    .reduce((acc, next) => disjIr(acc, next), parts[0] ?? litValue(false));
}

function lenCatExpr(varId: string): ExprIR {
  return { kind: "lenCat", arg: readVar(varId) };
}

function assignEffect(varId: string, expr: ExprIR): EffectIR {
  return { kind: "assign", var: varId, expr };
}

function ifEffect(
  cond: ExprIR,
  then: EffectIR,
  elseBranch: EffectIR,
): EffectIR {
  return { kind: "if", cond, then, else: elseBranch };
}

function seqEffects(effects: readonly EffectIR[]): EffectIR {
  if (effects.length === 0) {
    return assignEffect("__modality_noop", litValue(true));
  }
  if (effects.length === 1) return effects[0]!;
  return { kind: "seq", effects: [...effects] };
}

function identityAssign(varId: string): EffectIR {
  return assignEffect(varId, readVar(varId));
}

function cartesianTuples(
  values: readonly string[],
  length: number,
): string[][] {
  if (length === 0) return [[]];
  return cartesianTuples(values, length - 1).flatMap((prefix) =>
    values.map((value) => [...prefix, value]),
  );
}

function exactHistoryLengthGuard(
  historyVar: string,
  length: number,
  maxLen: number,
): ExprIR {
  if (length === 0) return eqExpr(lenCatExpr(historyVar), litValue("0"));
  if (length === 1) return eqExpr(lenCatExpr(historyVar), litValue("1"));
  let guard = eqExpr(lenCatExpr(historyVar), litValue("many"));
  guard = conjIr(
    guard,
    neqExpr(readVar(historyVar, [String(length - 1)]), litValue(null)),
  );
  if (length < maxLen) {
    guard = conjIr(
      guard,
      eqExpr(readVar(historyVar, [String(length)]), litValue(null)),
    );
  }
  return guard;
}

function historyTupleGuard(
  historyVar: string,
  tuple: readonly string[],
  maxLen: number,
): ExprIR {
  let guard = exactHistoryLengthGuard(historyVar, tuple.length, maxLen);
  for (let index = 0; index < tuple.length; index++) {
    guard = conjIr(
      guard,
      eqExpr(readVar(historyVar, [String(index)]), litValue(tuple[index]!)),
    );
  }
  return guard;
}

function historyShorterThanCap(historyVar: string, cap: number): ExprIR {
  const guards: ExprIR[] = [];
  for (let length = 0; length < cap; length++) {
    guards.push(exactHistoryLengthGuard(historyVar, length, cap));
  }
  return orMany(guards);
}

function historyOverflowAssign(
  historyVar: string,
  cap: number,
  routeValues: readonly string[],
): EffectIR {
  const tuples = cartesianTuples(routeValues, cap);
  if (tuples.length === 0) {
    return assignEffect(historyVar, litValue([]));
  }
  if (tuples.length === 1) {
    return assignEffect(historyVar, litValue(tuples[0]!));
  }
  return {
    kind: "choose",
    var: historyVar,
    among: tuples.map((tuple) => litValue(tuple)),
  };
}

function canUnrollHistory(
  routeValues: readonly string[] | undefined,
  historyCap: number,
): routeValues is readonly string[] {
  if (!routeValues || routeValues.length === 0) return false;
  let states = 1;
  for (let length = 0; length <= historyCap; length++) {
    states += routeValues.length ** length;
    if (states > HISTORY_UNROLL_THRESHOLD) return false;
  }
  return true;
}

function buildPushHistoryEffect(
  historyVar: string,
  currentVar: string,
  historyRouteValues: readonly string[],
  historyCap: number,
): EffectIR {
  let effect: EffectIR = identityAssign(historyVar);
  for (let length = historyCap - 1; length >= 0; length--) {
    for (const tuple of cartesianTuples(historyRouteValues, length)) {
      for (const current of historyRouteValues) {
        const guard = conjIr(
          historyTupleGuard(historyVar, tuple, historyCap),
          eqExpr(readPreVar(currentVar), litValue(current)),
        );
        effect = ifEffect(
          guard,
          assignEffect(historyVar, litValue([...tuple, current])),
          effect,
        );
      }
    }
  }
  return effect;
}

function buildBackHistoryEffect(
  historyVar: string,
  currentVar: string,
  historyRouteValues: readonly string[],
  historyCap: number,
): EffectIR {
  let effect: EffectIR = seqEffects([
    identityAssign(currentVar),
    identityAssign(historyVar),
  ]);
  for (let length = 1; length <= historyCap; length++) {
    for (const tuple of cartesianTuples(historyRouteValues, length)) {
      const previous = tuple.at(-1);
      if (!previous) continue;
      const guard = historyTupleGuard(historyVar, tuple, historyCap);
      const nextHistory = tuple.slice(0, -1);
      effect = ifEffect(
        guard,
        seqEffects([
          assignEffect(currentVar, litValue(previous)),
          assignEffect(historyVar, litValue(nextHistory)),
        ]),
        effect,
      );
    }
  }
  return effect;
}

export function historyRouteValuesForNavigation(
  routePatterns: readonly string[],
  options: { mountRoute?: string; pushTo?: string } = {},
): readonly string[] {
  const values = uniqueStrings(
    [options.mountRoute, options.pushTo].filter(
      (route): route is string => typeof route === "string",
    ),
  );
  return values.length > 0 ? values : routePatterns;
}

export function locationEffect(args: {
  currentVar: string;
  historyVar?: string;
  mode: "push" | "replace" | "back";
  to?: ExprIR;
  historyCap?: number;
  routeValues?: readonly string[];
  historyRouteValues?: readonly string[];
}): {
  effect: EffectIR;
  reads: readonly string[];
  writes: readonly string[];
} {
  const historyVar = args.historyVar ?? "sys:history";
  const historyCap = args.historyCap ?? DEFAULT_HISTORY_CAP;
  const currentVar = args.currentVar;
  const routeValues = args.routeValues ?? ["/"];
  const historyRouteValues = args.historyRouteValues ?? routeValues;

  if (args.mode === "replace") {
    if (!args.to) {
      throw new Error("locationEffect replace requires `to`");
    }
    const effect = assignEffect(currentVar, args.to);
    return {
      effect,
      reads: args.historyVar ? [historyVar] : [],
      writes: [currentVar],
    };
  }

  if (args.mode === "back") {
    const effect = canUnrollHistory(historyRouteValues, historyCap)
      ? buildBackHistoryEffect(
          historyVar,
          currentVar,
          historyRouteValues,
          historyCap,
        )
      : seqEffects([
          { kind: "havoc", var: currentVar },
          { kind: "havoc", var: historyVar },
        ]);
    return {
      effect,
      reads: [currentVar, historyVar],
      writes: [currentVar, historyVar],
    };
  }

  if (!args.to) {
    throw new Error("locationEffect push requires `to`");
  }

  const pushBody = canUnrollHistory(historyRouteValues, historyCap)
    ? seqEffects([
        buildPushHistoryEffect(
          historyVar,
          currentVar,
          historyRouteValues,
          historyCap,
        ),
        assignEffect(currentVar, args.to),
      ])
    : seqEffects([
        { kind: "havoc", var: historyVar },
        assignEffect(currentVar, args.to),
      ]);

  const effect = ifEffect(
    historyShorterThanCap(historyVar, historyCap),
    pushBody,
    historyOverflowAssign(historyVar, historyCap, historyRouteValues),
  );

  return {
    effect,
    reads: [currentVar, historyVar],
    writes: [currentVar, historyVar],
  };
}

export function navigationTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  call: ts.CallExpression,
  _locator: Locator | undefined,
  adapter: RoutePlugin | undefined,
  routePatterns: readonly string[] = [],
  inventory?: RouteInventory,
): Transition | undefined {
  const navigation = navigationCall(call, adapter, routePatterns);
  if (!navigation) return undefined;
  const routeId = navigation.to ? safeId(navigation.to) : "back";
  const intent: NavIntent = {
    mode: navigation.mode,
    ...(navigation.to !== undefined ? { to: navigation.to } : {}),
  };
  const lowered = applyLowerNavigation(
    adapter,
    intent,
    inventory,
    routePatterns,
    {
      ...locationEffect({
        currentVar: "sys:route",
        historyVar: "sys:history",
        mode: navigation.mode,
        to: navigation.to ? { kind: "lit", value: navigation.to } : undefined,
        routeValues: routePatterns,
        historyRouteValues: historyRouteValuesForNavigation(routePatterns, {
          pushTo: navigation.to,
        }),
      }),
      confidence: "exact",
    },
  );
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
    effect: lowered.effect,
    reads: lowered.reads,
    writes: lowered.writes,
    confidence: lowered.confidence,
  };
}

export function navigationCall(
  call: ts.CallExpression,
  adapter: RoutePlugin | undefined,
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
  adapter: RoutePlugin | undefined,
  routePattern: string | undefined,
  inventory?: RouteInventory,
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
  const intent: NavIntent = {
    mode: classified.mode,
    ...(to !== undefined ? { to } : {}),
  };
  const lowered = applyLowerNavigation(
    adapter,
    intent,
    inventory,
    routePatterns,
    {
      ...locationEffect({
        currentVar: "sys:route",
        historyVar: "sys:history",
        mode: classified.mode,
        to: to ? { kind: "lit", value: to } : undefined,
        routeValues: routePatterns,
        historyRouteValues: historyRouteValuesForNavigation(routePatterns, {
          mountRoute: routePattern,
          pushTo: to,
        }),
      }),
      confidence: "exact",
    },
  );
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
    effect: lowered.effect,
    reads: lowered.reads,
    writes: lowered.writes,
    confidence: lowered.confidence,
  };
}

export function isNavigationJsxTag(
  adapter: RoutePlugin | undefined,
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
  adapter: RoutePlugin,
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

function jsxLiteralValue(expression: ts.Expression): unknown {
  const literal = literalValue(expression);
  if (literal !== undefined) return literal;
  if (ts.isObjectLiteralExpression(expression)) {
    const fields: Record<string, unknown> = {};
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) return undefined;
      const name = propertyName(property.name);
      if (!name) return undefined;
      const value = jsxLiteralValue(property.initializer);
      if (value === undefined) return undefined;
      fields[name] = value;
    }
    return fields;
  }
  return undefined;
}

function jsxLiteralAttrs(
  _source: ts.SourceFile,
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
      const literal = jsxLiteralValue(property.initializer.expression);
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
  adapter: RoutePlugin | undefined,
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

export function navigationEffect(
  navigation: {
    mode: "push" | "replace" | "back";
    to?: string;
  },
  options: {
    routeValues?: readonly string[];
    historyCap?: number;
    currentVar?: string;
    historyVar?: string;
  } = {},
): EffectIR {
  return locationEffect({
    currentVar: options.currentVar ?? "sys:route",
    historyVar: options.historyVar ?? "sys:history",
    mode: navigation.mode,
    to: navigation.to ? { kind: "lit", value: navigation.to } : undefined,
    historyCap: options.historyCap,
    routeValues: options.routeValues,
  }).effect;
}

export function applyLowerNavigation(
  adapter: RoutePlugin | undefined,
  intent: NavIntent,
  inventory: RouteInventory | undefined,
  routePatterns: readonly string[],
  fallback: {
    effect: EffectIR;
    reads: readonly string[];
    writes: readonly string[];
    confidence: Transition["confidence"];
  },
): {
  effect: EffectIR;
  reads: readonly string[];
  writes: readonly string[];
  confidence: Transition["confidence"];
} {
  if (!adapter?.lowerNavigation || !inventory) return fallback;
  const lowered = adapter.lowerNavigation(intent, { inventory, routePatterns });
  return {
    effect: lowered.effect,
    reads: lowered.reads,
    writes: lowered.writes,
    confidence: lowered.confidence ?? fallback.confidence,
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
  const reads = uniqueStrings([...transition.reads, ...effectReads(effect)]);
  return {
    ...transition,
    effect: { kind: "seq", effects: [...current, effect] },
    reads,
    writes,
  };
}
