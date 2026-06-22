import type { EffectIR, ExprIR, Value } from "modality-ts/core";
import * as ts from "typescript";
import { literalValue, propertyName } from "../../engine/ts/ast.js";
import { storeVarId } from "./ids.js";

export interface ReducerLoweringContext {
  storeName: string;
  sliceKey: string;
  fieldVarIds: ReadonlyMap<string, string>;
  fieldInitials: ReadonlyMap<string, Value>;
  immer: boolean;
  stateParamName?: string;
  actionParamName?: string;
  payloadDomain?: import("modality-ts/core").AbstractDomain;
  warnings?: string[];
}

export function lowerReducerCase(
  caseFn: ts.ArrowFunction | ts.FunctionExpression,
  ctx: ReducerLoweringContext,
): EffectIR | "unsupported" {
  const stateName =
    caseFn.parameters[0] && ts.isIdentifier(caseFn.parameters[0].name)
      ? caseFn.parameters[0].name.text
      : "state";
  const localCtx: ReducerLoweringContext = {
    ...ctx,
    stateParamName: stateName,
    actionParamName:
      caseFn.parameters[1] && ts.isIdentifier(caseFn.parameters[1].name)
        ? caseFn.parameters[1].name.text
        : "action",
  };
  const body = caseFn.body;
  if (!ts.isBlock(body)) {
    if (ts.isObjectLiteralExpression(body)) {
      return lowerImmutableReturn(body, localCtx);
    }
    if (ts.isParenthesizedExpression(body)) {
      const inner = body.expression;
      if (ts.isObjectLiteralExpression(inner)) {
        return lowerImmutableReturn(inner, localCtx);
      }
    }
    const scalar = lowerExpr(body, localCtx);
    if (scalar && scalar !== "unsupported") {
      const varId = primarySliceVar(localCtx);
      if (varId) return { kind: "assign", var: varId, expr: scalar };
    }
    return "unsupported";
  }
  const returned = blockReturnObject(body);
  if (returned) return lowerImmutableReturn(returned, localCtx);
  if (ctx.immer) return lowerImmerBlock(body, localCtx);
  const effects: EffectIR[] = [];
  for (const statement of body.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      if (ts.isObjectLiteralExpression(statement.expression)) {
        const effect = lowerImmutableReturn(statement.expression, localCtx);
        if (effect !== "unsupported") effects.push(effect);
        continue;
      }
      if (
        ts.isIdentifier(statement.expression) &&
        statement.expression.text === "initialState"
      ) {
        const reset = lowerInitialStateReset(localCtx);
        if (reset !== "unsupported") effects.push(reset);
        continue;
      }
    }
    if (ts.isIfStatement(statement)) {
      const effect = lowerIfReducer(statement, localCtx);
      if (effect && effect !== "unsupported") effects.push(effect);
      continue;
    }
    if (ts.isSwitchStatement(statement)) {
      const effect = lowerSwitchReducer(statement, localCtx);
      if (!effect || effect === "unsupported") return "unsupported";
      effects.push(effect);
      continue;
    }
    if (ctx.immer && ts.isExpressionStatement(statement)) {
      const effect = lowerImmerMutation(statement.expression, localCtx);
      if (effect === "unsupported" || effect === undefined)
        return "unsupported";
      effects.push(effect);
      continue;
    }
    return "unsupported";
  }
  if (effects.length === 0) return { kind: "seq", effects: [] };
  if (effects.length === 1) return effects[0] ?? "unsupported";
  return { kind: "seq", effects };
}

function lowerInitialStateReset(
  ctx: ReducerLoweringContext,
): EffectIR | "unsupported" {
  const effects: EffectIR[] = [];
  for (const [field, initial] of ctx.fieldInitials) {
    const varId = ctx.fieldVarIds.get(field);
    if (!varId) continue;
    effects.push({
      kind: "assign",
      var: varId,
      expr: { kind: "lit", value: initial },
    });
  }
  if (effects.length === 0) return "unsupported";
  if (effects.length === 1) return effects[0] ?? "unsupported";
  return { kind: "seq", effects };
}

