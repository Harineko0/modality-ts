import type { EffectIR, Transition } from "modality-ts/core";
import * as ts from "typescript";
import { uniqueSummariesByEffect } from "../../../../compile/index.js";
import { findGuardedRest, guardedRestEffect } from "../../guarded-rest.js";
import { lowerStatement } from "../../lower.js";
import type { SemanticTypeContext } from "../../semantic-type-context.js";
import { createTsSymbolPort } from "../../symbol-port.js";
import { syntaxOnlyTypeContext } from "../../syntax-context.js";
import type { EffectPlugin } from "../../../../engine/spi/index.js";
import {
  currentEngineFramework,
  literalValue,
  recognizeHookFromTs,
} from "../ast.js";
import type { EnvironmentEventConfig } from "../../../../compile/environment-config.js";
import {
  escapedSettersInStatement,
  loopVarsForStatements,
  settersWrittenIn,
  uniqueSetters,
} from "../setter-analysis.js";
import type {
  BoundExpr,
  EffectSummary,
  ExtractableHandler,
  ExtractionWarning,
  SetterBinding,
} from "../types.js";
import type { TransitionBinding } from "./concurrent.js";
import { startTransitionScheduleFromCall } from "./concurrent.js";
import { dispatchTsStatements } from "./dispatch-node.js";
import { dispatchEffectRecognition } from "./effect-model-dispatch.js";
import { createEngineLeafDispatch } from "./engine-leaf-dispatch.js";
import type { WebSocketRegistration } from "./environment-callbacks.js";
import { valueExpr } from "./expressions.js";
import { parseGuardExpression } from "./guards.js";
import { summarizeSetterCall } from "./setter-write.js";
import type { StatementSummaryState } from "./statement-summary-state.js";
import type { TimerRegistration } from "./timers.js";

export {
  effectFromSummaries,
  effectWriteVars,
  identityEffect,
  PENDING_QUEUE_VAR,
  simplifyEffect,
  uniqueSummariesByEffect,
} from "../../../../compile/index.js";
export {
  escapedSetters,
  escapedSettersInStatement,
  isLoopStatement,
  settersWrittenIn,
  uniqueSetters,
} from "../setter-analysis.js";
export {
  type StatementSummaryResetOptions,
  setterCallFrom,
  summarizeSetterCall,
  summarizeSetterWrite,
} from "./setter-write.js";
export type { StatementSummaryState } from "./statement-summary-state.js";

export interface StatementSummaryOptions {
  handlers?: Map<string, ExtractableHandler>;
  initialLocals?: Map<string, BoundExpr>;
  resetSymbols?: ReadonlySet<string>;
  snapshotReads?: boolean;
  snapshottedReads?: ReadonlySet<string>;
  component?: string;
  timerContext?: string;
  timerIndex?: { value: number };
  timerBindings?: Map<string, string>;
  timerRegistrations?: TimerRegistration[];
  webSocketRegistrations?: WebSocketRegistration[];
  webSocketBindings?: Map<string, string>;
  webSocketIndex?: { value: number };
  environment?: EnvironmentEventConfig;
  transitionBindings?: Map<string, TransitionBinding>;
  envTransitions?: Transition[];
  warnings?: ExtractionWarning[];
  fileName?: string;
  source?: ts.SourceFile;
  types?: SemanticTypeContext;
  effectPlugins?: readonly EffectPlugin[];
}

interface StatementSummaryResult {
  summaries: EffectSummary[];
  terminated: boolean;
}

function handlerSummaryState(
  options: StatementSummaryOptions,
): StatementSummaryState {
  return {
    locals: new Map(options.initialLocals),
    handlers: options.handlers,
    resetSymbols: options.resetSymbols,
    snapshotReads: options.snapshotReads ?? true,
    snapshottedReads: options.snapshottedReads,
    component: options.component,
    timerContext: options.timerContext,
    timerIndex: options.timerIndex,
    timerBindings: options.timerBindings,
    timerRegistrations: options.timerRegistrations,
    webSocketRegistrations: options.webSocketRegistrations,
    webSocketBindings: options.webSocketBindings,
    webSocketIndex: options.webSocketIndex,
    environment: options.environment,
    transitionBindings: options.transitionBindings,
    envTransitions: options.envTransitions,
    warnings: options.warnings,
    fileName: options.fileName,
    source: options.source,
    types: options.types,
    effectPlugins: options.effectPlugins,
  };
}

function fallbackSummaries(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
): EffectSummary[] {
  const summaries: EffectSummary[] = [];
  for (const statement of statements) {
    for (const setter of escapedSettersInStatement(statement, setters)) {
      summaries.push({
        effect: { kind: "havoc", var: setter.varId },
        reads: [],
      });
    }
    for (const setter of settersWrittenIn(statement, setters)) {
      summaries.push({
        effect: { kind: "havoc", var: setter.varId },
        reads: [],
      });
    }
  }
  return uniqueSummariesByEffect(summaries);
}

