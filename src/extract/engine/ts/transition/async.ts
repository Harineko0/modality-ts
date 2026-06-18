import * as ts from "typescript";
import { callName, lineAndColumn, literalValue, propertyName } from "../ast.js";
import { uniqueStrings } from "../ids.js";
import { templateRoutePattern } from "../routes.js";
import type {
  EffectIR,
  ExprIR,
  Locator,
  StateVarDecl,
  Transition,
  Value,
} from "modality-ts/core";
import {
  canonicalEffectOp,
  type EffectOpAliases,
} from "../effect-op-aliases.js";
import type { NavigationAdapter } from "../../spi/index.js";
import type {
  BoundExpr,
  ExtractableHandler,
  ExtractionWarning,
  EffectSummary,
  SetterBinding,
} from "../types.js";
import {
  effectWriteVars,
  PENDING_QUEUE_VAR,
  summarizeAsyncSegment,
} from "./effects.js";
import { valueExpr } from "./expressions.js";
import {
  andGuard,
  combineParsedGuards,
  parseGuardExpression,
  type ParsedGuard,
} from "./guards.js";
import {
  firstNavigationInStatements,
  navigationEffect,
  appendEffect,
} from "./navigation.js";
import { labelForEvent } from "./ui.js";
import {
  unhandledRejectionCaveat,
  unextractableHandlerCaveat,
} from "../caveats.js";

export interface AwaitedEffect {
  op: string;
  call: ts.CallExpression;
  statement: ts.Statement;
  bindingName?: string;
}

