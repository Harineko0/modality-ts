/**
 * Extraction of callback-style effect API calls, i.e. mutations of the form:
 *   mutate(args, { onSuccess: () => ..., onError: () => ... })
 *
 * These are distinct from await-based effects (async.ts) and router form
 * submits (router-submit.ts). The pattern is common in TanStack/React Query
 * and plain mutation helpers used inside react-hook-form handleSubmit callbacks.
 */
import * as ts from "typescript";
import type { EffectIR, ExprIR, Locator, Transition } from "modality-ts/core";
import { callName, isExtractableHandler, lineAndColumn } from "../ast.js";
import {
  canonicalEffectOp,
  type EffectOpAliases,
} from "../effect-op-aliases.js";
import { uniqueStrings } from "../ids.js";
import type {
  ExtractableHandler,
  ExtractionWarning,
  SetterBinding,
} from "../types.js";
import {
  effectWriteVars,
  PENDING_QUEUE_VAR,
  summarizeAsyncSegment,
} from "./effects.js";
import {
  combineParsedGuards,
  parseGuardExpression,
  type ParsedGuard,
} from "./guards.js";
import { labelForEvent } from "./ui.js";
import { pendingIs, confidenceForEffects } from "./async.js";

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

interface CallbackEffectCall {
  op: string;
  call: ts.CallExpression;
  statement: ts.Statement;
  /** Arrow/function for onSuccess in the options object, if present. */
  onSuccess?: ExtractableHandler;
  /** Arrow/function for onError in the options object, if present. */
  onError?: ExtractableHandler;
}

function callbackOptionHandler(
  optionsArg: ts.Expression,
  key: string,
): ExtractableHandler | undefined {
  if (!ts.isObjectLiteralExpression(optionsArg)) return undefined;
  for (const prop of optionsArg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name) || prop.name.text !== key) continue;
    if (isExtractableHandler(prop.initializer)) return prop.initializer;
  }
  return undefined;
}

/**
 * Returns the callback-effect call in a statement if the callee is a
 * configured effect API, called without `await` (callback-style).
 */
export function callbackEffect(
  statement: ts.Statement,
  effectApis: Set<string>,
  fileName: string,
  effectOpAliases: EffectOpAliases = new Map(),
): CallbackEffectCall | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined;
  if (!ts.isCallExpression(statement.expression)) return undefined;
  // Exclude await-expressions — those are handled by async.ts
  const call = statement.expression;
  const name = callName(call.expression);
  if (!name) return undefined;
  const rawOp = name;
  const op = canonicalEffectOp(rawOp, fileName, effectOpAliases);
  if (!effectApis.has(op) && !effectApis.has(rawOp)) return undefined;
  const optionsArg = call.arguments[1];
  const onSuccess = optionsArg
    ? callbackOptionHandler(optionsArg, "onSuccess")
    : undefined;
  const onError = optionsArg
    ? callbackOptionHandler(optionsArg, "onError")
    : undefined;
  return { op, call, statement, onSuccess, onError };
}

