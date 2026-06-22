import * as ts from "typescript";
import { findNodeAt } from "../../../lang/ts/node-ref.js";
import type { SurfaceCall, SurfaceStmt } from "../../../lang/ts/surface-ir.js";
import { resolveEffectPlugins } from "../../spi/effect-model-runtime.js";
import type { EffectCtx, EffectPlugin } from "../../spi/index.js";
import type { EffectSummary, SetterBinding } from "../types.js";
import type { StatementSummaryState } from "./statement-summary-state.js";

type DispatchEffectCtx = EffectCtx & {
  source: ts.SourceFile;
  timerContext?: string;
  timerIndex?: { value: number };
  timerBindings?: Map<string, string>;
  timerRegistrations?: StatementSummaryState["timerRegistrations"];
  webSocketRegistrations?: StatementSummaryState["webSocketRegistrations"];
  webSocketBindings?: Map<string, string>;
  webSocketIndex?: { value: number };
  environment?: StatementSummaryState["environment"];
  transitionBindings?: StatementSummaryState["transitionBindings"];
  envTransitions?: StatementSummaryState["envTransitions"];
  handlers?: StatementSummaryState["handlers"];
  resetSymbols?: StatementSummaryState["resetSymbols"];
  snapshotReads?: StatementSummaryState["snapshotReads"];
  snapshottedReads?: StatementSummaryState["snapshottedReads"];
  warnings?: StatementSummaryState["warnings"];
  types?: StatementSummaryState["types"];
};

export function effectCtxFromStatementState(
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
): DispatchEffectCtx {
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

function activeEffectPlugins(
  state: StatementSummaryState,
  providers?: readonly EffectPlugin[],
): readonly EffectPlugin[] {
  return providers ?? state.effectPlugins ?? resolveEffectPlugins();
}

export function dispatchEffectRecognition(
  call: ts.CallExpression | ts.NewExpression,
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
  providers?: readonly EffectPlugin[],
): EffectSummary | undefined {
  if (!state.component || !state.source || !state.fileName) return undefined;
  const ctx = effectCtxFromStatementState(setters, state);
  for (const provider of activeEffectPlugins(state, providers)) {
    const recognized = provider.recognizeEffect(
      call as unknown as SurfaceCall,
      ctx,
    );
    if (recognized) return recognized.scheduleSummary;
  }
  return undefined;
}

export function dispatchEffectAssignment(
  statement: SurfaceStmt,
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
  providers?: readonly EffectPlugin[],
): boolean {
  if (!state.component || !state.source || !state.fileName) return false;
  const tsStatement = surfaceStmtToExpressionStatement(statement, state.source);
  if (!tsStatement) return false;
  const ctx = effectCtxFromStatementState(setters, state);
  for (const provider of activeEffectPlugins(state, providers)) {
    const recognized = provider.recognizeEffectAssignment?.(statement, ctx);
    if (recognized) return true;
  }
  return false;
}

function surfaceStmtToExpressionStatement(
  statement: SurfaceStmt,
  source: ts.SourceFile,
): ts.ExpressionStatement | undefined {
  if (statement.kind !== "assign") return undefined;
  const node = findNodeAt(source, statement.origin);
  if (!node) return undefined;
  if (ts.isExpressionStatement(node)) return node;
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return ts.factory.createExpressionStatement(node);
  }
  return undefined;
}
