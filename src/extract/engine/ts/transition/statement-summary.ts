import type { EffectIR, ExprIR } from "modality-ts/core";
import * as ts from "typescript";
import { callName, literalValue } from "../ast.js";
import { uniqueStrings } from "../ids.js";
import type {
  BoundExpr,
  EffectSummary,
  ExtractableHandler,
  SetterBinding,
  SetterCall,
} from "../types.js";
import { setterArgumentExpr } from "./expressions.js";
import { parseGuardExpression } from "./guards.js";
import { bindConstStatement } from "./locals.js";

export interface StatementSummaryOptions {
  handlers?: Map<string, ExtractableHandler>;
  initialLocals?: Map<string, BoundExpr>;
  resetSymbols?: ReadonlySet<string>;
}

interface StatementSummaryState {
  locals: Map<string, BoundExpr>;
  handlers?: Map<string, ExtractableHandler>;
  resetSymbols?: ReadonlySet<string>;
}

interface StatementSummaryResult {
  summaries: EffectSummary[];
  terminated: boolean;
}

export function isLoopStatement(statement: ts.Node): boolean {
  return (
    ts.isForStatement(statement) ||
    ts.isForInStatement(statement) ||
    ts.isForOfStatement(statement) ||
    ts.isWhileStatement(statement) ||
    ts.isDoStatement(statement)
  );
}