function lowerImmutableReturn(
  object: ts.ObjectLiteralExpression,
  ctx: ReducerLoweringContext,
): EffectIR | "unsupported" {
  const effects: EffectIR[] = [];
  let hasSpread = false;
  for (const prop of object.properties) {
    if (ts.isSpreadAssignment(prop)) {
      hasSpread = true;
      continue;
    }
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyName(prop.name);
    if (!name) continue;
    const expr = lowerExpr(prop.initializer, ctx);
    if (!expr || expr === "unsupported") return "unsupported";
    const varId = ctx.fieldVarIds.get(name);
    if (!varId) continue;
    if (hasSpread) {
      effects.push({ kind: "assign", var: varId, expr });
    } else {
      effects.push({ kind: "assign", var: varId, expr });
    }
  }
  if (effects.length === 0) return "unsupported";
  if (effects.length === 1) return effects[0] ?? "unsupported";
  return { kind: "seq", effects };
}

function lowerImmerBlock(
  body: ts.Block,
  ctx: ReducerLoweringContext,
): EffectIR | "unsupported" {
  const effects: EffectIR[] = [];
  for (const statement of body.statements) {
    if (ts.isExpressionStatement(statement)) {
      const effect = lowerImmerMutation(statement.expression, ctx);
      if (effect === "unsupported" || effect === undefined)
        return "unsupported";
      effects.push(effect);
      continue;
    }
    if (ts.isReturnStatement(statement) && statement.expression) {
      if (ts.isObjectLiteralExpression(statement.expression)) {
        const effect = lowerImmutableReturn(statement.expression, {
          ...ctx,
          immer: false,
        });
        if (effect !== "unsupported") effects.push(effect);
        continue;
      }
    }
    return "unsupported";
  }
  if (effects.length === 0) return { kind: "seq", effects: [] };
  if (effects.length === 1) return effects[0] ?? "unsupported";
  return { kind: "seq", effects };
}

function lowerImmerMutation(
  expression: ts.Expression,
  ctx: ReducerLoweringContext,
): EffectIR | "unsupported" | undefined {
  if (ts.isBinaryExpression(expression)) {
    const op = expression.operatorToken.kind;
    if (op === ts.SyntaxKind.EqualsToken) {
      return lowerImmerAssignment(expression, ctx);
    }
    if (
      op === ts.SyntaxKind.PlusEqualsToken ||
      op === ts.SyntaxKind.MinusEqualsToken
    ) {
      return lowerImmerCompoundAssignment(expression, ctx);
    }
    if (
      op === ts.SyntaxKind.AsteriskEqualsToken ||
      op === ts.SyntaxKind.SlashEqualsToken
    ) {
      ctx.warnings?.push("Redux non-representable compound assignment");
      return "unsupported";
    }
  }
  if (
    ts.isPrefixUnaryExpression(expression) ||
    ts.isPostfixUnaryExpression(expression)
  ) {
    return lowerImmerUpdateExpression(expression, ctx);
  }
  return undefined;
}

function lowerImmerAssignment(
  expression: ts.BinaryExpression,
  ctx: ReducerLoweringContext,
): EffectIR | "unsupported" | undefined {
  const path = stateFieldPath(expression.left, ctx.stateParamName);
  if (!path || path.length === 0) {
    ctx.warnings?.push("Redux immer root reassignment not modeled");
    return "unsupported";
  }
  const expr = lowerExpr(expression.right, ctx);
  if (!expr || expr === "unsupported") {
    ctx.warnings?.push(`Redux non-representable update for ${path.join(".")}`);
    return "unsupported";
  }
  const field = path[0];
  if (!field) return "unsupported";
  const varId =
    ctx.fieldVarIds.get(field) ??
    storeVarId(ctx.storeName, `${ctx.sliceKey}.${field}`);
  if (path.length === 1) {
    return { kind: "assign", var: varId, expr };
  }
  return {
    kind: "assign",
    var: varId,
    expr: {
      kind: "updateField",
      target: { kind: "read", var: varId },
      path: path.slice(1),
      value: expr,
    },
  };
}

function lowerImmerCompoundAssignment(
  expression: ts.BinaryExpression,
  ctx: ReducerLoweringContext,
): EffectIR | "unsupported" | undefined {
  const path = stateFieldPath(expression.left, ctx.stateParamName);
  if (path?.length !== 1) return "unsupported";
  const field = path[0];
  if (!field) return "unsupported";
  const varId = ctx.fieldVarIds.get(field);
  if (!varId) return "unsupported";
  const read: ExprIR = { kind: "read", var: varId };
  const rhs = lowerExpr(expression.right, ctx);
  if (!rhs || rhs === "unsupported") return "unsupported";
  const op = expression.operatorToken.kind;
  const expr: ExprIR =
    op === ts.SyntaxKind.PlusEqualsToken
      ? { kind: "add", args: [read, rhs] }
      : { kind: "sub", args: [read, rhs] };
  return { kind: "assign", var: varId, expr };
}