export function statementHasCallbackEffect(
  statement: ts.Statement,
  effectApis: Set<string>,
  fileName: string,
  effectOpAliases: EffectOpAliases = new Map(),
): boolean {
  return (
    callbackEffect(statement, effectApis, fileName, effectOpAliases) !==
    undefined
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the statement list for a handler body, handling both block and
 * concise arrow-function forms. For a concise body like `() => setState(v)`,
 * wraps the expression in a synthetic ExpressionStatement so downstream
 * statement-walking functions can treat it uniformly.
 */
function handlerStatements(handler: ExtractableHandler): ts.Statement[] {
  if (ts.isBlock(handler.body)) return Array.from(handler.body.statements);
  // Concise arrow body: `() => expr`
  const expr = handler.body as ts.Expression;
  const synthetic = ts.factory.createExpressionStatement(expr);
  return [synthetic];
}

// ---------------------------------------------------------------------------
// Guard peeling (mirrors peelPreAwaitGuards in async.ts, without confirm)
// ---------------------------------------------------------------------------

function earlyReturnGuard(
  statement: ts.Statement,
  setters: Map<string, SetterBinding>,
): ParsedGuard | undefined {
  if (!ts.isIfStatement(statement)) return undefined;
  if (statement.elseStatement) return undefined;
  if (
    !ts.isReturnStatement(statement.thenStatement) &&
    !(
      ts.isBlock(statement.thenStatement) &&
      statement.thenStatement.statements.length === 1 &&
      ts.isReturnStatement(statement.thenStatement.statements[0])
    )
  )
    return undefined;
  const expr = statement.expression;
  if (
    ts.isPrefixUnaryExpression(expr) &&
    expr.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return parseGuardExpression(expr.operand, setters);
  }
  const condGuard = parseGuardExpression(expr, setters);
  if (!condGuard) return undefined;
  return {
    expr: { kind: "not", args: [condGuard.expr] },
    reads: condGuard.reads,
  };
}

function peelCallbackPreGuards(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
): { guard?: ParsedGuard; statements: readonly ts.Statement[] } {
  const guards: ParsedGuard[] = [];
  let index = 0;
  while (index < statements.length) {
    const stmt = statements[index];
    if (!stmt || !ts.isIfStatement(stmt)) break;
    const guard = earlyReturnGuard(stmt, setters);
    if (!guard) break;
    guards.push(guard);
    index += 1;
  }
  return {
    guard: combineParsedGuards(guards),
    statements: statements.slice(index),
  };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function transitionsFromCallbackEffectHandler(
  source: ts.SourceFile,
  fileName: string,
  attr: string,
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  effectApis: Set<string>,
  locator: Locator | undefined,
  _warnings: ExtractionWarning[],
  effectOpAliases: EffectOpAliases = new Map(),
): Transition[] {
  if (!ts.isBlock(handler.body)) return [];
  const allStatements = Array.from(handler.body.statements);

  // Peel leading early-return guards
  const peeled = peelCallbackPreGuards(allStatements, setters);
  const remaining = peeled.statements;

  // Find the callback-effect call statement
  const callbackCallIdx = remaining.findIndex((stmt) =>
    statementHasCallbackEffect(stmt, effectApis, fileName, effectOpAliases),
  );
  if (callbackCallIdx === -1) return [];

  const callbackCallStmt = remaining[callbackCallIdx];
  if (!callbackCallStmt) return [];
  const effect = callbackEffect(
    callbackCallStmt,
    effectApis,
    fileName,
    effectOpAliases,
  );
  if (!effect) return [];
  const { op, onError, onSuccess } = effect;

  // Statements before the mutation call (state writes like setApprovalState("approving"))
  const preCallStatements = remaining.slice(0, callbackCallIdx);

  const preSummaries = summarizeAsyncSegment(preCallStatements, setters);
  const preEffects: EffectIR[] = preSummaries.map((s) => s.effect);
  const preReads = uniqueStrings([
    ...preSummaries.flatMap((s) => s.reads),
    ...(peeled.guard?.reads ?? []),
  ]);

  // Resolve callbacks (handles both block and concise arrow bodies)
  const onSuccessStatements = onSuccess ? handlerStatements(onSuccess) : [];
  const onErrorStatements = onError ? handlerStatements(onError) : [];

  const successSummaries = summarizeAsyncSegment(onSuccessStatements, setters);
  const errorSummaries = summarizeAsyncSegment(onErrorStatements, setters);
  const successEffects: EffectIR[] = successSummaries.map((s) => s.effect);
  const errorEffects: EffectIR[] = errorSummaries.map((s) => s.effect);
  const successReads = uniqueStrings(successSummaries.flatMap((s) => s.reads));
  const errorReads = uniqueStrings(errorSummaries.flatMap((s) => s.reads));

  const baseId = `${component}.${attr}.${op}`;
  const sourceAnchor: Transition["source"] = [
    { file: fileName, ...lineAndColumn(source, handler) },
  ];

  const startGuard: Transition["guard"] = peeled.guard
    ? peeled.guard.expr
    : { kind: "lit", value: true };

  const startEffect: EffectIR = {
    kind: "seq",
    effects: [
      ...preEffects,
      {
        kind: "enqueue",
        op,
        continuation: `${baseId}.cont`,
        args: {} as Record<string, ExprIR>,
      },
    ],
  };

  const enqueue: Transition = {
    id: `${baseId}.start`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: sourceAnchor,
    guard: startGuard,
    effect: startEffect,
    reads: preReads,
    writes: uniqueStrings([
      ...preEffects.flatMap(effectWriteVars),
      PENDING_QUEUE_VAR,
    ]),
    confidence: confidenceForEffects(preEffects),
  };

  const transitions: Transition[] = [enqueue];

  if (successEffects.length > 0) {
    const success: Transition = {
      id: `${baseId}.success`,
      cls: "env",
      label: { kind: "resolve", op, outcome: "success" },
      source: sourceAnchor,
      guard: pendingIs(op),
      effect: {
        kind: "seq",
        effects: [{ kind: "dequeue", index: 0 }, ...successEffects],
      },
      reads: uniqueStrings([PENDING_QUEUE_VAR, ...successReads]),
      writes: [
        ...new Set([
          PENDING_QUEUE_VAR,
          ...successEffects.flatMap(effectWriteVars),
        ]),
      ],
      confidence: confidenceForEffects(successEffects),
    };
    transitions.push(success);
  }

  if (errorEffects.length > 0) {
    const error: Transition = {
      id: `${baseId}.error`,
      cls: "env",
      label: { kind: "resolve", op, outcome: "error" },
      source: sourceAnchor,
      guard: pendingIs(op),
      effect: {
        kind: "seq",
        effects: [{ kind: "dequeue", index: 0 }, ...errorEffects],
      },
      reads: uniqueStrings([PENDING_QUEUE_VAR, ...errorReads]),
      writes: [
        ...new Set([
          PENDING_QUEUE_VAR,
          ...errorEffects.flatMap(effectWriteVars),
        ]),
      ],
      confidence: confidenceForEffects(errorEffects),
    };
    transitions.push(error);
  }

  return transitions;
}

// ---------------------------------------------------------------------------
// Local mutation alias tracking (for const { mutate: approveRequest } = useMutation(...))
// ---------------------------------------------------------------------------

/**
 * Scans a source file for patterns like:
 *   const { mutate: approveRequest } = useApprovalMutation()
 *   const { mutate } = useApprovalMutation()    → local name "mutate"
 * where `useApprovalMutation` ∈ effectApis.
 *
 * Returns a per-file alias map: localName → canonicalOpId.
 */
export function collectMutationAliases(
  source: ts.SourceFile,
  fileName: string,
  effectApis: Set<string>,
  effectOpAliases: EffectOpAliases = new Map(),
): Map<string, string> {
  const aliases = new Map<string, string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      const hookName = callName(node.initializer.expression);
      if (!hookName) {
        ts.forEachChild(node, visit);
        return;
      }
      const op = canonicalEffectOp(hookName, fileName, effectOpAliases);
      if (!effectApis.has(op) && !effectApis.has(hookName)) {
        ts.forEachChild(node, visit);
        return;
      }
      // Look for { mutate: localName } or { mutateAsync: localName }
      for (const element of node.name.elements) {
        const propName =
          element.propertyName && ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : ts.isIdentifier(element.name)
              ? element.name.text
              : undefined;
        if (propName !== "mutate" && propName !== "mutateAsync") continue;
        if (ts.isIdentifier(element.name)) {
          // The local name resolves to the hook's canonical op
          aliases.set(element.name.text, op);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return aliases;
}
