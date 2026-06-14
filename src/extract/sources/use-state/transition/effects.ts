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
import { setterArgumentExpr, stateVarForName } from "./expressions.js";
import { andGuard } from "./guards.js";
import { bindConstStatement } from "./locals.js";
import { labelForEvent } from "./ui.js";

export function isLoopStatement(statement: ts.Statement): boolean {
  return ts.isForStatement(statement) ||
    ts.isForInStatement(statement) ||
    ts.isForOfStatement(statement) ||
    ts.isWhileStatement(statement) ||
    ts.isDoStatement(statement);
}

export function settersWrittenIn(node: ts.Node, setters: Map<string, SetterBinding>): SetterBinding[] {
  const found: SetterBinding[] = [];
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate)) {
      const setterCall = setterCallFrom(candidate, setters);
      if (setterCall) found.push(setterCall.setter);
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}

export function uniqueSetters(setters: readonly SetterBinding[]): SetterBinding[] {
  const byVar = new Map<string, SetterBinding>();
  for (const setter of setters) byVar.set(setter.varId, setter);
  return [...byVar.values()].sort((left, right) => left.varId.localeCompare(right.varId));
}

export function setterCallFrom(call: ts.CallExpression, setters: Map<string, SetterBinding>): SetterCall | undefined {
  if (ts.isIdentifier(call.expression) && call.arguments.length === 1) {
    const setter = setters.get(call.expression.text);
    return setter ? { setter, argument: call.arguments[0]! } : undefined;
  }
  const name = callName(call.expression);
  const atomArg = call.arguments[0];
  if (name && call.arguments.length === 2 && atomArg && ts.isIdentifier(atomArg)) {
    const setter = setters.get(`${name}:${atomArg.text}`);
    return setter ? { setter, argument: call.arguments[1]! } : undefined;
  }
  return undefined;
}

export function havocSetterTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  setter: SetterBinding,
  locator: Locator | undefined,
  suffix: string
): Transition {
  return {
    id: `${component}.${attr}.${setter.stateName}.${suffix}`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: { kind: "havoc", var: setter.varId },
    reads: [],
    writes: [setter.varId],
    confidence: "over-approx"
  };
}

export function singleSetterEffect(statement: ts.Statement, setters: Map<string, SetterBinding>): Extract<Transition["effect"], { kind: "assign" }> | undefined {
  if (ts.isBlock(statement) && statement.statements.length === 1) return setterAssignEffect(statement.statements[0], setters);
  return setterAssignEffect(statement, setters);
}

export function setterAssignEffect(statement: ts.Statement, setters: Map<string, { varId: string }>): Extract<Transition["effect"], { kind: "assign" }> | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return undefined;
  const call = statement.expression;
  if (!ts.isIdentifier(call.expression) || call.arguments.length !== 1) return undefined;
  const setter = setters.get(call.expression.text);
  const value = literalValue(call.arguments[0]);
  if (!setter || value === undefined) return undefined;
  return { kind: "assign", var: setter.varId, expr: { kind: "lit", value } };
}

export function identityEffect(): Extract<Transition["effect"], { kind: "seq" }> {
  return { kind: "seq", effects: [] };
}

export function effectWriteVars(effect: Transition["effect"]): string[] {
  if (effect.kind === "assign" || effect.kind === "havoc" || effect.kind === "choose") return [effect.var];
  if (effect.kind === "seq") return effect.effects.flatMap(effectWriteVars);
  if (effect.kind === "if") return [...effectWriteVars(effect.then), ...effectWriteVars(effect.else)];
  if (effect.kind === "enqueue" || effect.kind === "dequeue") return ["sys:pending"];
  if (effect.kind === "navigate") return ["sys:route", "sys:history"];
  return [...effect.ref.declaredWrites];
}

export function summarizeAsyncSegment(statements: readonly ts.Statement[], setters: Map<string, SetterBinding>): EffectSummary[] {
  const summaries: EffectSummary[] = [];
  for (const statement of statements) {
    const summary = summarizeSetterStatement(statement, setters);
    if (summary) {
      summaries.push(summary);
      continue;
    }
    for (const setter of escapedSettersInStatement(statement, setters)) {
      summaries.push({ effect: { kind: "havoc", var: setter.varId }, reads: [] });
    }
    for (const setter of settersWrittenIn(statement, setters)) {
      summaries.push({ effect: { kind: "havoc", var: setter.varId }, reads: [] });
    }
  }
  return uniqueSummariesByEffect(summaries);
}

export function escapedSettersInStatement(statement: ts.Statement, setters: Map<string, SetterBinding>): SetterBinding[] {
  const found: SetterBinding[] = [];
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate)) found.push(...escapedSetters(candidate, setters));
    ts.forEachChild(candidate, visit);
  };
  visit(statement);
  return uniqueSetters(found);
}

export function escapedSetters(call: ts.CallExpression, setters: Map<string, SetterBinding>, locals: Map<string, BoundExpr> = new Map()): SetterBinding[] {
  return call.arguments
    .filter(ts.isIdentifier)
    .map((arg) => setters.get(arg.text) ?? locals.get(arg.text)?.setter)
    .filter((setter): setter is SetterBinding => Boolean(setter));
}

export function uniqueSummariesByEffect(summaries: readonly EffectSummary[]): EffectSummary[] {
  const seen = new Set<string>();
  const out: EffectSummary[] = [];
  for (const summary of summaries) {
    const key = JSON.stringify(summary.effect);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(summary);
  }
  return out;
}

export function summarizeSetterStatement(statement: ts.Statement, setters: Map<string, SetterBinding>, locals: Map<string, BoundExpr> = new Map()): EffectSummary | undefined {
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) return undefined;
  return summarizeSetterCall(statement.expression, setters, locals);
}