function lowerImmerUpdateExpression(
  expression: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
  ctx: ReducerLoweringContext,
): EffectIR | "unsupported" | undefined {
  const operand = "operand" in expression ? expression.operand : expression;
  const path = stateFieldPath(operand, ctx.stateParamName);
  if (path?.length !== 1) return "unsupported";
  const field = path[0];
  if (!field) return "unsupported";
  const varId = ctx.fieldVarIds.get(field);
  if (!varId) return "unsupported";
  const read: ExprIR = { kind: "read", var: varId };
  const isPrefix = ts.isPrefixUnaryExpression(expression);
  const isIncrement = expression.operator === ts.SyntaxKind.PlusPlusToken;
  const delta: ExprIR = { kind: "lit", value: 1 };
  const expr: ExprIR = isIncrement
    ? { kind: "add", args: [read, delta] }
    : { kind: "sub", args: [read, delta] };
  if (!isPrefix) {
    ctx.warnings?.push("Redux postfix update uses pre-increment approximation");
  }
  return { kind: "assign", var: varId, expr };
}

function lowerIfReducer(
  statement: ts.IfStatement,
  ctx: ReducerLoweringContext,
): EffectIR | "unsupported" | undefined {
  const whenTrue = statementThenEffect(statement, ctx);
  if (!whenTrue || whenTrue === "unsupported") return "unsupported";
  return whenTrue;
}

function lowerSwitchReducer(
  statement: ts.SwitchStatement,
  ctx: ReducerLoweringContext,
): EffectIR | "unsupported" | undefined {
  const effects: EffectIR[] = [];
  for (const clause of statement.caseBlock.clauses) {
    if (!ts.isCaseClause(clause)) continue;
    const caseExpr = clause.expression;
    if (!ts.isStringLiteral(caseExpr)) continue;
    for (const stmt of clause.statements) {
      if (ts.isReturnStatement(stmt) && stmt.expression) {
        if (ts.isObjectLiteralExpression(stmt.expression)) {
          const effect = lowerImmutableReturn(stmt.expression, ctx);
          if (effect !== "unsupported") effects.push(effect);
        }
      }
    }
  }
  if (effects.length === 0) return "unsupported";
  if (effects.length === 1) return effects[0];
  return { kind: "seq", effects };
}

function statementThenEffect(
  statement: ts.IfStatement,
  ctx: ReducerLoweringContext,
): EffectIR | "unsupported" | undefined {
  const thenStatement = statement.thenStatement;
  if (
    ts.isReturnStatement(thenStatement) &&
    thenStatement.expression &&
    ts.isObjectLiteralExpression(thenStatement.expression)
  ) {
    return lowerImmutableReturn(thenStatement.expression, ctx);
  }
  const block = ts.isBlock(thenStatement) ? thenStatement : undefined;
  if (!block) return "unsupported";
  const returned = blockReturnObject(block);
  if (returned) return lowerImmutableReturn(returned, ctx);
  return "unsupported";
}

function _actionTypeFromCondition(
  expression: ts.Expression,
  ctx: ReducerLoweringContext,
): string | undefined {
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
  ) {
    const left = expression.left;
    const right = expression.right;
    if (
      ts.isPropertyAccessExpression(left) &&
      ts.isIdentifier(left.expression) &&
      left.expression.text === (ctx.actionParamName ?? "action") &&
      left.name.text === "type" &&
      ts.isStringLiteral(right)
    ) {
      return right.text;
    }
    if (
      ts.isPropertyAccessExpression(right) &&
      ts.isIdentifier(right.expression) &&
      right.expression.text === (ctx.actionParamName ?? "action") &&
      right.name.text === "type" &&
      ts.isStringLiteral(left)
    ) {
      return left.text;
    }
  }
  return undefined;
}