export function transitionsFromAsyncHandler(
  source: ts.SourceFile,
  fileName: string,
  attr: string,
  expression: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  component: string,
  effectApis: Set<string>,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
  locator: Locator | undefined,
  adapter: NavigationAdapter | undefined,
  routePatterns: readonly string[],
  warnings: ExtractionWarning[],
  effectOpAliases: EffectOpAliases = new Map(),
): Transition[] {
  if (!ts.isBlock(expression.body)) return [];
  if (containsAwaitInLoop(expression.body)) {
    const { line, column } = lineAndColumn(source, expression);
    warnings.push({
      message: `Unextractable handler ${component}.${attr} [await-in-loop] (${fileName}:${line}:${column})`,
      line,
      column,
      caveat: unextractableHandlerCaveat(
        `${component}.${attr}`,
        "await-in-loop",
        { file: fileName, line, column },
      ),
    });
    return [];
  }
  const statements = expression.body.statements;
  const tryStatement = statements.find(ts.isTryStatement);
  const awaitStatement = tryStatement
    ? tryStatement.tryBlock.statements.find((statement) =>
        statementHasAwaitedEffect(
          statement,
          effectApis,
          fileName,
          effectOpAliases,
        ),
      )
    : statements.find((statement) =>
        statementHasAwaitedEffect(
          statement,
          effectApis,
          fileName,
          effectOpAliases,
        ),
      );
  if (!awaitStatement) return [];
  const awaited = awaitedEffect(
    awaitStatement,
    effectApis,
    fileName,
    effectOpAliases,
  );
  const op = awaited?.op;
  if (!op) return [];
  const opArgs = awaited
    ? effectCallArgs(awaited.call, setters, new Map())
    : { args: {}, reads: [] };
  const preStatements = tryStatement
    ? statements.slice(0, statements.indexOf(tryStatement))
    : statements.slice(0, statements.indexOf(awaitStatement));
  const peeled = peelPreAwaitGuards(
    preStatements,
    setters,
    component,
    attr,
    op,
    locator,
    [{ file: fileName, ...lineAndColumn(source, expression) }],
  );
  const preSummaries = summarizeAsyncSegment(peeled.statements, setters);
  const outcomeLocals = outcomeLocalsForAwaitedEffect(awaited, asyncOutcomes);
  const successStatements = tryStatement
    ? tryStatement.tryBlock.statements.slice(
        tryStatement.tryBlock.statements.indexOf(awaitStatement) + 1,
      )
    : statements.slice(statements.indexOf(awaitStatement) + 1);
  if (!tryStatement) {
    const chained = transitionsFromSequentialAwait(
      source,
      fileName,
      attr,
      expression,
      awaitStatement,
      op,
      preSummaries,
      successStatements,
      setters,
      effectApis,
      component,
      locator,
      warnings,
      effectOpAliases,
      outcomeLocals,
    );
    if (chained.length > 0)
      return [...chained, ...(peeled.declined ? [peeled.declined] : [])];
  }
  if (
    containsAwaitedEffect(
      successStatements,
      effectApis,
      fileName,
      effectOpAliases,
    ) ||
    (tryStatement?.catchClause &&
      containsAwaitedEffect(
        tryStatement.catchClause.block.statements,
        effectApis,
        fileName,
        effectOpAliases,
      ))
  ) {
    const { line, column } = lineAndColumn(source, awaitStatement);
    warnings.push({
      message: `Unextractable handler ${component}.${attr} [awaited-effect-in-async] (${fileName}:${line}:${column})`,
      line,
      column,
      caveat: unextractableHandlerCaveat(
        `${component}.${attr}`,
        "awaited-effect-in-async",
        { file: fileName, line, column },
      ),
    });
    return [];
  }
  const successSummariesInitial = summarizeAsyncSegment(
    successStatements,
    setters,
    undefined,
    outcomeLocals,
  );
  const catchSummariesInitial = tryStatement?.catchClause
    ? summarizeAsyncSegment(
        tryStatement.catchClause.block.statements,
        setters,
        undefined,
        outcomeLocals,
      )
    : [];
  const preEffects = preSummaries.map((summary) => summary.effect);
  const finallySummaries = tryStatement?.finallyBlock
    ? summarizeAsyncSegment(
        tryStatement.finallyBlock.statements,
        setters,
        undefined,
        outcomeLocals,
      )
    : [];
  const finallyEffects = finallySummaries.map((summary) => summary.effect);
  const preReads = uniqueStrings([
    ...preSummaries.flatMap((summary) => summary.reads),
    ...opArgs.reads,
    ...(peeled.guard?.reads ?? []),
  ]);
  const successReads = uniqueStrings([
    ...successSummariesInitial.flatMap((summary) => summary.reads),
    ...finallySummaries.flatMap((summary) => summary.reads),
  ]);
  const catchReads = uniqueStrings([
    ...catchSummariesInitial.flatMap((summary) => summary.reads),
    ...finallySummaries.flatMap((summary) => summary.reads),
  ]);
  const snapshotted = new Set(uniqueStrings([...successReads, ...catchReads]));
  const successSummaries = summarizeAsyncSegment(
    successStatements,
    setters,
    snapshotted,
    outcomeLocals,
  );
  const catchSummaries = tryStatement?.catchClause
    ? summarizeAsyncSegment(
        tryStatement.catchClause.block.statements,
        setters,
        snapshotted,
        outcomeLocals,
      )
    : [];
  const successEffectsInitial = [
    ...successSummaries.map((summary) => summary.effect),
    ...finallyEffects,
  ];
  const catchEffectsInitial = [
    ...catchSummaries.map((summary) => summary.effect),
    ...finallyEffects,
  ];
  const enqueueArgKeys = new Set(Object.keys(opArgs.args));
  const successEffects = rewriteMissingOutcomeReadsInEffects(
    successEffectsInitial,
    op,
    enqueueArgKeys,
  );
  const catchEffects = rewriteMissingOutcomeReadsInEffects(
    catchEffectsInitial,
    op,
    enqueueArgKeys,
  );
  const successNavigate = firstNavigationInStatements(
    successStatements,
    adapter,
    routePatterns,
  );
  if (
    successEffects.length === 0 &&
    catchEffects.length === 0 &&
    !successNavigate &&
    preEffects.length === 0
  ) {
    return peeled.declined ? [peeled.declined] : [];
  }
  const baseId = `${component}.${attr}.${op}`;
  const snapshotReads = uniqueStrings([...successReads, ...catchReads]);
  const snapshotArgs = Object.fromEntries(
    snapshotReads.map(
      (varId) =>
        [`snap:${varId}`, { kind: "read", var: varId }] as [string, ExprIR],
    ),
  );
  const sourceAnchor = [
    { file: fileName, ...lineAndColumn(source, expression) },
  ];
  const confirmAcceptedEffect = peeled.confirm
    ? confirmChoiceAssign(peeled.confirm.varId, "accepted")
    : undefined;
  const startGuard = peeled.guard?.expr ?? { kind: "lit", value: true };
  const startPreEffects = [
    ...(confirmAcceptedEffect ? [confirmAcceptedEffect] : []),
    ...preEffects,
  ];
  const enqueue: Transition = {
    id: `${baseId}.start`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: sourceAnchor,
    guard: startGuard,
    effect: {
      kind: "seq",
      effects: [
        ...startPreEffects,
        {
          kind: "enqueue",
          op,
          continuation: `${baseId}.cont`,
          args: { ...opArgs.args, ...snapshotArgs },
        },
      ],
    },
    reads: preReads,
    writes: uniqueStrings([
      ...startPreEffects.flatMap(effectWriteVars),
      ...(peeled.confirm ? [peeled.confirm.varId] : []),
      PENDING_QUEUE_VAR,
    ]),
    confidence: confidenceForEffects(startPreEffects),
  };
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
  const transitions = [
    enqueue,
    successNavigate
      ? appendEffect(success, navigationEffect(successNavigate))
      : success,
    ...(peeled.declined ? [peeled.declined] : []),
  ];
  if (catchEffects.length > 0 || asyncOutcomes[op]?.error !== undefined) {
    const errorTransition: Transition = {
      id: `${baseId}.error`,
      cls: "env",
      label: { kind: "resolve", op, outcome: "error" },
      source: sourceAnchor,
      guard: pendingIs(op),
      effect: {
        kind: "seq",
        effects: [{ kind: "dequeue", index: 0 }, ...catchEffects],
      },
      reads: uniqueStrings([PENDING_QUEUE_VAR, ...catchReads]),
      writes: [
        ...new Set([
          PENDING_QUEUE_VAR,
          ...catchEffects.flatMap(effectWriteVars),
        ]),
      ],
      confidence: confidenceForEffects(catchEffects),
    };
    transitions.push(errorTransition);
  } else {
    const anchor = lineAndColumn(source, awaitStatement);
    warnings.push({
      message: `Unhandled rejection ${baseId}`,
      ...anchor,
      caveat: unhandledRejectionCaveat(baseId, {
        file: fileName,
        ...anchor,
      }),
    });
  }
  return transitions.map((transition) => ({
    ...transition,
    writes: [...new Set(transition.writes)],
  }));
}

