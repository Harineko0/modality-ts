import type {
  EffectCtx,
  EffectModelProvider,
} from "../../spi/index.js";
import { resolveEffectModelProviders } from "../../spi/effect-model-runtime.js";
import type { EffectSummary, SetterBinding } from "../types.js";
import type { StatementSummaryState } from "./statement-summary-state.js";
import type * as ts from "typescript";

export function effectCtxFromStatementState(
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
): EffectCtx {
  return {
    component: state.component ?? "",
    source: state.source!,
    fileName: state.fileName ?? "",
    setters,
    timerContext: state.timerContext,
    timerIndex: state.timerIndex,
    timerBindings: state.timerBindings,
    timerRegistrations: state.timerRegistrations,
    webSocketRegistrations: state.webSocketRegistrations,
    webSocketBindings: state.webSocketBindings,
    webSocketIndex: state.webSocketIndex,
    environment: state.environment,
    transitionBindings: state.transitionBindings,
    envTransitions: state.envTransitions,
    handlers: state.handlers,
    resetSymbols: state.resetSymbols,
    snapshotReads: state.snapshotReads,
    snapshottedReads: state.snapshottedReads,
    warnings: state.warnings,
    types: state.types,
  };
}

function activeEffectModelProviders(
  state: StatementSummaryState,
  providers?: readonly EffectModelProvider[],
): readonly EffectModelProvider[] {
  return providers ?? state.effectModelProviders ?? resolveEffectModelProviders();
}

export function dispatchEffectRecognition(
  call: ts.CallExpression | ts.NewExpression,
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
  providers?: readonly EffectModelProvider[],
): EffectSummary | undefined {
  if (!state.component || !state.source || !state.fileName) return undefined;
  const ctx = effectCtxFromStatementState(setters, state);
  for (const provider of activeEffectModelProviders(state, providers)) {
    const recognized = provider.recognizeEffect(call, ctx);
    if (recognized) return recognized.scheduleSummary;
  }
  return undefined;
}

export function dispatchEffectAssignment(
  statement: ts.ExpressionStatement,
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
  providers?: readonly EffectModelProvider[],
): boolean {
  if (!state.component || !state.source || !state.fileName) return false;
  const ctx = effectCtxFromStatementState(setters, state);
  for (const provider of activeEffectModelProviders(state, providers)) {
    const recognized = provider.recognizeEffectAssignment?.(statement, ctx);
    if (recognized) return true;
  }
  return false;
}