export function lowerExpr(
  expression: ts.Expression,
  ctx: ReducerLoweringContext,
): ExprIR | "unsupported" | undefined {
  const lit = literalValue(expression);
  if (lit !== undefined) return { kind: "lit", value: lit as Value };

  if (ts.isIdentifier(expression) && expression.text === ctx.stateParamName) {
    return undefined;
  }

  const payload = payloadReadExpr(expression, ctx);
  if (payload) return payload;

  const stateRead = stateFieldReadExpr(expression, ctx);
  if (stateRead) return stateRead;

  if (ts.isObjectLiteralExpression(expression)) {
    return lowerObjectSpreadExpr(expression, ctx);
  }

  if (ts.isBinaryExpression(expression)) {
    const op = expression.operatorToken.kind;
    if (op === ts.SyntaxKind.PlusToken) {
      const left = lowerExpr(expression.left, ctx);
      const right = lowerExpr(expression.right, ctx);
      if (
        !left ||
        left === "unsupported" ||
        !right ||
        right === "unsupported"
      ) {
        return "unsupported";
      }
      return { kind: "add", args: [left, right] };
    }
    if (op === ts.SyntaxKind.MinusToken) {
      const left = lowerExpr(expression.left, ctx);
      const right = lowerExpr(expression.right, ctx);
      if (
        !left ||
        left === "unsupported" ||
        !right ||
        right === "unsupported"
      ) {
        return "unsupported";
      }
      return { kind: "sub", args: [left, right] };
    }
  }

  return undefined;
}

function payloadReadExpr(
  expression: ts.Expression,
  ctx: ReducerLoweringContext,
): ExprIR | undefined {
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === (ctx.actionParamName ?? "action") &&
    expression.name.text === "payload"
  ) {
    return { kind: "freshToken", domainOf: "redux:action.payload" };
  }
  return undefined;
}

function stateFieldReadExpr(
  expression: ts.Expression,
  ctx: ReducerLoweringContext,
): ExprIR | undefined {
  const path = stateFieldPath(expression, ctx.stateParamName);
  if (!path || path.length === 0) return undefined;
  const field = path[0];
  if (!field) return undefined;
  const varId =
    ctx.fieldVarIds.get(field) ??
    storeVarId(ctx.storeName, `${ctx.sliceKey}.${field}`);
  if (path.length === 1) return { kind: "read", var: varId };
  return { kind: "read", var: varId, path: path.slice(1) };
}

function lowerObjectSpreadExpr(
  expression: ts.ObjectLiteralExpression,
  ctx: ReducerLoweringContext,
): ExprIR | "unsupported" | undefined {
  if (expression.properties.length < 2) return undefined;
  const [spread, ...properties] = expression.properties;
  if (!ts.isSpreadAssignment(spread)) return undefined;
  const base = stateFieldReadExpr(spread.expression, ctx);
  if (!base) return "unsupported";
  let current: ExprIR = base;
  for (const property of properties) {
    if (!ts.isPropertyAssignment(property)) return "unsupported";
    const name = propertyName(property.name);
    if (!name) return "unsupported";
    const value = lowerExpr(property.initializer, ctx);
    if (!value || value === "unsupported") return "unsupported";
    current = {
      kind: "updateField",
      target: current,
      path: [name],
      value,
    };
  }
  return current;
}

function stateFieldPath(
  expression: ts.Expression,
  stateParamName?: string,
): string[] | undefined {
  const parts: string[] = [];
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (
    ts.isIdentifier(current) &&
    (!stateParamName || current.text === stateParamName)
  ) {
    return parts;
  }
  return undefined;
}

function blockReturnObject(
  block: ts.Block,
): ts.ObjectLiteralExpression | undefined {
  for (const statement of block.statements) {
    if (
      ts.isReturnStatement(statement) &&
      statement.expression &&
      ts.isObjectLiteralExpression(statement.expression)
    ) {
      return statement.expression;
    }
  }
  return undefined;
}

function primarySliceVar(ctx: ReducerLoweringContext): string | undefined {
  const first = ctx.fieldVarIds.values().next().value;
  return first;
}

export function havocSliceVars(ctx: ReducerLoweringContext): EffectIR {
  const effects: EffectIR[] = [];
  for (const varId of new Set(ctx.fieldVarIds.values())) {
    effects.push({ kind: "havoc", var: varId });
  }
  if (effects.length === 0) {
    return {
      kind: "havoc",
      var: storeVarId(ctx.storeName, ctx.sliceKey),
    };
  }
  if (effects.length === 1) return effects[0] ?? { kind: "seq", effects: [] };
  return { kind: "seq", effects };
}

export function collectAssignments(effect: EffectIR): Map<string, ExprIR> {
  const map = new Map<string, ExprIR>();
  if (effect.kind === "assign") {
    map.set(effect.var, effect.expr);
    return map;
  }
  if (effect.kind === "seq") {
    for (const child of effect.effects) {
      for (const [key, value] of collectAssignments(child)) {
        map.set(key, value);
      }
    }
  }
  return map;
}