function peelPreAwaitGuards(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  component: string,
  attr: string,
  op: string,
  locator: Locator | undefined,
  sourceAnchor: Transition["source"],
): {
  guard?: ParsedGuard;
  declined?: Transition;
  confirm?: { varId: string };
  statements: ts.Statement[];
} {
  const guards: ParsedGuard[] = [];
  let index = 0;
  let declined: Transition | undefined;
  let confirm: { varId: string } | undefined;
  while (index < statements.length) {
    const statement = statements[index];
    if (!statement || !ts.isIfStatement(statement)) break;
    if (
      !exitsWithoutEffects(statement.thenStatement) ||
      statement.elseStatement
    )
      break;
    if (isConfirmDeclinedIf(statement)) {
      const baseId = `${component}.${attr}.${op}`;
      const confirmVar = confirmVarId(component, attr, op);
      confirm = { varId: confirmVar };
      declined = {
        id: `${baseId}.declined`,
        cls: "user",
        label: labelForEvent(attr, locator),
        source: sourceAnchor,
        guard: { kind: "lit", value: true },
        effect: {
          kind: "seq",
          effects: [confirmChoiceAssign(confirmVar, "declined")],
        },
        reads: [],
        writes: [confirmVar],
        confidence: "over-approx",
      };
      index += 1;
      continue;
    }
    const guard = earlyReturnContinueGuard(statement, setters);
    if (!guard) break;
    guards.push(guard);
    index += 1;
  }
  return {
    guard: combineParsedGuards(guards),
    declined,
    confirm,
    statements: statements.slice(index),
  };
}

