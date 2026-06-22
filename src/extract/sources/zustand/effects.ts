import type { EffectIR, ExprIR, Value } from "modality-ts/core";
import * as ts from "typescript";
import { literalValue, propertyName } from "../../engine/ts/ast.js";
import { storeVarId } from "./ids.js";

export interface EffectLoweringContext {
  storeName: string;
  fieldVarIds: ReadonlyMap<string, string>;
  fieldInitials: ReadonlyMap<string, Value>;
  immer: boolean;
  getParamName?: string;
  setParamName?: string;
  stateParamName?: string;
  warnings?: string[];
}

export function lowerActionBody(
  actionFn: ts.ArrowFunction | ts.FunctionExpression,
  ctx: EffectLoweringContext,
): EffectIR | "unsupported" {
  const body = actionFn.body;
  const setName = ctx.setParamName ?? actionParamName(actionFn, 0, "set");
  const getName = ctx.getParamName ?? actionParamName(actionFn, 1, "get");
  const localCtx: EffectLoweringContext = {
    ...ctx,
    setParamName: setName,
    getParamName: getName,
  };
  if (!ts.isBlock(body)) {
    if (ts.isCallExpression(body)) {
      const effect = lowerSetInvocation(body, localCtx);
      if (!effect || effect === "unsupported") return "unsupported";
      return effect;
    }
    return "unsupported";
  }
  const effects: EffectIR[] = [];
  for (const statement of body.statements) {
    if (ts.isExpressionStatement(statement)) {
      const effect = lowerSetInvocation(statement.expression, localCtx);
      if (!effect || effect === "unsupported") return "unsupported";
      effects.push(effect);
      continue;
    }
    if (ts.isIfStatement(statement) || ts.isForStatement(statement)) {
      ctx.warnings?.push("Zustand conditional set call not precisely modeled");
      continue;
    }
    return "unsupported";
  }
  if (effects.length === 0) return { kind: "seq", effects: [] };
  if (effects.length === 1) return effects[0] ?? "unsupported";
  return { kind: "seq", effects };
}

function actionParamName(
  fn: ts.ArrowFunction | ts.FunctionExpression,
  index: number,
  fallback: string,
): string {
  const param = fn.parameters[index];
  if (param && ts.isIdentifier(param.name)) return param.name.text;
  return fallback;
}

function lowerSetInvocation(
  expression: ts.Expression,
  ctx: EffectLoweringContext,
): EffectIR | "unsupported" | undefined {
  if (!ts.isCallExpression(expression)) return undefined;
  if (!ts.isIdentifier(expression.expression)) return undefined;
  const callee = expression.expression.text;
  if (callee !== "set" && callee !== ctx.setParamName) return undefined;
  if (ctx.immer) {
    return lowerImmerSetCall(expression, ctx);
  }
  return lowerSetCall(expression, ctx);
}

export function lowerSetCall(
  call: ts.CallExpression,
  ctx: EffectLoweringContext,
): EffectIR | "unsupported" | undefined {
  const partialArg = call.arguments[0];
  if (!partialArg) return undefined;
  const replace = call.arguments[1]?.kind === ts.SyntaxKind.TrueKeyword;

  if (ts.isObjectLiteralExpression(partialArg)) {
    return lowerPartialObject(partialArg, ctx, replace);
  }
  if (
    (ts.isArrowFunction(partialArg) || ts.isFunctionExpression(partialArg)) &&
    partialArg.parameters.length >= 1 &&
    ts.isIdentifier(partialArg.parameters[0].name)
  ) {
    const stateName = partialArg.parameters[0].name.text;
    if (ctx.immer) {
      return lowerImmerCallback(partialArg, {
        ...ctx,
        stateParamName: stateName,
      });
    }
    if (!ts.isBlock(partialArg.body)) {
      if (ts.isObjectLiteralExpression(partialArg.body)) {
        return lowerPartialObject(
          partialArg.body,
          {
            ...ctx,
            stateParamName: stateName,
          },
          replace,
        );
      }
      if (ts.isParenthesizedExpression(partialArg.body)) {
        const inner = partialArg.body.expression;
        if (ts.isObjectLiteralExpression(inner)) {
          return lowerPartialObject(
            inner,
            {
              ...ctx,
              stateParamName: stateName,
            },
            replace,
          );
        }
      }
    }
    if (ts.isBlock(partialArg.body)) {
      const returned = blockReturnObject(partialArg.body);
      if (returned) {
        return lowerPartialObject(
          returned,
          {
            ...ctx,
            stateParamName: stateName,
          },
          replace,
        );
      }
    }
  }
  return "unsupported";
}