function compileStatementList(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
): StatementSummaryResult | undefined {
  if (!state.source || !state.fileName) return undefined;
  const syntaxContext = syntaxOnlyTypeContext(state.source);
  const typeContext: SemanticTypeContext = state.types ?? {
    program: syntaxContext.program,
    checker: syntaxContext.checker,
    sourceFile: state.source,
    getSourceFile: (fileName: string) =>
      syntaxContext.getSourceFile?.(fileName) ??
      syntaxContext.program.getSourceFile(fileName) ??
      undefined,
  };
  const guarded = findGuardedRest(statements);
  if (guarded) {
    const condition = parseGuardExpression(
      guarded.condition,
      setters,
      state.locals,
      state.snapshotReads,
    );
    const rest = compileStatementList(
      statements.slice(guarded.restIndex),
      setters,
      { ...state, locals: new Map(state.locals) },
    );
    if (!condition || !rest) return undefined;
    const guardedResult = guardedRestEffect(
      condition.expr,
      guarded.thenExits,
      guarded.elseExits,
      rest.summaries,
    );
    if (!guardedResult) return { summaries: [], terminated: false };
    return {
      summaries: guardedResult.summaries.map((summary) => ({
        ...summary,
        reads: [...new Set([...condition.reads, ...summary.reads])],
      })),
      terminated: rest.terminated,
    };
  }
  try {
    const symbols = createTsSymbolPort({
      program: typeContext.program,
      checker: typeContext.checker,
      sourceFile: state.source,
      getSourceFile: typeContext.getSourceFile,
      localSymbolKey: typeContext.localSymbolKey,
      symbolAt: typeContext.symbolAt,
      aliasedSymbolAt: typeContext.aliasedSymbolAt,
    });
    const originNode = (ref: import("../../node-ref.js").NodeRef) =>
      symbols.nodeAt?.(ref);
    if (!originNode) return undefined;
    const leaf = createEngineLeafDispatch({ setters, state, originNode });
    const locals = new Map(
      [...state.locals.entries()].map(([name, binding]) => [
        name,
        {
          expr: binding.expr,
          reads: binding.reads,
          ...(binding.setter ? { setter: binding.setter } : {}),
        },
      ]),
    );
    const taintVars = uniqueSetters(
      statements.flatMap((statement) => settersWrittenIn(statement, setters)),
    ).map((setter) => setter.varId);
    const stateVarIds = new Map(
      [...setters.values()].map((setter) => [setter.stateName, setter.varId]),
    );
    const dispatched = dispatchTsStatements(statements, {
      symbols,
      leaf,
      locals,
      snapshotReads: state.snapshotReads,
      snapshottedReads: state.snapshottedReads,
      stateVarIds,
      loopVars: loopVarsForStatements(statements, setters),
      taintVars,
      lowerStatement,
      fileName: state.fileName,
    });
    if (!dispatched) return undefined;
    return {
      summaries: dispatched.summaries,
      terminated: dispatched.terminated,
    };
  } catch {
    return undefined;
  }
}

function summarizeStatementList(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
): StatementSummaryResult {
  const compiled = compileStatementList(statements, setters, state);
  if (compiled) return compiled;
  return {
    summaries: fallbackSummaries(statements, setters),
    terminated: false,
  };
}

function summarizeStartTransitionCall(
  call: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
): EffectSummary | undefined {
  if (
    !state.component ||
    !state.source ||
    !state.fileName ||
    !state.transitionBindings ||
    !ts.isIdentifier(call.expression)
  ) {
    return undefined;
  }
  const binding = state.transitionBindings.get(call.expression.text);
  if (!binding) return undefined;
  const scheduled = startTransitionScheduleFromCall(
    state.source,
    state.fileName,
    call,
    setters,
    state.component,
    binding,
  );
  if (!scheduled) return undefined;
  state.envTransitions?.push(scheduled.resolveTransition);
  return scheduled.scheduleSummary;
}

function helperSummariesFromCall(
  call: ts.CallExpression,
  state: StatementSummaryState,
  setters: Map<string, SetterBinding>,
): EffectSummary[] | undefined {
  if (!state.handlers || !ts.isIdentifier(call.expression)) return undefined;
  const helper = state.handlers.get(call.expression.text);
  if (!helper || call.arguments.length > helper.parameters.length)
    return undefined;
  const locals = new Map(state.locals);
  for (let index = 0; index < call.arguments.length; index += 1) {
    const parameter = helper.parameters[index];
    const argument = call.arguments[index];
    if (!parameter || !argument || !ts.isIdentifier(parameter.name))
      return undefined;
    const binding = valueExpr(
      argument,
      setters,
      state.locals,
      state.snapshotReads,
      state.snapshottedReads,
    );
    if (!binding) return undefined;
    locals.set(parameter.name.text, binding);
  }
  return summarizeHandlerStatements(helper, setters, {
    handlers: state.handlers,
    initialLocals: locals,
    resetSymbols: state.resetSymbols,
    snapshotReads: state.snapshotReads,
    snapshottedReads: state.snapshottedReads,
    component: state.component,
    timerContext: state.timerContext,
    timerIndex: state.timerIndex,
    timerBindings: state.timerBindings,
    timerRegistrations: state.timerRegistrations,
    transitionBindings: state.transitionBindings,
    envTransitions: state.envTransitions,
    fileName: state.fileName,
    source: state.source,
    types: state.types,
  });
}