function earlyReturnContinueGuard(
  statement: ts.IfStatement,
  setters: Map<string, SetterBinding>,
): ParsedGuard | undefined {
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

function isConfirmDeclinedIf(statement: ts.IfStatement): boolean {
  return Boolean(extractConfirmCall(statement.expression));
}

export function extractConfirmCall(
  expression: ts.Expression,
): ts.CallExpression | undefined {
  const target =
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.ExclamationToken
      ? expression.operand
      : expression;
  if (!ts.isCallExpression(target)) return undefined;
  const name = callName(target.expression);
  if (!name) return undefined;
  if (
    name === "confirm" ||
    name === "window.confirm" ||
    name === "globalThis.confirm"
  ) {
    return target;
  }
  return undefined;
}

function outcomeLocalsForAwaitedEffect(
  awaited: AwaitedEffect,
  asyncOutcomes: Record<string, { success: Value; error?: Value }>,
): Map<string, BoundExpr> {
  const locals = new Map<string, BoundExpr>();
  if (!awaited.bindingName) return locals;
  const outcome = asyncOutcomes[awaited.op]?.success;
  if (outcome !== undefined) {
    locals.set(awaited.bindingName, {
      expr: { kind: "lit", value: outcome },
      reads: [],
    });
  }
  return locals;
}

export function confirmVarId(
  component: string,
  attr: string,
  op: string,
): string {
  return `sys:confirm:${component}.${attr}.${op}`;
}

export function confirmStateVarDecl(varId: string): StateVarDecl {
  return {
    id: varId,
    domain: { kind: "enum", values: ["accepted", "declined"] },
    origin: "system",
    scope: { kind: "global" },
    initial: "declined",
  };
}

function confirmChoiceAssign(
  varId: string,
  choice: "accepted" | "declined",
): EffectIR {
  return {
    kind: "assign",
    var: varId,
    expr: { kind: "lit", value: choice },
  };
}

function rewriteMissingOutcomeReadsInEffects(
  effects: readonly EffectIR[],
  op: string,
  enqueueArgKeys: ReadonlySet<string>,
): EffectIR[] {
  return effects.map((effect) =>
    rewriteMissingOutcomeReads(effect, op, enqueueArgKeys),
  );
}

function rewriteMissingOutcomeReads(
  effect: EffectIR,
  op: string,
  enqueueArgKeys: ReadonlySet<string>,
): EffectIR {
  switch (effect.kind) {
    case "assign": {
      if (exprUsesMissingOutcomeRead(effect.expr, op, enqueueArgKeys)) {
        return { kind: "havoc", var: effect.var };
      }
      return effect;
    }
    case "seq":
      return {
        kind: "seq",
        effects: effect.effects.map((child) =>
          rewriteMissingOutcomeReads(child, op, enqueueArgKeys),
        ),
      };
    case "if": {
      const rewritten = {
        ...effect,
        else: rewriteMissingOutcomeReads(effect.else, op, enqueueArgKeys),
      };
      // biome-ignore lint/suspicious/noThenProperty: EffectIR intentionally names if-branch effects `then`.
      rewritten["then"] = rewriteMissingOutcomeReads(
        effect.then,
        op,
        enqueueArgKeys,
      );
      return rewritten;
    }
    default:
      return effect;
  }
}

function exprUsesMissingOutcomeRead(
  expr: ExprIR,
  op: string,
  enqueueArgKeys: ReadonlySet<string>,
): boolean {
  switch (expr.kind) {
    case "readOpArg":
      return outcomeReadOpArgKeyMissing(expr.key, op, enqueueArgKeys);
    case "updateField":
      return (
        exprUsesMissingOutcomeRead(expr.target, op, enqueueArgKeys) ||
        exprUsesMissingOutcomeRead(expr.value, op, enqueueArgKeys)
      );
    case "tagIs":
      return exprUsesMissingOutcomeRead(expr.arg, op, enqueueArgKeys);
    case "lenCat":
      return exprUsesMissingOutcomeRead(expr.arg, op, enqueueArgKeys);
    case "not":
    case "eq":
    case "neq":
    case "and":
    case "or":
    case "cond":
    case "lt":
    case "lte":
    case "gt":
    case "gte":
    case "add":
    case "sub":
    case "mod":
      return expr.args.some((arg) =>
        exprUsesMissingOutcomeRead(arg, op, enqueueArgKeys),
      );
    default:
      return false;
  }
}

function outcomeReadOpArgKeyMissing(
  key: string,
  op: string,
  enqueueArgKeys: ReadonlySet<string>,
): boolean {
  const prefix = `outcome:${op}`;
  if (!key.startsWith(prefix)) return false;
  if (enqueueArgKeys.has(key)) return false;
  if (key === prefix && enqueueArgKeys.has(prefix)) return false;
  const nested = key.slice(prefix.length);
  if (nested.startsWith(":")) {
    const rootField = nested.slice(1).split(":")[0];
    if (rootField && enqueueArgKeys.has(`${prefix}:${rootField}`)) return false;
  }
  return true;
}

export function containsAwaitInLoop(node: ts.Node): boolean {
  let loopDepth = 0;
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found) return;
    const isLoop =
      ts.isForStatement(candidate) ||
      ts.isForInStatement(candidate) ||
      ts.isForOfStatement(candidate) ||
      ts.isWhileStatement(candidate) ||
      ts.isDoStatement(candidate);
    if (isLoop) loopDepth += 1;
    if (loopDepth > 0 && ts.isAwaitExpression(candidate)) {
      found = true;
    } else {
      ts.forEachChild(candidate, visit);
    }
    if (isLoop) loopDepth -= 1;
  };
  visit(node);
  return found;
}