export function summarizeSetterCall(call: ts.CallExpression, setters: Map<string, SetterBinding>, locals: Map<string, BoundExpr> = new Map()): EffectSummary | undefined {
  const setterCall = setterCallFrom(call, setters);
  if (!setterCall) return undefined;
  const assignment = setterArgumentExpr(setterCall.argument, setterCall.setter, setters, locals);
  if (!assignment) {
    return {
      effect: { kind: "havoc", var: setterCall.setter.varId },
      reads: []
    };
  }
  return {
    effect: { kind: "assign", var: setterCall.setter.varId, expr: assignment.expr },
    reads: assignment.reads
  };
}

export function transitionsFromUseEffect(
  source: ts.SourceFile,
  fileName: string,
  node: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  component: string
): Transition[] {
  const callback = node.arguments[0];
  if (!callback || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) || !ts.isBlock(callback.body)) return [];
  const cleanup = cleanupSummaries(callback.body.statements, setters);
  const bodyStatements = callback.body.statements.filter((statement) => !isCleanupReturn(statement));
  const summaries = summarizeEffectStatements(bodyStatements, setters);
  if (!summaries || !cleanup) return [];
  const transitions: Transition[] = [];
  const effectReads = uniqueStrings(summaries.flatMap((summary) => summary.reads));
  const deps = dependencyReads(node.arguments[1], setters, effectReads);
  const effects = summaries.map((summary) => summary.effect);
  const hasExplicitDependencyArray = Boolean(node.arguments[1] && ts.isArrayLiteralExpression(node.arguments[1]));
  const hasUntriggeredHavocEffect = hasExplicitDependencyArray && deps.length === 0 && effects.some((effect) => effect.kind === "havoc");
  if (effects.length > 0 && !hasUntriggeredHavocEffect) {
    const assignEffects = effects.filter((effect): effect is Extract<Transition["effect"], { kind: "assign" }> => effect.kind === "assign");
    const guards: ExprIR[] = assignEffects.map((effect) => ({ kind: "neq", args: [{ kind: "read", var: effect.var }, effect.expr] }));
    const guard = guards.length > 0 ? guards.slice(1).reduce((acc, next) => andGuard(acc, next), guards[0]!) : { kind: "lit" as const, value: true };
    transitions.push({
      id: `${component}.useEffect.${effects.flatMap(effectWriteVars).map((varId) => varId.split(".").at(-1) ?? varId).join("_")}`,
      cls: "internal",
      label: { kind: "internal", text: `${component}.useEffect` },
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard,
      effect: effects.length === 1 ? effects[0] : { kind: "seq", effects },
      reads: uniqueStrings([...deps, ...effectReads, ...effects.flatMap(effectWriteVars)]),
      writes: uniqueStrings(effects.flatMap(effectWriteVars)),
      confidence: effects.some((effect) => effect.kind === "havoc") ? "over-approx" : "exact",
      triggeredBy: deps
    });
  }
  if (cleanup.length > 0) {
    const cleanupEffects = cleanup.map((summary) => summary.effect);
    const cleanupReads = uniqueStrings(cleanup.flatMap((summary) => summary.reads));
    transitions.push({
      id: `${component}.useEffect.cleanup.${cleanupEffects.flatMap(effectWriteVars).map((varId) => varId.split(".").at(-1) ?? varId).join("_")}`,
      cls: "internal",
      label: { kind: "internal", text: `${component}.useEffect.cleanup` },
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard: { kind: "lit", value: true },
      effect: cleanupEffects.length === 1 ? cleanupEffects[0] : { kind: "seq", effects: cleanupEffects },
      reads: cleanupReads,
      writes: uniqueStrings(cleanupEffects.flatMap(effectWriteVars)),
      confidence: "over-approx",
      triggeredBy: deps
    });
  }
  return transitions;
}

export function summarizeEffectStatements(statements: readonly ts.Statement[], setters: Map<string, SetterBinding>): EffectSummary[] | undefined {
  const locals = new Map<string, BoundExpr>();
  const summaries: EffectSummary[] = [];
  for (const statement of statements) {
    if (bindConstStatement(statement, setters, locals)) continue;
    const summary = summarizeSetterStatement(statement, setters, locals);
    if (!summary) return undefined;
    summaries.push(summary);
  }
  return summaries;
}

export function cleanupSummaries(statements: readonly ts.Statement[], setters: Map<string, SetterBinding>): EffectSummary[] | undefined {
  const returns = statements.filter(isCleanupReturn);
  if (returns.length === 0) return [];
  if (returns.length > 1) return undefined;
  const expression = returns[0]!.expression;
  if (!expression || (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) || !ts.isBlock(expression.body)) return undefined;
  return summarizeEffectStatements(expression.body.statements, setters);
}

export function isCleanupReturn(statement: ts.Statement): statement is ts.ReturnStatement {
  if (!ts.isReturnStatement(statement) || !statement.expression) return false;
  return ts.isArrowFunction(statement.expression) || ts.isFunctionExpression(statement.expression);
}

export function dependencyReads(node: ts.Expression | undefined, setters: Map<string, SetterBinding>, fallbackReads: readonly string[] = []): string[] {
  if (!node || !ts.isArrayLiteralExpression(node)) {
    return uniqueStrings(fallbackReads);
  }
  return [...new Set(node.elements.flatMap((element) => ts.isIdentifier(element) ? [stateVarForName(element.text, setters)].filter((id): id is string => Boolean(id)) : []))];
}

export function useEffectWritesModeledState(node: ts.CallExpression, setters: Map<string, SetterBinding>): boolean {
  let writes = false;
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate) && ts.isIdentifier(candidate.expression) && setters.has(candidate.expression.text)) writes = true;
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return writes;
}
