import type { Locator, Transition } from "modality-ts/core";
import * as ts from "typescript";
import type { SemanticTypeContext } from "../../semantic-type-context.js";
import { lineAndColumn } from "../ast.js";
import { safeId, uniqueStrings } from "../ids.js";
import type { BoundExpr, ExtractableHandler, SetterBinding } from "../types.js";
import {
  effectWriteVars,
  havocSetterTransition,
  identityEffect,
  isLoopStatement,
  setterCallFrom,
  settersWrittenIn,
  singleSetterEffect,
  uniqueSetters,
} from "./effects.js";
import { setterArgumentExpr } from "./expressions.js";
import { parseGuardExpression } from "./guards.js";
import { callSummaryFromHandler } from "./locals.js";
import { transitionIdFromSemanticName } from "./semantic-ids.js";
import {
  effectFromSummaries,
  summarizeHandlerStatements,
} from "./statement-driver.js";
import { labelForEvent } from "./ui.js";

export function semanticizeTransition(
  transition: Transition,
  component: string,
  attr: string,
  semanticName: string | undefined,
  fallbackSegment: string,
  semanticSuffix: string,
): Transition {
  if (!semanticName) return transition;
  return {
    ...transition,
    id: transitionIdFromSemanticName(
      component,
      attr,
      semanticName,
      fallbackSegment,
      semanticSuffix,
    ),
  };
}

export function singleSetterTransitionFromHandler(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  locator: Locator | undefined,
  initialLocals: Map<string, BoundExpr>,
  resetSymbols: ReadonlySet<string>,
  valueSuffix?: string,
  types?: SemanticTypeContext,
  semanticName?: string,
): Transition | undefined {
  const summary = callSummaryFromHandler(handler, setters, initialLocals);
  if (!summary) return undefined;
  const setterCall = setterCallFrom(summary.call, setters, types);
  if (!setterCall) return undefined;
  const assignment = setterArgumentExpr(
    setterCall.argument,
    setterCall.setter,
    setters,
    initialLocals,
    resetSymbols,
  );
  if (!assignment) return undefined;
  const suffix = valueSuffix ? `.${valueSuffix}` : "";
  return {
    id: transitionIdFromSemanticName(
      component,
      attr,
      semanticName,
      setterCall.setter.stateName,
      suffix,
    ),
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: {
      kind: "assign",
      var: setterCall.setter.varId,
      expr: assignment.expr,
    },
    reads: assignment.reads,
    writes: [setterCall.setter.varId],
    confidence: "exact",
  };
}

export function sequentialTransitionFromHandler(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  handlers: Map<string, ExtractableHandler>,
  component: string,
  locator: Locator | undefined,
  resetSymbols: ReadonlySet<string> = new Set(["RESET"]),
  initialLocals?: Map<string, BoundExpr>,
  valueSuffix?: string,
  summaryOptions: Parameters<typeof summarizeHandlerStatements>[2] = {},
  semanticName?: string,
): Transition | undefined {
  const summaries = summarizeHandlerStatements(handler, setters, {
    handlers,
    resetSymbols,
    ...(initialLocals ? { initialLocals } : {}),
    ...summaryOptions,
  });
  const onlySummary = summaries?.[0];
  if (!summaries || summaries.length === 0) return undefined;
  if (
    summaries.length === 1 &&
    onlySummary &&
    valueSuffix === undefined &&
    (onlySummary.effect.kind === "assign" ||
      onlySummary.effect.kind === "havoc") &&
    (onlySummary.effect.kind !== "assign" ||
      !onlySummary.effect.var.startsWith("sys:timer:"))
  ) {
    return undefined;
  }
  const effect = effectFromSummaries(summaries);
  const effects = effect.kind === "seq" ? effect.effects : [effect];
  const writes = uniqueStrings(effects.flatMap(effectWriteVars));
  const suffix = valueSuffix ? `.${valueSuffix}` : "";
  const writeSegment = `${writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_")}.seq`;
  return {
    id: transitionIdFromSemanticName(
      component,
      attr,
      semanticName,
      writeSegment,
      suffix,
    ),
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect,
    reads: uniqueStrings(summaries.flatMap((summary) => summary.reads)),
    writes,
    confidence: effects.some((effect) => effect.kind === "havoc")
      ? "over-approx"
      : "exact",
  };
}

export function loopWriteTransitions(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  locator: Locator | undefined,
  semanticName?: string,
): Transition[] {
  if (!ts.isBlock(handler.body)) return [];
  const loopSetters: SetterBinding[] = [];
  const visit = (candidate: ts.Node): void => {
    if (isLoopStatement(candidate)) {
      loopSetters.push(...settersWrittenIn(candidate, setters));
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(handler.body);
  return uniqueSetters(loopSetters).map((setter) =>
    semanticizeTransition(
      havocSetterTransition(
        source,
        fileName,
        node,
        attr,
        component,
        setter,
        locator,
        "loop",
      ),
      component,
      attr,
      semanticName,
      `${setter.stateName}.loop`,
      ".loop",
    ),
  );
}

export function conditionalTransitionFromHandler(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  locator: Locator | undefined,
  initialLocals: Map<string, BoundExpr> = new Map(),
  valueSuffix?: string,
  semanticName?: string,
): Transition | undefined {
  const body = handler.body;
  if (
    !ts.isBlock(body) ||
    body.statements.length !== 1 ||
    !ts.isIfStatement(body.statements[0])
  )
    return undefined;
  const statement = body.statements[0];
  const condition = parseGuardExpression(
    statement.expression,
    setters,
    initialLocals,
    true,
  );
  if (!condition) return undefined;
  const thenEffect =
    singleSetterEffect(statement.thenStatement, setters) ?? identityEffect();
  const elseEffect = statement.elseStatement
    ? (singleSetterEffect(statement.elseStatement, setters) ?? identityEffect())
    : identityEffect();
  if (thenEffect.kind === "seq" && elseEffect.kind === "seq") return undefined;
  const writes = [
    ...new Set([
      ...effectWriteVars(thenEffect),
      ...effectWriteVars(elseEffect),
    ]),
  ];
  const writeSuffix =
    writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_") ||
    "if";
  const suffix = valueSuffix ? `.${valueSuffix}` : "";
  return {
    id: transitionIdFromSemanticName(
      component,
      attr,
      semanticName,
      `${writeSuffix}.if`,
      suffix,
    ),
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: {
      kind: "if",
      cond: condition.expr,
      // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
      then: thenEffect,
      else: elseEffect,
    },
    reads: condition.reads,
    writes,
    confidence: "exact",
  };
}

export function stateNameForVar(
  varId: string,
  setters: Map<string, SetterBinding>,
): string | undefined {
  return [...setters.values()].find((setter) => setter.varId === varId)
    ?.stateName;
}

export function escapedSetterTransitions(
  source: ts.SourceFile,
  fileName: string,
  node: ts.JsxAttribute,
  attr: string,
  component: string,
  setters: readonly SetterBinding[],
  locator: Locator | undefined,
  semanticName?: string,
): Transition[] {
  return setters.map((setter) => ({
    id: transitionIdFromSemanticName(
      component,
      attr,
      semanticName,
      `${setter.stateName}.escaped`,
      ".escaped",
    ),
    cls: "user" as const,
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit" as const, value: true },
    effect: { kind: "havoc" as const, var: setter.varId },
    reads: [],
    writes: [setter.varId],
    confidence: "over-approx" as const,
  }));
}