export function transitionsFromSequentialAwait(
  source: ts.SourceFile,
  fileName: string,
  attr: string,
  expression: ExtractableHandler,
  firstAwait: ts.Statement,
  firstOp: string,
  preSummaries: readonly EffectSummary[],
  successStatements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  effectApis: Set<string>,
  component: string,
  locator: Locator | undefined,
  warnings: ExtractionWarning[],
  effectOpAliases: EffectOpAliases = new Map(),
  outcomeLocals: Map<string, BoundExpr> = new Map(),
): Transition[] {
  const secondIndex = successStatements.findIndex((statement) =>
    statementHasAwaitedEffect(statement, effectApis, fileName, effectOpAliases),
  );
  if (secondIndex < 0) return [];
  const secondAwait = successStatements[secondIndex];
  if (!secondAwait) return [];
  const secondOp = awaitedOp(
    secondAwait,
    effectApis,
    fileName,
    effectOpAliases,
  );
  const promiseAllOps = secondOp
    ? undefined
    : promiseAllAwaitOps(secondAwait, effectApis, fileName, effectOpAliases);
  if (!secondOp && !promiseAllOps) return [];
  const betweenStatements = successStatements.slice(0, secondIndex);
  const tailStatements = successStatements.slice(secondIndex + 1);
  if (
    containsAwaitedEffect(tailStatements, effectApis, fileName, effectOpAliases)
  )
    return [];
  const betweenSummaries = summarizeAsyncSegment(
    betweenStatements,
    setters,
    undefined,
    outcomeLocals,
  );
  const tailSummaries = summarizeAsyncSegment(
    tailStatements,
    setters,
    undefined,
    outcomeLocals,
  );
  const preEffects = preSummaries.map((summary) => summary.effect);
  const betweenEffects = betweenSummaries.map((summary) => summary.effect);
  const tailEffects = tailSummaries.map((summary) => summary.effect);
  if (tailEffects.length === 0) return [];
  const preReads = uniqueStrings(
    preSummaries.flatMap((summary) => summary.reads),
  );
  const betweenReads = uniqueStrings(
    betweenSummaries.flatMap((summary) => summary.reads),
  );
  const tailReads = uniqueStrings(
    tailSummaries.flatMap((summary) => summary.reads),
  );
  const firstBaseId = `${component}.${attr}.${firstOp}`;
  const secondBaseId = `${component}.${attr}.${secondOp ?? "Promise_all"}`;
  for (const read of uniqueStrings([...betweenReads, ...tailReads])) {
    warnings.push({
      message: `Stale-read risk ${firstBaseId}:${read}`,
      ...lineAndColumn(source, firstAwait),
    });
  }
  warnings.push({
    message: `Unhandled rejection ${firstBaseId}`,
    ...lineAndColumn(source, firstAwait),
  });
  const rejectionOps = promiseAllOps ?? (secondOp ? [secondOp] : []);
  for (const op of rejectionOps) {
    warnings.push({
      message: `Unhandled rejection ${component}.${attr}.${op}`,
      ...lineAndColumn(source, secondAwait),
    });
  }
  const sourceAnchor = [
    { file: fileName, ...lineAndColumn(source, expression) },
  ];
  const secondEnqueueEffects: EffectIR[] = promiseAllOps
    ? promiseAllOps.map((op) => ({
        kind: "enqueue",
        op,
        continuation: `${secondBaseId}.cont`,
        args: {},
      }))
    : secondOp
      ? [
          {
            kind: "enqueue",
            op: secondOp,
            continuation: `${secondBaseId}.cont`,
            args: {},
          },
        ]
      : [];
  const secondSuccess: Transition = promiseAllOps
    ? {
        id: `${secondBaseId}.success`,
        cls: "env",
        label: { kind: "internal", text: `${secondBaseId}.join` },
        source: sourceAnchor,
        guard: promiseAllGuard(promiseAllOps),
        effect: {
          kind: "seq",
          effects: [
            ...promiseAllOps
              .map((_, index) => ({ kind: "dequeue" as const, index }))
              .reverse(),
            ...tailEffects,
          ],
        },
        reads: uniqueStrings([PENDING_QUEUE_VAR, ...tailReads]),
        writes: uniqueStrings([
          PENDING_QUEUE_VAR,
          ...tailEffects.flatMap(effectWriteVars),
        ]),
        confidence: confidenceForEffects(tailEffects),
      }
    : {
        id: `${secondBaseId}.success`,
        cls: "env",
        label: {
          kind: "resolve",
          op: secondOp ?? "unknown",
          outcome: "success",
        },
        source: sourceAnchor,
        guard: pendingIs(secondOp ?? "unknown"),
        effect: {
          kind: "seq",
          effects: [{ kind: "dequeue", index: 0 }, ...tailEffects],
        },
        reads: uniqueStrings([PENDING_QUEUE_VAR, ...tailReads]),
        writes: uniqueStrings([
          PENDING_QUEUE_VAR,
          ...tailEffects.flatMap(effectWriteVars),
        ]),
        confidence: confidenceForEffects(tailEffects),
      };
  const transitions: Transition[] = [
    {
      id: `${firstBaseId}.start`,
      cls: "user",
      label: labelForEvent(attr, locator),
      source: sourceAnchor,
      guard: { kind: "lit", value: true },
      effect: {
        kind: "seq",
        effects: [
          ...preEffects,
          {
            kind: "enqueue",
            op: firstOp,
            continuation: `${firstBaseId}.cont`,
            args: {},
          },
        ],
      },
      reads: preReads,
      writes: uniqueStrings([
        ...preEffects.flatMap(effectWriteVars),
        PENDING_QUEUE_VAR,
      ]),
      confidence: confidenceForEffects(preEffects),
    },
    {
      id: `${firstBaseId}.success`,
      cls: "env",
      label: { kind: "resolve", op: firstOp, outcome: "success" },
      source: sourceAnchor,
      guard: pendingIs(firstOp),
      effect: {
        kind: "seq",
        effects: [
          { kind: "dequeue", index: 0 },
          ...betweenEffects,
          ...secondEnqueueEffects,
        ],
      },
      reads: uniqueStrings([PENDING_QUEUE_VAR, ...betweenReads]),
      writes: uniqueStrings([
        PENDING_QUEUE_VAR,
        ...betweenEffects.flatMap(effectWriteVars),
      ]),
      confidence: confidenceForEffects(betweenEffects),
    },
    secondSuccess,
  ];
  return transitions.map((transition) => ({
    ...transition,
    writes: uniqueStrings(transition.writes),
  }));
}

