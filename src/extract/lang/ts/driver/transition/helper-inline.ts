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
    const invocation = helperInvocation(statement, options);
    if (
      !invocation ||
      depth >= maxDepth ||
      visited.has(invocation.helperName)
    ) {
      flattened.push(statement);
      continue;
    }
    const helper = options.handlers.get(invocation.helperName);
    if (
      !helper ||
      !ts.isBlock(helper.body) ||
      !helperBodyCanInline(helper.body.statements)
    ) {
      flattened.push(statement);
      continue;
    }
    const nextVisited = new Set(visited);
    nextVisited.add(invocation.helperName);
    const helperStatements = [
      ...parameterBindingStatements(helper, invocation.call),
      ...helper.body.statements,
    ];
    const nested = flattenHandlerHelpers(
      helperStatements,
      options,
      nextVisited,
      depth + 1,
    );
    flattened.push(...nested.statements);
    inlinedHelpers.push(invocation.helperName, ...nested.inlinedHelpers);
  }

  return { statements: flattened, inlinedHelpers };
}

function helperInvocation(
  statement: ts.Statement,
  options: HelperInlineOptions,
): { helperName: string; call: ts.CallExpression } | undefined {
  if (!ts.isExpressionStatement(statement)) return undefined;
  const call = helperInvocationCall(statement.expression);
  if (!call || !ts.isIdentifier(call.expression)) return undefined;
  const name = call.expression.text;
  if (options.setters.has(name) || !options.handlers.has(name))
    return undefined;
  return { helperName: name, call };
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
  const visit = (node: ts.Node): boolean => {
    if (ts.isReturnStatement(node)) return returnIsDroppable(node);
    return ts.forEachChild(node, visit) ?? true;
  };
  for (const statement of statements) {
    if (!visit(statement)) return false;
  }
  return true;
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

function parameterBindingStatements(
  helper: ExtractableHandler,
  call: ts.CallExpression,
): ts.Statement[] {
  const statements: ts.Statement[] = [];
  for (let index = 0; index < call.arguments.length; index += 1) {
    const parameter = helper.parameters[index];
    const argument = call.arguments[index];
    if (!parameter || !argument || !ts.isIdentifier(parameter.name)) {
      return [];
    }
    statements.push(
      ts.factory.createVariableStatement(
        undefined,
        ts.factory.createVariableDeclarationList(
          [
            ts.factory.createVariableDeclaration(
              parameter.name.text,
              undefined,
              undefined,
              argument,
            ),
          ],
          ts.NodeFlags.Const,
        ),
      ),
    );
  }
  return statements;
}