export function lowerImmerSetCall(
  call: ts.CallExpression,
  ctx: EffectLoweringContext,
): EffectIR | "unsupported" | undefined {
  const callbackArg = call.arguments[0];
  if (
    !callbackArg ||
    !(
      ts.isArrowFunction(callbackArg) || ts.isFunctionExpression(callbackArg)
    ) ||
    !ts.isIdentifier(callbackArg.parameters[0]?.name)
  ) {
    return "unsupported";
  }
  const stateName = callbackArg.parameters[0].name.text;
  if (!ts.isBlock(callbackArg.body)) {
    const returned = expressionObjectLiteral(callbackArg.body);
    if (returned) {
      return lowerPartialObject(
        returned,
        { ...ctx, stateParamName: stateName, immer: false },
        false,
      );
    }
    return "unsupported";
  }
  return lowerImmerCallback(callbackArg, { ...ctx, stateParamName: stateName });
}

function lowerImmerCallback(
  callback: ts.ArrowFunction | ts.FunctionExpression,
  ctx: EffectLoweringContext,
): EffectIR | "unsupported" | undefined {
  if (!ts.isBlock(callback.body)) return "unsupported";
  const returned = blockReturnObject(callback.body);
  if (returned) {
    return lowerPartialObject(returned, { ...ctx, immer: false }, false);
  }
  const effects: EffectIR[] = [];
  for (const statement of callback.body.statements) {
    const effect = lowerImmerStatement(statement, ctx);
    if (effect === "unsupported") return "unsupported";
    if (effect) effects.push(effect);
  }
  if (effects.length === 0) return { kind: "seq", effects: [] };
  if (effects.length === 1) return effects[0];
  return { kind: "seq", effects };
}

function lowerImmerStatement(
  statement: ts.Statement,
  ctx: EffectLoweringContext,
): EffectIR | "unsupported" | undefined {
  if (ts.isExpressionStatement(statement)) {
    return lowerImmerMutation(statement.expression, ctx);
  }
  return undefined;
}

function lowerImmerMutation(
  expression: ts.Expression,
  ctx: EffectLoweringContext,
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
      const field = stateFieldFromExpression(
        expression.left,
        ctx.stateParamName,
      );
      ctx.warnings?.push(
        `Zustand non-representable update for ${field ?? "field"}`,
      );
      return "unsupported";
    }
  }
  if (
    ts.isPrefixUnaryExpression(expression) ||
    ts.isPostfixUnaryExpression(expression)
  ) {
    return lowerImmerUpdateExpression(expression, ctx);
  }
  if (ts.isCallExpression(expression)) {
    const field = methodMutationField(expression, ctx.stateParamName);
    if (field) {
      ctx.warnings?.push(
        `Zustand immer container mutation not precisely modeled for ${field}`,
      );
      return "unsupported";
    }
  }
  return undefined;
}

function lowerImmerAssignment(
  expression: ts.BinaryExpression,
  ctx: EffectLoweringContext,
): EffectIR | "unsupported" | undefined {
  const path = stateFieldPath(expression.left, ctx.stateParamName);
  if (!path || path.length === 0) {
    if (isStateIdentifier(expression.left, ctx.stateParamName)) {
      ctx.warnings?.push(
        "Zustand immer container mutation not precisely modeled for state",
      );
      return "unsupported";
    }
    return "unsupported";
  }
  const expr = lowerExpr(expression.right, ctx);
  if (expr === "unsupported") {
    ctx.warnings?.push(`Zustand non-representable update for ${path[0]}`);
    return "unsupported";
  }
  if (!expr) return "unsupported";
  if (path.length === 1) {
    return {
      kind: "assign",
      var: storeVarId(ctx.storeName, path[0] ?? ""),
      expr,
    };
  }
  const root = path[0];
  if (!root) return "unsupported";
  return {
    kind: "assign",
    var: storeVarId(ctx.storeName, root),
    expr: {
      kind: "updateField",
      target: { kind: "read", var: storeVarId(ctx.storeName, root) },
      path: path.slice(1),
      value: expr,
    },
  };
}