export function promiseAllGuard(ops: readonly string[]): ExprIR {
  return ops
    .map((op, index): ExprIR => pendingIsAt(index, op))
    .reduce(andGuard);
}

export function confidenceForEffects(
  effects: readonly EffectIR[],
): Transition["confidence"] {
  return effects.some((effect) => effect.kind === "havoc")
    ? "over-approx"
    : "exact";
}

export function setterAssignEffect(
  statement: ts.Statement,
  setters: Map<string, { varId: string }>,
): Extract<Transition["effect"], { kind: "assign" }> | undefined {
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

export function statementHasAwaitedEffect(
  statement: ts.Statement,
  effectApis: Set<string>,
  fileName: string,
  effectOpAliases: EffectOpAliases = new Map(),
): boolean {
  return (
    Boolean(awaitedEffect(statement, effectApis, fileName, effectOpAliases)) ||
    Boolean(
      promiseAllAwaitOps(statement, effectApis, fileName, effectOpAliases),
    )
  );
}

export function expressionStatementAwait(
  statement: ts.Statement,
  effectApis: Set<string>,
  fileName: string,
  effectOpAliases: EffectOpAliases = new Map(),
): boolean {
  return (
    statementHasAwaitedEffect(
      statement,
      effectApis,
      fileName,
      effectOpAliases,
    ) ||
    Boolean(
      promiseAllAwaitOps(statement, effectApis, fileName, effectOpAliases),
    )
  );
}

export function containsAwaitedEffect(
  statements: readonly ts.Statement[],
  effectApis: Set<string>,
  fileName: string,
  effectOpAliases: EffectOpAliases = new Map(),
): boolean {
  return statements.some((statement) => {
    let found = false;
    const visit = (node: ts.Node, insideAwait = false): void => {
      if (found) return;
      if (ts.isAwaitExpression(node)) {
        visit(node.expression, true);
        return;
      }
      if (insideAwait && ts.isCallExpression(node)) {
        const name = callName(node.expression);
        if (name) {
          const op = canonicalEffectOp(
            effectOpForCall(name, node),
            fileName,
            effectOpAliases,
          );
          if (effectApis.has(op) || effectApis.has(effectOpForCall(name, node)))
            found = true;
        }
        return;
      }
      ts.forEachChild(node, (child) => visit(child, insideAwait));
    };
    visit(statement);
    return found;
  });
}

export function awaitedOp(
  statement: ts.Statement,
  effectApis: Set<string>,
  fileName: string,
  effectOpAliases: EffectOpAliases = new Map(),
): string | undefined {
  return awaitedEffect(statement, effectApis, fileName, effectOpAliases)?.op;
}

export function awaitedEffect(
  statement: ts.Statement,
  effectApis: Set<string>,
  fileName: string,
  effectOpAliases: EffectOpAliases = new Map(),
): AwaitedEffect | undefined {
  const located = awaitedCallExpressionInStatement(statement);
  if (!located) return undefined;
  const name = callName(located.call.expression);
  if (!name) return undefined;
  const rawOp = effectOpForCall(name, located.call);
  const op = canonicalEffectOp(rawOp, fileName, effectOpAliases);
  if (!effectApis.has(op) && !effectApis.has(rawOp)) return undefined;
  return {
    op,
    call: located.call,
    statement,
    ...(located.bindingName ? { bindingName: located.bindingName } : {}),
  };
}

export function awaitedCall(
  statement: ts.Statement,
  effectApis: Set<string>,
  fileName: string,
  effectOpAliases: EffectOpAliases = new Map(),
): { op: string; call: ts.CallExpression } | undefined {
  const awaited = awaitedEffect(
    statement,
    effectApis,
    fileName,
    effectOpAliases,
  );
  return awaited ? { op: awaited.op, call: awaited.call } : undefined;
}

export function awaitedCallExpressionInStatement(
  statement: ts.Statement,
): { call: ts.CallExpression; bindingName?: string } | undefined {
  if (
    ts.isExpressionStatement(statement) &&
    ts.isAwaitExpression(statement.expression) &&
    ts.isCallExpression(statement.expression.expression)
  ) {
    return { call: statement.expression.expression };
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (
        declaration.initializer &&
        ts.isAwaitExpression(declaration.initializer) &&
        ts.isCallExpression(declaration.initializer.expression)
      ) {
        const bindingName = ts.isIdentifier(declaration.name)
          ? declaration.name.text
          : undefined;
        return {
          call: declaration.initializer.expression,
          ...(bindingName ? { bindingName } : {}),
        };
      }
    }
  }
  return undefined;
}