export function summarizeHandlerStatements(
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  options: StatementSummaryOptions = {},
): EffectSummary[] | undefined {
  if (ts.isCallExpression(handler.body)) {
    const state = handlerSummaryState(options);
    const hook = recognizeHookFromTs(
      handler.body,
      currentEngineFramework(),
      options.fileName ?? handler.getSourceFile().fileName,
    );
    if (hook?.hook.kind === "start-transition") {
      const scheduled = summarizeStartTransitionCall(
        handler.body,
        setters,
        state,
      );
      if (scheduled) return [scheduled];
    }
    const effectSummary = dispatchEffectRecognition(
      handler.body,
      setters,
      state,
      state.effectPlugins,
    );
    if (effectSummary) return [effectSummary];
    const helper = helperSummariesFromCall(handler.body, state, setters);
    if (helper) return helper;
    const summary = summarizeSetterCall(handler.body, setters, state.locals, {
      resetSymbols: options.resetSymbols,
      types: options.types,
    });
    return summary ? [summary] : undefined;
  }
  if (!ts.isBlock(handler.body)) return undefined;
  return summarizeStatements(handler.body.statements, setters, options);
}

export function summarizeStatements(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  options: StatementSummaryOptions = {},
): EffectSummary[] | undefined {
  const result = summarizeStatementList(statements, setters, {
    locals: new Map(options.initialLocals),
    handlers: options.handlers,
    resetSymbols: options.resetSymbols,
    snapshotReads: options.snapshotReads ?? true,
    snapshottedReads: options.snapshottedReads,
    component: options.component,
    timerContext: options.timerContext,
    timerIndex: options.timerIndex,
    timerBindings: options.timerBindings,
    timerRegistrations: options.timerRegistrations,
    webSocketRegistrations: options.webSocketRegistrations,
    webSocketBindings: options.webSocketBindings,
    webSocketIndex: options.webSocketIndex,
    environment: options.environment,
    transitionBindings: options.transitionBindings,
    envTransitions: options.envTransitions,
    warnings: options.warnings,
    fileName: options.fileName,
    source: options.source,
    types: options.types,
    effectPlugins: options.effectPlugins,
  });
  return result.summaries;
}

function sourceFileForStatements(
  statements: readonly ts.Statement[],
): ts.SourceFile | undefined {
  for (const stmt of statements) {
    const sf = stmt.getSourceFile();
    if (sf?.kind === ts.SyntaxKind.SourceFile) return sf;
    if (ts.isExpressionStatement(stmt)) {
      const exprSf = stmt.expression.getSourceFile();
      if (exprSf?.kind === ts.SyntaxKind.SourceFile) return exprSf;
    }
  }
  return undefined;
}

export function summarizeAsyncSegment(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  snapshottedReads?: ReadonlySet<string>,
  initialLocals?: Map<string, BoundExpr>,
): EffectSummary[] {
  const source = sourceFileForStatements(statements);
  return uniqueSummariesByEffect(
    summarizeStatements(statements, setters, {
      snapshottedReads,
      ...(initialLocals?.size ? { initialLocals } : {}),
      ...(source ? { source, fileName: source.fileName } : {}),
    }) ?? fallbackSummaries(statements, setters),
  );
}

export function summarizeSetterStatement(
  statement: ts.Statement,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
): EffectSummary | undefined {
  if (
    !ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression)
  )
    return undefined;
  return summarizeSetterCall(statement.expression, setters, locals);
}

export function singleSetterEffect(
  statement: ts.Statement,
  setters: Map<string, SetterBinding>,
): Extract<EffectIR, { kind: "assign" }> | undefined {
  if (ts.isBlock(statement) && statement.statements.length === 1)
    return setterAssignEffect(statement.statements[0], setters);
  return setterAssignEffect(statement, setters);
}

export function setterAssignEffect(
  statement: ts.Statement,
  setters: Map<string, { varId: string }>,
): Extract<EffectIR, { kind: "assign" }> | undefined {
  if (
    !ts.isExpressionStatement(statement) ||
    !ts.isCallExpression(statement.expression)
  )
    return undefined;
  const call = statement.expression;
  if (!ts.isIdentifier(call.expression) || call.arguments.length !== 1)
    return undefined;
  const setter = setters.get(call.expression.text);
  const value = literalValue(call.arguments[0]);
  if (!setter || value === undefined) return undefined;
  return { kind: "assign", var: setter.varId, expr: { kind: "lit", value } };
}