function lowerImmerCompoundAssignment(
  expression: ts.BinaryExpression,
  ctx: EffectLoweringContext,
): EffectIR | "unsupported" | undefined {
  const path = stateFieldPath(expression.left, ctx.stateParamName);
  if (path?.length !== 1) return "unsupported";
  const field = path[0];
  if (!field) return "unsupported";
  const read: ExprIR = {
    kind: "read",
    var: storeVarId(ctx.storeName, field),
  };
  const rhs = lowerExpr(expression.right, ctx);
  if (rhs === "unsupported" || !rhs) {
    ctx.warnings?.push(`Zustand non-representable update for ${field}`);
    return "unsupported";
  }
  const op = expression.operatorToken.kind;
  const expr: ExprIR =
    op === ts.SyntaxKind.PlusEqualsToken
      ? { kind: "add", args: [read, rhs] }
      : { kind: "sub", args: [read, rhs] };
  return { kind: "assign", var: storeVarId(ctx.storeName, field), expr };
}

function lowerImmerUpdateExpression(
  expression: ts.PrefixUnaryExpression | ts.PostfixUnaryExpression,
  ctx: EffectLoweringContext,
): EffectIR | "unsupported" | undefined {
  const operand = "operand" in expression ? expression.operand : expression;
  const path = stateFieldPath(operand, ctx.stateParamName);
  if (path?.length !== 1) return "unsupported";
  const field = path[0];
  if (!field) return "unsupported";
  const read: ExprIR = {
    kind: "read",
    var: storeVarId(ctx.storeName, field),
  };
  const one: ExprIR = { kind: "lit", value: 1 };
  const isIncrement =
    expression.kind === ts.SyntaxKind.PrefixUnaryExpression
      ? expression.operator === ts.SyntaxKind.PlusPlusToken ||
        expression.operator === ts.SyntaxKind.MinusMinusToken
      : expression.operator === ts.SyntaxKind.PlusPlusToken ||
        expression.operator === ts.SyntaxKind.MinusMinusToken;
  if (!isIncrement) return "unsupported";
  const isPlus =
    expression.kind === ts.SyntaxKind.PrefixUnaryExpression
      ? expression.operator === ts.SyntaxKind.PlusPlusToken
      : expression.operator === ts.SyntaxKind.PlusPlusToken;
  const expr: ExprIR = isPlus
    ? { kind: "add", args: [read, one] }
    : { kind: "sub", args: [read, one] };
  return { kind: "assign", var: storeVarId(ctx.storeName, field), expr };
}

function lowerPartialObject(
  object: ts.ObjectLiteralExpression,
  ctx: EffectLoweringContext,
  replace: boolean,
): EffectIR | "unsupported" {
  const effects: EffectIR[] = [];
  const updatedFields = new Set<string>();
  for (const prop of object.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyName(prop.name);
    if (!name) continue;
    const expr = lowerExpr(prop.initializer, ctx);
    if (expr === "unsupported") {
      ctx.warnings?.push(`Zustand non-representable update for ${name}`);
      continue;
    }
    if (!expr) return "unsupported";
    updatedFields.add(name);
    effects.push({
      kind: "assign",
      var: storeVarId(ctx.storeName, name),
      expr,
    });
  }
  if (replace) {
    for (const [field, initial] of ctx.fieldInitials) {
      if (updatedFields.has(field)) continue;
      if (initial === undefined) {
        ctx.warnings?.push(
          "Zustand set(replace=true) partial fields not fully modeled",
        );
        continue;
      }
      effects.push({
        kind: "assign",
        var: storeVarId(ctx.storeName, field),
        expr: { kind: "lit", value: initial },
      });
    }
  }
  if (effects.length === 0) return "unsupported";
  if (effects.length === 1) {
    const only = effects[0];
    return only ?? "unsupported";
  }
  return { kind: "seq", effects };
}