export function effectOpForCall(name: string, call: ts.CallExpression): string {
  if (name !== "fetch") return name;
  const url = fetchUrl(call.arguments[0]);
  const method = fetchMethod(call.arguments[1]) ?? "GET";
  return url ? `${method} ${url}` : "fetch";
}

export function fetchUrl(
  argument: ts.Expression | undefined,
): string | undefined {
  if (!argument) return undefined;
  if (
    ts.isStringLiteral(argument) ||
    ts.isNoSubstitutionTemplateLiteral(argument)
  )
    return normalizeFetchUrl(argument.text);
  if (ts.isTemplateExpression(argument)) {
    const pattern = templateRoutePattern(argument);
    return pattern
      ? normalizeFetchUrl(pattern.replace(/\/:param(?=\/|$)/g, "/:id"))
      : undefined;
  }
  return undefined;
}

export function normalizeFetchUrl(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

export function fetchMethod(
  argument: ts.Expression | undefined,
): string | undefined {
  if (!argument || !ts.isObjectLiteralExpression(argument)) return undefined;
  const method = argument.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      propertyName(property.name) === "method",
  );
  const value = method ? literalValue(method.initializer) : undefined;
  return typeof value === "string" ? value.toUpperCase() : undefined;
}

export function effectCallArgs(
  call: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>,
): { args: Record<string, ExprIR>; reads: string[] } {
  const first = call.arguments[0];
  if (!first) return { args: {}, reads: [] };
  if (ts.isObjectLiteralExpression(first)) {
    const args: Record<string, ExprIR> = {};
    const reads = new Set<string>();
    for (const property of first.properties) {
      if (
        !ts.isPropertyAssignment(property) &&
        !ts.isShorthandPropertyAssignment(property)
      )
        return { args: {}, reads: [] };
      const name = propertyName(property.name);
      if (!name) return { args: {}, reads: [] };
      const value = ts.isShorthandPropertyAssignment(property)
        ? valueExpr(property.name, setters, locals, false)
        : valueExpr(property.initializer, setters, locals, false);
      if (!value) return { args: {}, reads: [] };
      args[name] = value.expr;
      for (const read of value.reads) reads.add(read);
    }
    return { args, reads: [...reads] };
  }
  const value = valueExpr(first, setters, locals, false);
  return value
    ? { args: { value: value.expr }, reads: value.reads }
    : { args: {}, reads: [] };
}

