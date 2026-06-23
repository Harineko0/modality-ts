import * as ts from "typescript";
import { bindContextHookObjectDeclaration } from "../context.js";
import type {
  BoundExpr,
  ContextBindings,
  ExtractableHandler,
  SetterBinding,
} from "../types.js";
import { booleanExpr, valueExpr } from "./expressions.js";
import { parseConjunctiveGuardExpression } from "./guards.js";

export function componentGuardLocalsFor(
  attribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
): Map<string, BoundExpr> {
  const body = enclosingFunctionBody(attribute);
  if (!body) return new Map();
  const locals = new Map<string, BoundExpr>();
  for (const statement of body.statements) {
    if (statement.pos > attribute.pos) break;
    if (ts.isReturnStatement(statement)) break;
    bindConstStatement(statement, setters, locals, true);
  }
  return locals;
}

export function componentScopeLocalsFor(
  attribute: ts.JsxAttribute,
  setters: Map<string, SetterBinding>,
  contextBindings: ContextBindings,
): Map<string, BoundExpr> {
  const body = enclosingFunctionBody(attribute);
  if (!body) return new Map();
  const locals = new Map<string, BoundExpr>();
  for (const statement of body.statements) {
    if (statement.pos > attribute.pos) break;
    if (ts.isReturnStatement(statement)) break;
    bindConstStatement(statement, setters, locals, true);
    for (const declaration of variableDeclarations(statement)) {
      bindContextHookObjectDeclaration(declaration, contextBindings, setters);
    }
  }
  return locals;
}

export function variableDeclarations(node: ts.Node): ts.VariableDeclaration[] {
  if (!ts.isVariableStatement(node)) return [];
  return [...node.declarationList.declarations];
}

export function enclosingFunctionBody(node: ts.Node): ts.Block | undefined {
  let current: ts.Node | undefined = node;
  while (current) {
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isFunctionExpression(current) ||
        ts.isArrowFunction(current)) &&
      current.body &&
      ts.isBlock(current.body)
    ) {
      return current.body;
    }
    current = current.parent;
  }
  return undefined;
}

export function callSummaryFromHandler(
  handler: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  initialLocals: Map<string, BoundExpr> = new Map(),
): { call: ts.CallExpression; locals: Map<string, BoundExpr> } | undefined {
  const body = handler.body;
  if (ts.isCallExpression(body))
    return { call: body, locals: new Map(initialLocals) };
  if (ts.isVoidExpression(body) && ts.isCallExpression(body.expression))
    return { call: body.expression, locals: new Map(initialLocals) };
  return ts.isBlock(body)
    ? callSummaryFromStatements(body.statements, setters, initialLocals)
    : undefined;
}

export function callSummaryFromStatements(
  statements: readonly ts.Statement[],
  setters: Map<string, SetterBinding>,
  initialLocals: Map<string, BoundExpr> = new Map(),
): { call: ts.CallExpression; locals: Map<string, BoundExpr> } | undefined {
  const locals = new Map<string, BoundExpr>(initialLocals);
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    const isLast = index === statements.length - 1;
    if (ts.isEmptyStatement(statement)) continue;
    if (isLast && ts.isBlock(statement))
      return callSummaryFromStatements(statement.statements, setters, locals);
    if (isLast && ts.isExpressionStatement(statement)) {
      const call = callExpression(statement.expression);
      if (call) return { call, locals };
    }
    if (!bindConstStatement(statement, setters, locals)) return undefined;
  }
  return undefined;
}

function callExpression(
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

export function bindConstStatement(
  statement: ts.Statement,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>,
  partialBoolean = false,
): boolean {
  if (!ts.isVariableStatement(statement)) return false;
  if (
    (ts.getCombinedNodeFlags(statement.declarationList) &
      ts.NodeFlags.Const) ===
    0
  )
    return false;
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
      return false;
    const setterAlias = ts.isIdentifier(declaration.initializer)
      ? (setters.get(declaration.initializer.text) ??
        locals.get(declaration.initializer.text)?.setter)
      : undefined;
    const binding: BoundExpr | undefined = setterAlias
      ? { expr: { kind: "lit", value: null }, reads: [], setter: setterAlias }
      : (valueExpr(declaration.initializer, setters, locals) ??
        (partialBoolean
          ? parseConjunctiveGuardExpression(
              declaration.initializer,
              setters,
              locals,
            )
          : booleanExpr(declaration.initializer, setters, locals)));
    if (!binding) return false;
    locals.set(declaration.name.text, binding);
  }
  return true;
}

export function inlinedHelperCall(
  call: ts.CallExpression,
  handlers: Map<string, ExtractableHandler>,
  setters: Map<string, SetterBinding>,
  initialLocals: Map<string, BoundExpr> = new Map(),
): { call: ts.CallExpression; locals: Map<string, BoundExpr> } | undefined {
  if (!ts.isIdentifier(call.expression)) return undefined;
  const helper = handlers.get(call.expression.text);
  if (!helper) return undefined;
  if (call.arguments.length === 0) {
    return callSummaryFromHandler(helper, setters, initialLocals);
  }
  const boundLocals = new Map(initialLocals);
  for (let index = 0; index < call.arguments.length; index += 1) {
    const parameter = helper.parameters[index];
    const argument = call.arguments[index];
    if (!parameter || !argument || !ts.isIdentifier(parameter.name))
      return undefined;
    const binding = valueExpr(argument, setters, initialLocals);
    if (!binding) return undefined;
    boundLocals.set(parameter.name.text, binding);
  }
  return callSummaryFromHandler(helper, setters, boundLocals);
}
