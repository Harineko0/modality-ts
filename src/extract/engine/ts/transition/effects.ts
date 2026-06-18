import * as ts from "typescript";
import { lineAndColumn, type ReactEffectHookName } from "../ast.js";
import { uniqueStrings } from "../ids.js";
import type { ExprIR, Locator, Transition } from "modality-ts/core";
import type { EffectSummary, SetterBinding } from "../types.js";
import type { TransitionBinding } from "./concurrent.js";
import type { TimerRegistration } from "./timers.js";
import type { WebSocketRegistration } from "./environment-callbacks.js";
import { webSocketCleanupSummaryFromCall } from "./environment-callbacks.js";
import { finalizeImplicitWebSocketOpens } from "./environment-callbacks.js";
import type { EnvironmentEventConfig } from "../environment-config.js";
import type { ExtractionWarning } from "../types.js";
import type { StatementSummaryOptions } from "./statement-summary.js";
import type { SemanticTypeContext } from "../../spi/index.js";
import { timerClearSummaryFromCall } from "./timers.js";
import { stateVarForName } from "./expressions.js";
import { andGuard } from "./guards.js";
import { labelForEvent } from "./ui.js";
import { effectWriteVars, summarizeStatements } from "./statement-summary.js";
export {
  effectWriteVars,
  PENDING_QUEUE_VAR,
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

export interface EffectExtractionContext {
  timerRegistrations?: TimerRegistration[];
  webSocketRegistrations?: WebSocketRegistration[];
  envTransitions?: Transition[];
  warnings?: ExtractionWarning[];
  timerIndex?: { value: number };
  webSocketIndex?: { value: number };
  environment?: EnvironmentEventConfig;
  transitionBindings?: Map<string, TransitionBinding>;
  types?: SemanticTypeContext;
}

export function transitionsFromUseEffect(
  source: ts.SourceFile,
  fileName: string,
  node: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  component: string,
  hookName: ReactEffectHookName = "useEffect",
  effectContext: EffectExtractionContext = {},
): Transition[] {
  const summaryOptions = effectSummaryOptions(
    source,
    fileName,
    component,
    hookName,
    effectContext,
  );
  const callback = node.arguments[0];
  if (
    !callback ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) ||
    !ts.isBlock(callback.body)
  )
    return [];
  const bodyStatements = callback.body.statements.filter(
    (statement) => !isCleanupReturn(statement),
  );
  const summaries = summarizeEffectStatements(
    bodyStatements,
    setters,
    summaryOptions,
  );
  finalizeImplicitWebSocketOpens(
    source,
    fileName,
    component,
    effectContext.webSocketRegistrations ?? [],
    effectContext.envTransitions ?? [],
  );
  const cleanup = cleanupSummaries(
    callback.body.statements,
    setters,
    summaryOptions,
  );
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
        ? guards.slice(1).reduce(
            (acc, next) => andGuard(acc, next),
            guards[0] ?? {
              kind: "lit" as const,
              value: true,
            },
          )
        : { kind: "lit" as const, value: true };
    transitions.push({
      id: `${component}.${hookName}.${effects
        .flatMap(effectWriteVars)
        .map((varId) => varId.split(".").at(-1) ?? varId)
        .join("_")}`,
      cls: "internal",
      label: { kind: "internal", text: `${component}.${hookName}` },
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
      phase: reactEffectPhase(hookName),
    });
  }
  if (cleanup.length > 0) {
    const cleanupEffects = cleanup.map((summary) => summary.effect);
    const cleanupReads = uniqueStrings(
      cleanup.flatMap((summary) => summary.reads),
    );
    transitions.push({
      id: `${component}.${hookName}.cleanup.${cleanupEffects
        .flatMap(effectWriteVars)
        .map((varId) => varId.split(".").at(-1) ?? varId)
        .join("_")}`,
      cls: "internal",
      label: { kind: "internal", text: `${component}.${hookName}.cleanup` },
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
      phase: reactEffectPhase(hookName),
    });
  }
  return transitions;
}

export function summarizeEffectStatements(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  options: StatementSummaryOptions = {},
): EffectSummary[] | undefined {
  return summarizeStatements(statements, setters, options);
}

export function cleanupSummaries(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  options: StatementSummaryOptions = {},
): EffectSummary[] | undefined {
  const returns = statements.filter(isCleanupReturn);
  if (returns.length === 0) return [];
  if (returns.length > 1) return undefined;
  const expression = returns[0]?.expression;
  if (
    !expression ||
    (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression))
  )
    return undefined;
  if (ts.isBlock(expression.body)) {
    return summarizeEffectStatements(
      expression.body.statements,
      setters,
      options,
    );
  }
  if (ts.isCallExpression(expression.body)) {
    const summary =
      webSocketCleanupSummaryFromCall(
        expression.body,
        options.webSocketBindings ?? new Map(),
      ) ??
      timerClearSummaryFromCall(
        expression.body,
        options.timerBindings ?? new Map(),
      );
    return summary ? [summary] : undefined;
  }
  return undefined;
}

function effectSummaryOptions(
  source: ts.SourceFile,
  fileName: string,
  component: string,
  hookName: ReactEffectHookName,
  effectContext: EffectExtractionContext,
): StatementSummaryOptions {
  return {
    component,
    timerContext: `${component}.${hookName}`,
    timerIndex: effectContext.timerIndex,
    timerBindings: new Map<string, string>(),
    timerRegistrations: effectContext.timerRegistrations,
    webSocketRegistrations: effectContext.webSocketRegistrations,
    webSocketBindings: new Map<string, string>(),
    webSocketIndex: effectContext.webSocketIndex,
    environment: effectContext.environment,
    transitionBindings: effectContext.transitionBindings,
    envTransitions: effectContext.envTransitions,
    warnings: effectContext.warnings,
    fileName,
    source,
    types: effectContext.types,
  };
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

export function reactEffectPhase(hookName: ReactEffectHookName): number {
  return hookName === "useEffect" ? 1 : 0;
}

export function useEffectWritesModeledState(
  node: ts.CallExpression,
  setters: Map<string, SetterBinding>,
): boolean {
  return reactEffectWritesModeledState(node, setters);
}

export function reactEffectWritesModeledState(
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