export function promiseAllAwaitOps(
  statement: ts.Statement,
  effectApis: Set<string>,
  fileName: string,
  effectOpAliases: EffectOpAliases = new Map(),
): string[] | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const expression = statement.expression;
  if (
    !ts.isAwaitExpression(expression) ||
    !ts.isCallExpression(expression.expression)
  )
    return undefined;
  const call = expression.expression;
  if (
    callName(call.expression) !== "Promise.all" ||
    call.arguments.length !== 1 ||
    !ts.isArrayLiteralExpression(call.arguments[0])
  )
    return undefined;
  const ops: string[] = [];
  for (const element of call.arguments[0].elements) {
    if (!ts.isCallExpression(element)) return undefined;
    const name = callName(element.expression);
    if (!name) return undefined;
    const rawOp = effectOpForCall(name, element);
    const op = canonicalEffectOp(rawOp, fileName, effectOpAliases);
    if (!effectApis.has(op) && !effectApis.has(rawOp)) return undefined;
    ops.push(op);
  }
  return ops.length > 0 ? ops : undefined;
}

export { canonicalEffectOp } from "../effect-op-aliases.js";
export type { EffectOpAliases } from "../effect-op-aliases.js";

export function pendingIs(op: string): Transition["guard"] {
  return pendingIsAt(0, op);
}

export function pendingIsAt(index: number, op: string): Transition["guard"] {
  return {
    kind: "eq",
    args: [
      { kind: "read", var: PENDING_QUEUE_VAR, path: [String(index), "opId"] },
      { kind: "lit", value: op },
    ],
  };
}

function exitsWithoutEffects(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement)) return true;
  if (ts.isBlock(statement)) {
    const meaningful = statement.statements.filter(
      (child) => !ts.isEmptyStatement(child),
    );
    return (
      meaningful.length > 0 &&
      meaningful.every((child) => exitsWithoutEffects(child))
    );
  }
  return false;
}
