import * as ts from "typescript";
import type { ExtractableHandler, SetterBinding } from "../types.js";

export interface HelperInlineOptions {
  handlers: Map<string, ExtractableHandler>;
  setters: Map<string, SetterBinding>;
  maxDepth?: number;
}

export interface FlattenedStatements {
  statements: ts.Statement[];
  inlinedHelpers: string[];
}

export function flattenHandlerHelpers(
  statements: readonly ts.Statement[],
  options: HelperInlineOptions,
  visited: Set<string> = new Set(),
  depth = 0,
): FlattenedStatements {
  const maxDepth = options.maxDepth ?? 4;
  const flattened: ts.Statement[] = [];
  const inlinedHelpers: string[] = [];

  for (const statement of statements) {
    const helperName = bareHelperInvocationName(statement, options);
    if (!helperName || depth >= maxDepth || visited.has(helperName)) {
      flattened.push(statement);
      continue;
    }
    const helper = options.handlers.get(helperName);
    if (
      !helper ||
      !ts.isBlock(helper.body) ||
      !helperBodyCanInline(helper.body.statements)
    ) {
      flattened.push(statement);
      continue;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(helperName);
    const helperStatements = droppableTrailingReturn(helper.body.statements)
      ? helper.body.statements.slice(0, -1)
      : helper.body.statements;
    const nested = flattenHandlerHelpers(
      helperStatements,
      options,
      nextVisited,
      depth + 1,
    );
    flattened.push(...nested.statements);
    inlinedHelpers.push(helperName, ...nested.inlinedHelpers);
  }

  return { statements: flattened, inlinedHelpers };
}

function bareHelperInvocationName(
  statement: ts.Statement,
  options: HelperInlineOptions,
): string | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const call = helperInvocationCall(statement.expression);
  if (!call || call.arguments.length > 0 || !ts.isIdentifier(call.expression))
    return undefined;
  const name = call.expression.text;
  if (options.setters.has(name) || !options.handlers.has(name))
    return undefined;
  return name;
}

function helperInvocationCall(
  expression: ts.Expression,
): ts.CallExpression | undefined {
  if (ts.isCallExpression(expression)) return expression;
  if (
    ts.isAwaitExpression(expression) &&
    ts.isCallExpression(expression.expression)
  )
    return expression.expression;
  if (
    ts.isVoidExpression(expression) &&
    ts.isCallExpression(expression.expression)
  )
    return expression.expression;
  return undefined;
}

function helperBodyCanInline(statements: ts.NodeArray<ts.Statement>): boolean {
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (!ts.isReturnStatement(statement)) continue;
    if (index === statements.length - 1 && returnIsDroppable(statement))
      continue;
    return false;
  }
  return true;
}

function droppableTrailingReturn(
  statements: ts.NodeArray<ts.Statement>,
): boolean {
  const last = statements[statements.length - 1];
  return Boolean(last && ts.isReturnStatement(last) && returnIsDroppable(last));
}

function returnIsDroppable(statement: ts.ReturnStatement): boolean {
  const expression = statement.expression;
  if (!expression) return true;
  if (
    ts.isVoidExpression(expression) ||
    (ts.isIdentifier(expression) && expression.text === "undefined")
  ) {
    return true;
  }
  return ts.isCallExpression(expression);
}