export function summarizeHandlerStatements(
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  options: StatementSummaryOptions = {},
): EffectSummary[] | undefined {
  if (ts.isCallExpression(handler.body)) {
    const summary = summarizeSetterCall(handler.body, setters, new Map(), {
      resetSymbols: options.resetSymbols,
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
  });
  return result?.summaries;
}

export function summarizeAsyncSegment(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
): EffectSummary[] {
  return uniqueSummariesByEffect(
    summarizeStatements(statements, setters) ??
      fallbackSummaries(statements, setters),
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

export function summarizeSetterCall(
  call: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
  resetOptions: StatementSummaryResetOptions = {},
): EffectSummary | undefined {
  const setterCall = setterCallFrom(call, setters);
  if (!setterCall) return undefined;
  return summarizeSetterWrite(setterCall, setters, locals, resetOptions);
}

export interface StatementSummaryResetOptions {
  resetSymbols?: ReadonlySet<string>;
}

export function summarizeSetterWrite(
  setterCall: SetterCall,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
  resetOptions: StatementSummaryResetOptions = {},
): EffectSummary {
  if (
    setterCall.setter.fixedEffect &&
    setterCall.argument.kind === ts.SyntaxKind.NullKeyword
  ) {
    return {
      effect: setterCall.setter.fixedEffect,
      reads: [],
    };
  }
  if (
    setterCall.setter.resettable &&
    setterCall.setter.initial !== undefined &&
    setterCall.argument.kind === ts.SyntaxKind.NullKeyword
  ) {
    return {
      effect: {
        kind: "assign",
        var: setterCall.setter.varId,
        expr: { kind: "lit", value: setterCall.setter.initial },
      },
      reads: [],
    };
  }
  const assignment = setterArgumentExpr(
    setterCall.argument,
    setterCall.setter,
    setters,
    locals,
    resetOptions.resetSymbols,
  );
  if (!assignment) {
    return {
      effect: { kind: "havoc", var: setterCall.setter.varId },
      reads: [],
    };
  }
  return {
    effect: {
      kind: "assign",
      var: setterCall.setter.varId,
      expr: assignment.expr,
    },
    reads: assignment.reads,
  };
}

export function setterCallFrom(
  call: ts.CallExpression,
  setters: Map<string, SetterBinding>,
): SetterCall | undefined {
  if (ts.isIdentifier(call.expression) && call.arguments.length === 0) {
    const setter = setters.get(call.expression.text);
    if (setter?.resettable || setter?.fixedEffect) {
      return {
        setter,
        argument: ts.factory.createNull(),
      };
    }
    return undefined;
  }
  if (ts.isIdentifier(call.expression) && call.arguments.length === 1) {
    const setter = setters.get(call.expression.text);
    const argument = call.arguments[0];
    return setter && argument ? { setter, argument } : undefined;
  }
  const name = callName(call.expression);
  const atomArg = call.arguments[0];
  if (
    name &&
    call.arguments.length === 2 &&
    atomArg &&
    ts.isIdentifier(atomArg)
  ) {
    const setter = setters.get(`${name}:${atomArg.text}`);
    const argument = call.arguments[1];
    return setter && argument ? { setter, argument } : undefined;
  }
  return undefined;
}

export function settersWrittenIn(
  node: ts.Node,
  setters: Map<string, SetterBinding>,
): SetterBinding[] {
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

export function escapedSettersInStatement(
  statement: ts.Statement,
  setters: Map<string, SetterBinding>,
): SetterBinding[] {
  const found: SetterBinding[] = [];
  const visit = (candidate: ts.Node): void => {
    if (ts.isCallExpression(candidate))
      found.push(...escapedSetters(candidate, setters));
    ts.forEachChild(candidate, visit);
  };
  visit(statement);
  return uniqueSetters(found);
}

export function escapedSetters(
  call: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map(),
): SetterBinding[] {
  return call.arguments
    .filter(ts.isIdentifier)
    .map((arg) => setters.get(arg.text) ?? locals.get(arg.text)?.setter)
    .filter((setter): setter is SetterBinding => Boolean(setter));
}

export function uniqueSetters(
  setters: readonly SetterBinding[],
): SetterBinding[] {
  const byVar = new Map<string, SetterBinding>();
  for (const setter of setters) byVar.set(setter.varId, setter);
  return [...byVar.values()].sort((left, right) =>
    left.varId.localeCompare(right.varId),
  );
}

export function uniqueSummariesByEffect(
  summaries: readonly EffectSummary[],
): EffectSummary[] {
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

export function effectWriteVars(effect: EffectIR): string[] {
  if (
    effect.kind === "assign" ||
    effect.kind === "havoc" ||
    effect.kind === "choose"
  )
    return [effect.var];
  if (effect.kind === "seq") return effect.effects.flatMap(effectWriteVars);
  if (effect.kind === "if")
    return [...effectWriteVars(effect.then), ...effectWriteVars(effect.else)];
  if (effect.kind === "enqueue" || effect.kind === "dequeue")
    return ["sys:pending"];
  if (effect.kind === "navigate") return ["sys:route", "sys:history"];
  return [...effect.ref.declaredWrites];
}

export function identityEffect(): Extract<EffectIR, { kind: "seq" }> {
  return { kind: "seq", effects: [] };
}

export function effectFromSummaries(
  summaries: readonly EffectSummary[],
): EffectIR {
  const effects = summaries.map((summary) => summary.effect);
  if (effects.length === 0) return identityEffect();
  const effect = effects[0];
  return effects.length === 1 && effect ? effect : { kind: "seq", effects };
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

function summarizeStatementList(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
): StatementSummaryResult | undefined {
  const summaries: EffectSummary[] = [];
  for (const statement of statements) {
    if (ts.isIfStatement(statement)) {
      const guardedRest = summarizeGuardedRest(
        statement,
        statements.slice(statements.indexOf(statement) + 1),
        setters,
        state,
      );
      if (guardedRest) {
        summaries.push(...guardedRest.summaries);
        return { summaries, terminated: guardedRest.terminated };
      }
    }
    const result = summarizeStatement(statement, setters, state);
    if (!result) return undefined;
    summaries.push(...result.summaries);
    if (result.terminated) return { summaries, terminated: true };
  }
  return { summaries, terminated: false };
}

function summarizeGuardedRest(
  statement: ts.IfStatement,
  rest: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
): StatementSummaryResult | undefined {
  const thenExits = exitsWithoutEffects(statement.thenStatement);
  const elseExits = statement.elseStatement
    ? exitsWithoutEffects(statement.elseStatement)
    : false;
  if (thenExits === elseExits) return undefined;
  const condition = parseGuardExpression(
    statement.expression,
    setters,
    state.locals,
  );
  const restResult = summarizeStatementList(rest, setters, {
    ...state,
    locals: new Map(state.locals),
  });
  if (!condition || !restResult) return undefined;
  const restEffect = effectFromSummaries(restResult.summaries);
  if (restEffect.kind === "seq" && restEffect.effects.length === 0)
    return { summaries: [], terminated: thenExits || elseExits };
  return {
    summaries: [
      {
        effect: {
          kind: "if",
          cond: condition.expr,
          // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
          then: thenExits ? identityEffect() : restEffect,
          else: elseExits ? identityEffect() : restEffect,
        },
        reads: uniqueStrings([
          ...condition.reads,
          ...restResult.summaries.flatMap((summary) => summary.reads),
        ]),
      },
    ],
    terminated: restResult.terminated,
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

function summarizeStatement(
  statement: ts.Statement,
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
): StatementSummaryResult | undefined {
  if (ts.isEmptyStatement(statement)) return emptyResult();
  if (ts.isBlock(statement)) {
    const child = summarizeStatementList(statement.statements, setters, {
      ...state,
      locals: new Map(state.locals),
    });
    return child ?? fallbackResult(statement, setters);
  }
  if (ts.isVariableStatement(statement)) {
    if (bindConstStatement(statement, setters, state.locals))
      return emptyResult();
    return fallbackResult(statement, setters);
  }
  if (ts.isExpressionStatement(statement)) {
    const call = expressionCall(statement.expression);
    if (call) {
      const helper = helperSummariesFromCall(call, state.handlers, setters);
      if (helper) return { summaries: helper, terminated: false };
      const summary = summarizeSetterCall(call, setters, state.locals, {
        resetSymbols: state.resetSymbols,
      });
      if (summary) return { summaries: [summary], terminated: false };
    }
    return fallbackResult(statement, setters);
  }
  if (ts.isIfStatement(statement))
    return summarizeIfStatement(statement, setters, state);
  if (ts.isSwitchStatement(statement))
    return summarizeSwitchStatement(statement, setters, state);
  if (ts.isTryStatement(statement))
    return summarizeTryStatement(statement, setters, state);
  if (isLoopStatement(statement))
    return summarizeLoopStatement(statement, setters);
  if (ts.isReturnStatement(statement))
    return {
      summaries: fallbackSummaries([statement], setters),
      terminated: true,
    };
  if (ts.isBreakStatement(statement) || ts.isContinueStatement(statement))
    return { summaries: [], terminated: true };
  if (ts.isLabeledStatement(statement))
    return summarizeStatement(statement.statement, setters, state);
  return fallbackResult(statement, setters);
}

function summarizeIfStatement(
  statement: ts.IfStatement,
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
): StatementSummaryResult {
  const thenResult = summarizeStatement(statement.thenStatement, setters, {
    ...state,
    locals: new Map(state.locals),
  });
  const elseResult = statement.elseStatement
    ? summarizeStatement(statement.elseStatement, setters, {
        ...state,
        locals: new Map(state.locals),
      })
    : emptyResult();
  const condition = parseGuardExpression(
    statement.expression,
    setters,
    state.locals,
  );
  if (!condition || !thenResult || !elseResult) {
    return {
      summaries: fallbackSummaries([statement], setters),
      terminated: false,
    };
  }
  const thenEffect = effectFromSummaries(thenResult.summaries);
  const elseEffect = effectFromSummaries(elseResult.summaries);
  if (thenEffect.kind === "seq" && thenEffect.effects.length === 0) {
    if (elseEffect.kind === "seq" && elseEffect.effects.length === 0)
      return emptyResult(thenResult.terminated && elseResult.terminated);
  }
  return {
    summaries: [
      {
        effect: {
          kind: "if",
          cond: condition.expr,
          // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
          then: thenEffect,
          else: elseEffect,
        },
        reads: uniqueStrings([
          ...condition.reads,
          ...thenResult.summaries.flatMap((summary) => summary.reads),
          ...elseResult.summaries.flatMap((summary) => summary.reads),
        ]),
      },
    ],
    terminated: thenResult.terminated && elseResult.terminated,
  };
}

function summarizeSwitchStatement(
  statement: ts.SwitchStatement,
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
): StatementSummaryResult {
  const discriminant = parseGuardExpression(
    statement.expression,
    setters,
    state.locals,
  );
  if (!discriminant) {
    return {
      summaries: fallbackSummaries([statement], setters),
      terminated: false,
    };
  }
  const branches: {
    cond?: ExprIR;
    reads: string[];
    result: StatementSummaryResult;
  }[] = [];
  for (let index = 0; index < statement.caseBlock.clauses.length; index += 1) {
    const clause = statement.caseBlock.clauses[index];
    if (!clause) continue;
    const result = summarizeStatementList(clause.statements, setters, {
      ...state,
      locals: new Map(state.locals),
    });
    if (!result)
      return {
        summaries: fallbackSummaries([statement], setters),
        terminated: false,
      };
    if (index < statement.caseBlock.clauses.length - 1 && !result.terminated)
      return {
        summaries: fallbackSummaries([statement], setters),
        terminated: false,
      };
    if (ts.isDefaultClause(clause)) {
      branches.push({ reads: [], result });
      continue;
    }
    const literal = literalValue(clause.expression);
    const value =
      literal !== undefined
        ? { expr: { kind: "lit" as const, value: literal }, reads: [] }
        : parseGuardExpression(clause.expression, setters, state.locals);
    if (!value)
      return {
        summaries: fallbackSummaries([statement], setters),
        terminated: false,
      };
    branches.push({
      cond: { kind: "eq", args: [discriminant.expr, value.expr] },
      reads: value.reads,
      result,
    });
  }
  const effect = branches
    .slice()
    .reverse()
    .reduce<EffectIR>((fallback, branch) => {
      const branchEffect = effectFromSummaries(branch.result.summaries);
      if (!branch.cond) return branchEffect;
      return {
        kind: "if",
        cond: branch.cond,
        // biome-ignore lint/suspicious/noThenProperty: Effect IR serializes if branches with a "then" field.
        then: branchEffect,
        else: fallback,
      };
    }, identityEffect());
  return {
    summaries:
      effect.kind === "seq" && effect.effects.length === 0
        ? []
        : [
            {
              effect,
              reads: uniqueStrings([
                ...discriminant.reads,
                ...branches.flatMap((branch) => branch.reads),
                ...branches.flatMap((branch) =>
                  branch.result.summaries.flatMap((summary) => summary.reads),
                ),
              ]),
            },
          ],
    terminated:
      branches.length > 0 &&
      branches.every((branch) => branch.result.terminated),
  };
}

function summarizeTryStatement(
  statement: ts.TryStatement,
  setters: Map<string, SetterBinding>,
  state: StatementSummaryState,
): StatementSummaryResult {
  if (statement.catchClause) {
    return {
      summaries: fallbackSummaries([statement], setters),
      terminated: false,
    };
  }
  const tryResult = summarizeStatementList(
    statement.tryBlock.statements,
    setters,
    {
      ...state,
      locals: new Map(state.locals),
    },
  );
  const finallyResult = statement.finallyBlock
    ? summarizeStatementList(statement.finallyBlock.statements, setters, {
        ...state,
        locals: new Map(state.locals),
      })
    : emptyResult();
  if (!tryResult || !finallyResult)
    return {
      summaries: fallbackSummaries([statement], setters),
      terminated: false,
    };
  return {
    summaries: [...tryResult.summaries, ...finallyResult.summaries],
    terminated: tryResult.terminated || finallyResult.terminated,
  };
}

function summarizeLoopStatement(
  statement: ts.Statement,
  setters: Map<string, SetterBinding>,
): StatementSummaryResult | undefined {
  if (containsAwait(statement)) return undefined;
  const loopSetters = uniqueSetters(settersWrittenIn(statement, setters));
  return {
    summaries: loopSetters.map((setter) => ({
      effect: { kind: "havoc", var: setter.varId },
      reads: [],
    })),
    terminated: false,
  };
}

function helperSummariesFromCall(
  call: ts.CallExpression,
  handlers: Map<string, ExtractableHandler> | undefined,
  setters: Map<string, SetterBinding>,
): EffectSummary[] | undefined {
  if (
    !handlers ||
    !ts.isIdentifier(call.expression) ||
    call.arguments.length !== 0
  )
    return undefined;
  const helper = handlers.get(call.expression.text);
  return helper
    ? summarizeHandlerStatements(helper, setters, { handlers })
    : undefined;
}

function fallbackResult(
  statement: ts.Statement,
  setters: Map<string, SetterBinding>,
): StatementSummaryResult {
  return {
    summaries: fallbackSummaries([statement], setters),
    terminated: false,
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

function emptyResult(terminated = false): StatementSummaryResult {
  return { summaries: [], terminated };
}

function expressionCall(
  expression: ts.Expression,
): ts.CallExpression | undefined {
  if (ts.isCallExpression(expression)) return expression;
  if (
    ts.isVoidExpression(expression) &&
    ts.isCallExpression(expression.expression)
  )
    return expression.expression;
  return undefined;
}

function containsAwait(node: ts.Node): boolean {
  let found = false;
  const visit = (candidate: ts.Node): void => {
    if (found) return;
    if (ts.isAwaitExpression(candidate)) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(node);
  return found;
}
