import * as ts from "typescript";
import type { BoundExpr, SetterBinding } from "../../engine/ts/types.js";
import { setterCallFrom } from "../../engine/ts/transition/setter-write.js";

export function uniqueSetters(
  setters: readonly SetterBinding[],
): SetterBinding[] {
  const byVar = new Map<string, SetterBinding>();
  for (const setter of setters) byVar.set(setter.varId, setter);
  return [...byVar.values()].sort((left, right) =>
    left.varId.localeCompare(right.varId),
  );
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

export function isLoopStatement(statement: ts.Node): boolean {
  return (
    ts.isForStatement(statement) ||
    ts.isForInStatement(statement) ||
    ts.isForOfStatement(statement) ||
    ts.isWhileStatement(statement) ||
    ts.isDoStatement(statement)
  );
}

export function containsAwait(node: ts.Node): boolean {
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

export function loopVarsForStatements(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
): string[] {
  const vars: string[] = [];
  for (const statement of statements) {
    if (isLoopStatement(statement)) {
      vars.push(
        ...uniqueSetters(settersWrittenIn(statement, setters)).map(
          (setter) => setter.varId,
        ),
      );
    }
    if (ts.isBlock(statement)) {
      vars.push(...loopVarsForStatements(statement.statements, setters));
    }
    if (ts.isIfStatement(statement)) {
      vars.push(
        ...loopVarsForStatements([statement.thenStatement], setters),
        ...(statement.elseStatement
          ? loopVarsForStatements([statement.elseStatement], setters)
          : []),
      );
    }
  }
  return vars;
}
