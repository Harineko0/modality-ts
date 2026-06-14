import * as ts from "typescript";
import {
  callName,
  lineAndColumn,
} from "../ast.js";
import { uniqueStrings } from "../ids.js";
import type { ExprIR, Locator, Transition } from "modality-ts/core";
import type {
  EffectSummary,
  SetterBinding,
} from "../types.js";
import { stateVarForName } from "./expressions.js";
import { andGuard } from "./guards.js";
import { labelForEvent } from "./ui.js";
import {
  effectWriteVars,
  summarizeStatements,
} from "./statement-summary.js";
export {
  effectWriteVars,
  escapedSetters,
  escapedSettersInStatement,
  identityEffect,
  isLoopStatement,
  setterAssignEffect,
  setterCallFrom,
  settersWrittenIn,
  singleSetterEffect,
  summarizeAsyncSegment,
  summarizeSetterCall,
  summarizeSetterStatement,
  uniqueSetters,
  uniqueSummariesByEffect,
} from "./statement-summary.js";

export function havocSetterTransition(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  setter: SetterBinding,
  locator: Locator | undefined,
  suffix: string,
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
    confidence: "over-approx",
  };
}

export function transitionsFromUseEffect(
  source: ts.SourceFile,
  fileName: string,
  node: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  component: string,
): Transition[] {
  const callback = node.arguments[0];
  if (
    !callback ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
    !ts.isBlock(callback.body)
  )
    return [];
  const cleanup = cleanupSummaries(callback.body.statements, setters);
  const bodyStatements = callback.body.statements.filter(
    (statement) => !isCleanupReturn(statement),
  );
  const summaries = summarizeEffectStatements(bodyStatements, setters);
  if (!summaries || !cleanup) return [];
  const transitions: Transition[] = [];
  const effectReads = uniqueStrings(
    summaries.flatMap((summary) => summary.reads),
  );
  const deps = dependencyReads(node.arguments[1], setters, effectReads);
  const effects = summaries.map((summary) => summary.effect);
  const hasExplicitDependencyArray = Boolean(
    node.arguments[1] && ts.isArrayLiteralExpression(node.arguments[1]),
  );
  const hasUntriggeredHavocEffect =
    hasExplicitDependencyArray &&
    deps.length === 0 &&
    effects.some((effect) => effect.kind === "havoc");
  if (effects.length > 0 && !hasUntriggeredHavocEffect) {
    const assignEffects = effects.filter(
      (effect): effect is Extract<Transition["effect"], { kind: "assign" }> =>
        effect.kind === "assign",
    );
    const guards: ExprIR[] = assignEffects.map((effect) => ({
      kind: "neq",
      args: [{ kind: "read", var: effect.var }, effect.expr],
    }));
    const guard =
      guards.length > 0
        ? guards.slice(1).reduce((acc, next) => andGuard(acc, next), guards[0]!)
        : { kind: "lit" as const, value: true };
    transitions.push({
      id: `${component}.useEffect.${effects
        .flatMap(effectWriteVars)
        .map((varId) => varId.split(".").at(-1) ?? varId)
        .join("_")}`,
      cls: "internal",
      label: { kind: "internal", text: `${component}.useEffect` },
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard,
      effect: effects.length === 1 ? effects[0] : { kind: "seq", effects },
      reads: uniqueStrings([
        ...deps,
        ...effectReads,
        ...effects.flatMap(effectWriteVars),
      ]),
      writes: uniqueStrings(effects.flatMap(effectWriteVars)),
      confidence: effects.some((effect) => effect.kind === "havoc")
        ? "over-approx"
        : "exact",
      triggeredBy: deps,
    });
  }
  if (cleanup.length > 0) {
    const cleanupEffects = cleanup.map((summary) => summary.effect);
    const cleanupReads = uniqueStrings(
      cleanup.flatMap((summary) => summary.reads),
    );
    transitions.push({
      id: `${component}.useEffect.cleanup.${cleanupEffects
        .flatMap(effectWriteVars)
        .map((varId) => varId.split(".").at(-1) ?? varId)
        .join("_")}`,
      cls: "internal",
      label: { kind: "internal", text: `${component}.useEffect.cleanup` },
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard: { kind: "lit", value: true },
      effect:
        cleanupEffects.length === 1
          ? cleanupEffects[0]
          : { kind: "seq", effects: cleanupEffects },
      reads: cleanupReads,
      writes: uniqueStrings(cleanupEffects.flatMap(effectWriteVars)),
      confidence: "over-approx",
      triggeredBy: deps,
    });
  }
  return transitions;
}

export function summarizeEffectStatements(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
): EffectSummary[] | undefined {
  return summarizeStatements(statements, setters);
}

export function cleanupSummaries(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
): EffectSummary[] | undefined {
  const returns = statements.filter(isCleanupReturn);
  if (returns.length === 0) return [];
  if (returns.length > 1) return undefined;
  const expression = returns[0]!.expression;
  if (
    !expression ||
    (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) ||
    !ts.isBlock(expression.body)
  )
    return undefined;
  return summarizeEffectStatements(expression.body.statements, setters);
}

export function isCleanupReturn(
  statement: ts.Statement,
): statement is ts.ReturnStatement {
  if (!ts.isReturnStatement(statement) || !statement.expression) return false;
  return (
    ts.isArrowFunction(statement.expression) ||
    ts.isFunctionExpression(statement.expression)
  );
}

export function dependencyReads(
  node: ts.Expression | undefined,
  setters: Map<string, SetterBinding>,
  fallbackReads: readonly string[] = [],
): string[] {
  if (!node || !ts.isArrayLiteralExpression(node)) {
    return uniqueStrings(fallbackReads);
  }
  return [
    ...new Set(
      node.elements.flatMap((element) =>
        ts.isIdentifier(element)
          ? [stateVarForName(element.text, setters)].filter(
              (id): id is string => Boolean(id),
            )
          : [],
      ),
    ),
  ];
}

export function useEffectWritesModeledState(
  node: ts.CallExpression,
  setters: Map<string, SetterBinding>,
): boolean {
  let writes = false;
  const visit = (candidate: ts.Node): void => {
    if (
      ts.isCallExpression(candidate) &&
      ts.isIdentifier(candidate.expression) &&
      setters.has(candidate.expression.text)
    )
      writes = true;
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return writes;
}
