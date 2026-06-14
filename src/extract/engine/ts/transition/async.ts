import * as ts from "typescript";
import {
  callName,
  lineAndColumn,
  literalValue,
  propertyName,
} from "../ast.js";
import { uniqueStrings } from "../ids.js";
import { templateRoutePattern } from "../routes.js";
import type {
  EffectIR,
  ExprIR,
  Locator,
  Transition,
  Value,
} from "modality-ts/core";
import type {
  BoundExpr,
  ExtractableHandler,
  ExtractionWarning,
  EffectSummary,
  SetterBinding,
} from "../types.js";
import { effectWriteVars, summarizeAsyncSegment } from "./effects.js";
import { valueExpr } from "./expressions.js";
import { andGuard } from "./guards.js";
import { navigationCall } from "./navigation.js";
import { labelForEvent } from "./ui.js";

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
  routePatterns: readonly string[],
  warnings: ExtractionWarning[],
): Transition[] {
  if (!ts.isBlock(expression.body)) return [];
  if (containsAwaitInLoop(expression.body)) {
    warnings.push({
      message: `Unextractable handler ${component}.${attr}`,
      ...lineAndColumn(source, expression),
    });
    return [];
  }
  const statements = expression.body.statements;
  const tryStatement = statements.find(ts.isTryStatement);
  const awaitStatement = tryStatement
    ? tryStatement.tryBlock.statements.find((statement) =>
        expressionStatementAwait(statement, effectApis),
      )
    : statements.find((statement) =>
        expressionStatementAwait(statement, effectApis),
      );
  if (!awaitStatement) return [];
  const awaited = awaitedCall(awaitStatement, effectApis);
  const op = awaited?.op;
  if (!op) return [];
  const opArgs = awaited
    ? effectCallArgs(awaited.call, setters, new Map())
    : { args: {}, reads: [] };
  const preStatements = tryStatement
    ? statements.slice(0, statements.indexOf(tryStatement))
    : statements.slice(0, statements.indexOf(awaitStatement));
  const preSummaries = summarizeAsyncSegment(preStatements, setters);
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
    );
    if (chained.length > 0) return chained;
  }
  if (
    containsAwaitedEffect(successStatements, effectApis) ||
    (tryStatement?.catchClause &&
      containsAwaitedEffect(
        tryStatement.catchClause.block.statements,
        effectApis,
      ))
  ) {
    warnings.push({
      message: `Unextractable handler ${component}.${attr}`,
      ...lineAndColumn(source, awaitStatement),
    });
    return [];
  }
  const successSummaries = summarizeAsyncSegment(successStatements, setters);
  const catchSummaries = tryStatement?.catchClause
    ? summarizeAsyncSegment(tryStatement.catchClause.block.statements, setters)
    : [];
  const preEffects = preSummaries.map((summary) => summary.effect);
  const finallySummaries = tryStatement?.finallyBlock
    ? summarizeAsyncSegment(tryStatement.finallyBlock.statements, setters)
    : [];
  const finallyEffects = finallySummaries.map((summary) => summary.effect);
  const successEffects = [
    ...successSummaries.map((summary) => summary.effect),
    ...finallyEffects,
  ];
  const catchEffects = [
    ...catchSummaries.map((summary) => summary.effect),
    ...finallyEffects,
  ];
  const preReads = uniqueStrings([
    ...preSummaries.flatMap((summary) => summary.reads),
    ...opArgs.reads,
  ]);
  const successReads = uniqueStrings([
    ...successSummaries.flatMap((summary) => summary.reads),
    ...finallySummaries.flatMap((summary) => summary.reads),
  ]);
  const catchReads = uniqueStrings([
    ...catchSummaries.flatMap((summary) => summary.reads),
    ...finallySummaries.flatMap((summary) => summary.reads),
  ]);
  const successNavigate = firstNavigationInStatements(
    successStatements,
    routePatterns,
  );
  if (
    successEffects.length === 0 &&
    catchEffects.length === 0 &&
    !successNavigate
  )
    return [];
  const baseId = `${component}.${attr}.${op}`;
  for (const read of uniqueStrings([...successReads, ...catchReads])) {
    warnings.push({
      message: `Stale-read risk ${baseId}:${read}`,
      ...lineAndColumn(source, awaitStatement),
    });
  }
  const sourceAnchor = [
    { file: fileName, ...lineAndColumn(source, expression) },
  ];
  const enqueue: Transition = {
    id: `${baseId}.start`,
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
          op,
          continuation: `${baseId}.cont`,
          args: opArgs.args,
        },
      ],
    },
    reads: preReads,
    writes: uniqueStrings([
      ...preEffects.flatMap(effectWriteVars),
      "sys:pending",
    ]),
    confidence: confidenceForEffects(preEffects),
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
    reads: uniqueStrings(["sys:pending", ...successReads]),
    writes: [
      ...new Set(["sys:pending", ...successEffects.flatMap(effectWriteVars)]),
    ],
    confidence: confidenceForEffects(successEffects),
  };
  const transitions = [
    enqueue,
    successNavigate
      ? appendEffect(success, navigationEffect(successNavigate))
      : success,
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
      reads: uniqueStrings(["sys:pending", ...catchReads]),
      writes: [
        ...new Set(["sys:pending", ...catchEffects.flatMap(effectWriteVars)]),
      ],
      confidence: confidenceForEffects(catchEffects),
    };
    transitions.push(errorTransition);
  } else {
    warnings.push({
      message: `Unhandled rejection ${baseId}`,
      ...lineAndColumn(source, awaitStatement),
    });
  }
  return transitions.map((transition) => ({
    ...transition,
    writes: [...new Set(transition.writes)],
  }));
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
): Transition[] {
  const secondIndex = successStatements.findIndex((statement) =>
    expressionStatementAwait(statement, effectApis),
  );
  if (secondIndex < 0) return [];
  const secondAwait = successStatements[secondIndex]!;
  const secondOp = awaitedOp(secondAwait, effectApis);
  const promiseAllOps = secondOp
    ? undefined
    : promiseAllAwaitOps(secondAwait, effectApis);
  if (!secondOp && !promiseAllOps) return [];
  const betweenStatements = successStatements.slice(0, secondIndex);
  const tailStatements = successStatements.slice(secondIndex + 1);
  if (containsAwaitedEffect(tailStatements, effectApis)) return [];
  const betweenSummaries = summarizeAsyncSegment(betweenStatements, setters);
  const tailSummaries = summarizeAsyncSegment(tailStatements, setters);
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
  for (const op of promiseAllOps ?? [secondOp!]) {
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
    : [
        {
          kind: "enqueue",
          op: secondOp!,
          continuation: `${secondBaseId}.cont`,
          args: {},
        },
      ];
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
        reads: uniqueStrings(["sys:pending", ...tailReads]),
        writes: uniqueStrings([
          "sys:pending",
          ...tailEffects.flatMap(effectWriteVars),
        ]),
        confidence: confidenceForEffects(tailEffects),
      }
    : {
        id: `${secondBaseId}.success`,
        cls: "env",
        label: { kind: "resolve", op: secondOp!, outcome: "success" },
        source: sourceAnchor,
        guard: pendingIs(secondOp!),
        effect: {
          kind: "seq",
          effects: [{ kind: "dequeue", index: 0 }, ...tailEffects],
        },
        reads: uniqueStrings(["sys:pending", ...tailReads]),
        writes: uniqueStrings([
          "sys:pending",
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
        "sys:pending",
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
      reads: uniqueStrings(["sys:pending", ...betweenReads]),
      writes: uniqueStrings([
        "sys:pending",
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

export function expressionStatementAwait(
  statement: ts.Statement,
  effectApis: Set<string>,
): boolean {
  return Boolean(
    awaitedOp(statement, effectApis) ??
      promiseAllAwaitOps(statement, effectApis),
  );
}

export function containsAwaitedEffect(
  statements: readonly ts.Statement[],
  effectApis: Set<string>,
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
        if (name && effectApis.has(effectOpForCall(name, node))) {
          found = true;
          return;
        }
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
): string | undefined {
  return awaitedCall(statement, effectApis)?.op;
}

export function awaitedCall(
  statement: ts.Statement,
  effectApis: Set<string>,
): { op: string; call: ts.CallExpression } | undefined {
  const awaitExpression = awaitedCallExpressionInStatement(statement);
  if (!awaitExpression) return undefined;
  const name = callName(awaitExpression.expression);
  if (!name) return undefined;
  const op = effectOpForCall(name, awaitExpression);
  if (!effectApis.has(op)) return undefined;
  return { op, call: awaitExpression };
}

export function awaitedCallExpressionInStatement(
  statement: ts.Statement,
): ts.CallExpression | undefined {
  if (
    ts.isExpressionStatement(statement) &&
    ts.isAwaitExpression(statement.expression) &&
    ts.isCallExpression(statement.expression.expression)
  ) {
    return statement.expression.expression;
  }
  if (ts.isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (
        declaration.initializer &&
        ts.isAwaitExpression(declaration.initializer) &&
        ts.isCallExpression(declaration.initializer.expression) &&
        callName(declaration.initializer.expression.expression) === "fetch"
      ) {
        return declaration.initializer.expression;
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

export function firstNavigationInStatements(
  statements: readonly ts.Statement[],
  routePatterns: readonly string[],
): { mode: "push" | "replace" | "back"; to?: string } | undefined {
  for (const statement of statements) {
    let found: { mode: "push" | "replace" | "back"; to?: string } | undefined;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isCallExpression(node))
        found = navigationCall(node, undefined, routePatterns);
      ts.forEachChild(node, visit);
    };
    visit(statement);
    if (found) return found;
  }
  return undefined;
}

export function navigationEffect(navigation: {
  mode: "push" | "replace" | "back";
  to?: string;
}): EffectIR {
  return {
    kind: "navigate",
    mode: navigation.mode,
    ...(navigation.to ? { to: { kind: "lit", value: navigation.to } } : {}),
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
  const reads = uniqueStrings([
    ...transition.reads,
    ...(effect.kind === "navigate" ? ["sys:route", "sys:history"] : []),
  ]);
  return {
    ...transition,
    effect: { kind: "seq", effects: [...current, effect] },
    reads,
    writes,
  };
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
        ? valueExpr(property.name, setters, locals)
        : valueExpr(property.initializer, setters, locals);
      if (!value) return { args: {}, reads: [] };
      args[name] = value.expr;
      for (const read of value.reads) reads.add(read);
    }
    return { args, reads: [...reads] };
  }
  const value = valueExpr(first, setters, locals);
  return value
    ? { args: { value: value.expr }, reads: value.reads }
    : { args: {}, reads: [] };
}

export function promiseAllAwaitOps(
  statement: ts.Statement,
  effectApis: Set<string>,
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
    if (!name || !effectApis.has(name)) return undefined;
    ops.push(name);
  }
  return ops.length > 0 ? ops : undefined;
}

export function pendingIs(op: string): Transition["guard"] {
  return pendingIsAt(0, op);
}

export function pendingIsAt(index: number, op: string): Transition["guard"] {
  return {
    kind: "eq",
    args: [
      { kind: "read", var: "sys:pending", path: [String(index), "opId"] },
      { kind: "lit", value: op },
    ],
  };
}