export function lowerExpr(
  expression: ts.Expression,
  ctx: EffectLoweringContext,
): ExprIR | "unsupported" | undefined {
  const lit = literalValue(expression);
  if (lit !== undefined) return { kind: "lit", value: lit as Value };

  if (ts.isIdentifier(expression) && expression.text === ctx.stateParamName) {
    return undefined;
  }

  const stateRead = stateFieldReadExpr(expression, ctx);
  if (stateRead) return stateRead;

  const getRead = getFieldReadExpr(expression, ctx);
  if (getRead) return getRead;

  if (ts.isConditionalExpression(expression)) {
    const cond = lowerComparisonOrBoolean(expression.condition, ctx);
    const whenTrue = lowerExpr(expression.whenTrue, ctx);
    const whenFalse = lowerExpr(expression.whenFalse, ctx);
    if (
      cond &&
      whenTrue &&
      whenTrue !== "unsupported" &&
      whenFalse &&
      whenFalse !== "unsupported"
    ) {
      return { kind: "cond", args: [cond, whenTrue, whenFalse] };
    }
    return "unsupported";
  }

  if (ts.isBinaryExpression(expression)) {
    const op = expression.operatorToken.kind;
    if (
      op === ts.SyntaxKind.LessThanToken ||
      op === ts.SyntaxKind.LessThanEqualsToken ||
      op === ts.SyntaxKind.GreaterThanToken ||
      op === ts.SyntaxKind.GreaterThanEqualsToken
    ) {
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
      const kind =
        op === ts.SyntaxKind.LessThanToken
          ? "lt"
          : op === ts.SyntaxKind.LessThanEqualsToken
            ? "lte"
            : op === ts.SyntaxKind.GreaterThanToken
              ? "gt"
              : "gte";
      return { kind, args: [left, right] };
    }
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
    if (op === ts.SyntaxKind.PercentToken) {
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
      return { kind: "mod", args: [left, right] };
    }
    if (op === ts.SyntaxKind.AsteriskToken || op === ts.SyntaxKind.SlashToken) {
      return "unsupported";
    }
  }

  if (ts.isPrefixUnaryExpression(expression)) {
    if (expression.operator === ts.SyntaxKind.ExclamationToken) {
      const inner = lowerExpr(expression.operand, ctx);
      if (!inner || inner === "unsupported") return "unsupported";
      return { kind: "not", args: [inner] };
    }
  }

  if (ts.isObjectLiteralExpression(expression)) {
    return lowerObjectSpreadExpr(expression, ctx);
  }

  return undefined;
}

function lowerObjectSpreadExpr(
  expression: ts.ObjectLiteralExpression,
  ctx: EffectLoweringContext,
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

function lowerComparisonOrBoolean(
  expression: ts.Expression,
  ctx: EffectLoweringContext,
): ExprIR | undefined {
  const lowered = lowerExpr(expression, ctx);
  if (lowered && lowered !== "unsupported") return lowered;
  return undefined;
}

function stateFieldReadExpr(
  expression: ts.Expression,
  ctx: EffectLoweringContext,
): ExprIR | undefined {
  const path = stateFieldPath(expression, ctx.stateParamName);
  if (!path || path.length === 0) return undefined;
  const root = path[0];
  if (!root) return undefined;
  if (path.length === 1) {
    return { kind: "read", var: storeVarId(ctx.storeName, root) };
  }
  return {
    kind: "read",
    var: storeVarId(ctx.storeName, root),
    path: path.slice(1),
  };
}

function getFieldReadExpr(
  expression: ts.Expression,
  ctx: EffectLoweringContext,
): ExprIR | undefined {
  if (!ts.isPropertyAccessExpression(expression)) {
    if (!ts.isCallExpression(expression)) return undefined;
    if (
      !ts.isIdentifier(expression.expression) ||
      expression.expression.text !== ctx.getParamName
    ) {
      return undefined;
    }
    return undefined;
  }
  if (
    ts.isCallExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === ctx.getParamName &&
    expression.expression.arguments.length === 0
  ) {
    const field = expression.name.text;
    return { kind: "read", var: storeVarId(ctx.storeName, field) };
  }
  return undefined;
}

function stateFieldPath(
  expression: ts.Expression,
  stateParamName?: string,
): string[] | undefined {
  if (!stateParamName) return undefined;
  if (ts.isIdentifier(expression) && expression.text === stateParamName) {
    return [];
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const base = stateFieldPath(expression.expression, stateParamName);
    if (base === undefined) return undefined;
    return [...base, expression.name.text];
  }
  return undefined;
}

function stateFieldFromExpression(
  expression: ts.Expression,
  stateParamName?: string,
): string | undefined {
  const path = stateFieldPath(expression, stateParamName);
  return path?.[0];
}

function isStateIdentifier(
  expression: ts.Expression,
  stateParamName?: string,
): boolean {
  return (
    stateParamName !== undefined &&
    ts.isIdentifier(expression) &&
    expression.text === stateParamName
  );
}

function methodMutationField(
  call: ts.CallExpression,
  stateParamName?: string,
): string | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const method = call.expression.name.text;
  if (!["push", "splice", "sort", "pop", "shift", "unshift"].includes(method)) {
    return undefined;
  }
  return stateFieldFromExpression(call.expression.expression, stateParamName);
}

function blockReturnObject(
  block: ts.Block,
): ts.ObjectLiteralExpression | undefined {
  for (const stmt of block.statements) {
    if (ts.isReturnStatement(stmt) && stmt.expression) {
      return expressionObjectLiteral(stmt.expression);
    }
  }
  return undefined;
}

function expressionObjectLiteral(
  expression: ts.Expression,
): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (ts.isParenthesizedExpression(expression)) {
    return expressionObjectLiteral(expression.expression);
  }
  return undefined;
}
