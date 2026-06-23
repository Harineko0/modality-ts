import type { EffectIR, ExprIR, Value } from "modality-ts/core";
import * as ts from "typescript";
import { literalValue } from "../../../lang/ts/driver/ast.js";
import { atomVarId } from "./ids.js";

export interface DerivedWriteContext {
  atomNames: ReadonlySet<string>;
  storeScope?: string;
}

export function summarizeDerivedWriteBody(
  writeFn: ts.ArrowFunction | ts.FunctionExpression,
  ctx: DerivedWriteContext,
): EffectIR | "unsupported" {
  const body = writeFn.body;
  if (!ts.isBlock(body)) {
    const effect = summarizeDerivedWriteExpression(body, writeFn, ctx);
    return effect ?? "unsupported";
  }
  const effects: EffectIR[] = [];
  for (const statement of body.statements) {
    if (!ts.isExpressionStatement(statement)) return "unsupported";
    const effect = summarizeDerivedWriteExpression(
      statement.expression,
      writeFn,
      ctx,
    );
    if (!effect) return "unsupported";
    effects.push(effect);
  }
  if (effects.length === 0) return { kind: "seq", effects: [] };
  if (effects.length === 1) return effects[0] ?? "unsupported";
  return { kind: "seq", effects };
}

function summarizeDerivedWriteExpression(
  expression: ts.Expression,
  writeFn: ts.ArrowFunction | ts.FunctionExpression,
  ctx: DerivedWriteContext,
): EffectIR | undefined {
  if (!ts.isCallExpression(expression)) return undefined;
  const callee = expression.expression;
  if (!ts.isIdentifier(callee) || callee.text !== "set") return undefined;
  const targetArg = expression.arguments[0];
  const valueArg = expression.arguments[1];
  if (!targetArg || !valueArg) return undefined;
  const target = atomTargetFromExpression(targetArg, ctx);
  if (!target) return undefined;
  const updateArg = writeFn.parameters[2];
  const argName =
    updateArg && ts.isIdentifier(updateArg.name)
      ? updateArg.name.text
      : undefined;
  const expr = valueExprFromSetterArg(valueArg, target, writeFn, ctx, argName);
  if (!expr) return undefined;
  return { kind: "assign", var: target, expr };
}

function atomTargetFromExpression(
  expression: ts.Expression,
  ctx: DerivedWriteContext,
): string | undefined {
  if (!ts.isIdentifier(expression)) return undefined;
  if (!ctx.atomNames.has(expression.text)) return undefined;
  return atomVarId(expression.text, ctx.storeScope);
}

function valueExprFromSetterArg(
  expression: ts.Expression,
  targetVar: string,
  writeFn: ts.ArrowFunction | ts.FunctionExpression,
  ctx: DerivedWriteContext,
  updateArgName?: string,
): ExprIR | undefined {
  const literal = literalValue(expression);
  if (literal !== undefined) return { kind: "lit", value: literal as Value };
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = readExprFromGet(expression.left, writeFn, ctx);
    const right = literalValue(expression.right);
    if (left && typeof right === "number") {
      return {
        kind: "cond",
        args: [
          { kind: "lit", value: true },
          left,
          { kind: "lit", value: right },
        ],
      };
    }
    if (left && right === undefined) {
      const rightRead = readExprFromGet(expression.right, writeFn, ctx);
      if (rightRead) {
        return left;
      }
    }
  }
  if (ts.isIdentifier(expression) && expression.text === updateArgName) {
    return { kind: "read", var: targetVar };
  }
  if (
    (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) &&
    expression.parameters.length === 1 &&
    ts.isIdentifier(expression.parameters[0].name)
  ) {
    const prevName = expression.parameters[0].name.text;
    if (!ts.isBlock(expression.body)) {
      const inner = valueExprFromSetterArg(
        expression.body,
        targetVar,
        writeFn,
        ctx,
        prevName,
      );
      if (inner) return inner;
    }
  }
  const getRead = readExprFromGet(expression, writeFn, ctx);
  if (getRead) return getRead;
  return undefined;
}

function readExprFromGet(
  expression: ts.Expression,
  writeFn: ts.ArrowFunction | ts.FunctionExpression,
  ctx: DerivedWriteContext,
): ExprIR | undefined {
  if (!ts.isCallExpression(expression)) return undefined;
  const getFn = writeFn.parameters[0];
  if (!getFn || !ts.isIdentifier(getFn.name) || getFn.name.text !== "get")
    return undefined;
  if (!ts.isIdentifier(expression.expression)) return undefined;
  if (expression.expression.text !== getFn.name.text) return undefined;
  const atomArg = expression.arguments[0];
  if (!atomArg || !ts.isIdentifier(atomArg)) return undefined;
  if (!ctx.atomNames.has(atomArg.text)) return undefined;
  return { kind: "read", var: atomVarId(atomArg.text, ctx.storeScope) };
}

export function isReadFunction(
  expression: ts.Expression,
): expression is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression);
}

export function isAsyncReadFunction(
  expression: ts.Expression,
): expression is ts.ArrowFunction | ts.FunctionExpression {
  return (
    isReadFunction(expression) &&
    Boolean(
      expression.modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword,
      ),
    )
  );
}

export function getCallsInReadFunction(
  readFn: ts.ArrowFunction | ts.FunctionExpression,
): string[] {
  const deps = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "get"
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isIdentifier(arg)) deps.add(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  if (ts.isBlock(readFn.body)) {
    ts.forEachChild(readFn.body, visit);
  } else {
    visit(readFn.body);
  }
  return [...deps].sort();
}
