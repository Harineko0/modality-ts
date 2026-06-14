import * as ts from "typescript";
import { callName, componentNameFor, extractableHandlerInitializer, isExtractableHandler, isPropertyAccessLike, isUseEffectCall, isUseReducerCall, isUseRefCall, isUseStateCall, lineAndColumn, literalValue, propertyName, providerComponentNames } from "../../../engine/ts/ast.js";
import { componentDeclarations, calledCustomHook, customHookDeclarations, detectStatefulListComponents, handlerExpression, inlineCustomHookState, isCustomHookDeclaration, isForwardablePropName, isIntrinsicJsxAttribute, jsxTagName, listRenderedHandlerInfo } from "../../../engine/ts/components.js";
import { bindContextHookObjectDeclaration, discoverContextBindings, emptyContextBindings, setterBindingFromDecl, settersForComponent } from "../../../engine/ts/context.js";
import { safeId, tagStableIdKey, uniqueStrings, withStableTransitionIds } from "../../../engine/ts/ids.js";
import { inputTransitions } from "../../../engine/ts/input-transitions.js";
import { jsxRouteTarget, routeMountGuard, routeMountReads, routeTargetValue, templateRoutePattern } from "../../../engine/ts/routes.js";
import { staticNavigationTransitions } from "../../../engine/ts/static-navigation.js";
import { firstValue, inferUseStateDomain, initialValueForUseState, typeAliasDeclarations } from "../../../engine/ts/domains.js";
import { effectReads, effectWrites, type AbstractDomain, type EffectIR, type ExprIR, type Locator, type StateVarDecl, type Transition, type Value } from "modality-ts/core";
import type { CallSite, M0Ctx, RouterPlugin, StateSourcePlugin } from "../../../engine/spi/index.js";
import type { BoundExpr, ComponentDecl, ExtractableHandler, ExtractedModelSkeleton, ExtractionWarning, EffectSummary, SetterBinding, SetterCall, UseStateExtractionOptions, UseStateExtractionResult } from "../types.js";

export function setterArgumentExpr(
  argument: ts.Expression,
  setter: SetterBinding,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>
): BoundExpr | undefined {
  if (ts.isObjectLiteralExpression(argument)) {
    const object = objectLiteralAssignmentExpr(argument, setter.domain, setters, locals);
    if (object) return object;
  }
  if ((ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) && argument.parameters.length === 1 && ts.isIdentifier(argument.parameters[0].name)) {
    if (ts.isBlock(argument.body)) return undefined;
    return valueExpr(argument.body, setters, new Map([...locals, [argument.parameters[0].name.text, readBinding(setter.varId)]]));
  }
  return valueExpr(argument, setters, locals);
}

export function objectLiteralAssignmentExpr(
  expression: ts.ObjectLiteralExpression,
  domain: AbstractDomain,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>
): BoundExpr | undefined {
  const value: Record<string, Value> = {};
  const reads = new Set<string>();
  const fields = domain.kind === "record" ? domain.fields : domain.kind === "tagged" ? taggedFieldsForObject(expression, domain) : {};
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const name = propertyName(property.name);
    if (!name) return undefined;
    const literal = literalValue(property.initializer);
    if (literal !== undefined) {
      value[name] = literal;
      continue;
    }
    const bound = valueExpr(property.initializer, setters, locals);
    if (bound?.expr.kind === "lit") {
      value[name] = bound.expr.value;
      bound.reads.forEach((read) => reads.add(read));
      continue;
    }
    value[name] = firstValue(fields[name] ?? { kind: "tokens", count: 1 });
  }
  return { expr: { kind: "lit", value }, reads: [...reads] };
}

export function taggedFieldsForObject(expression: ts.ObjectLiteralExpression, domain: Extract<AbstractDomain, { kind: "tagged" }>): Record<string, AbstractDomain> {
  const tagProperty = expression.properties.find((property): property is ts.PropertyAssignment =>
    ts.isPropertyAssignment(property) && propertyName(property.name) === domain.tag
  );
  const tag = tagProperty ? literalValue(tagProperty.initializer) : undefined;
  const variant = typeof tag === "string" ? domain.variants[tag] : undefined;
  return variant?.kind === "record" ? variant.fields : {};
}

export function valueExpr(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>
): BoundExpr | undefined {
  const value = literalValue(expression);
  if (value !== undefined) return { expr: { kind: "lit", value }, reads: [] };
  if (ts.isIdentifier(expression) || isPropertyAccessLike(expression)) return modeledReadExpr(expression, setters, locals);
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    const parsed = booleanExpr(expression.operand, setters, locals);
    return parsed ? { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads } : undefined;
  }
  if (ts.isParenthesizedExpression(expression)) return valueExpr(expression.expression, setters, locals);
  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return booleanExpr(expression, setters, locals);
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return nullishOptionalReadExpr(expression, setters, locals);
  }
  if (ts.isConditionalExpression(expression)) {
    const condition = booleanExpr(expression.condition, setters, locals);
    const whenTrue = valueExpr(expression.whenTrue, setters, locals);
    const whenFalse = valueExpr(expression.whenFalse, setters, locals);
    if (!condition || !whenTrue || !whenFalse) return undefined;
    return {
      expr: { kind: "cond", args: [condition.expr, whenTrue.expr, whenFalse.expr] },
      reads: [...new Set([...condition.reads, ...whenTrue.reads, ...whenFalse.reads])]
    };
  }
  if (ts.isObjectLiteralExpression(expression)) return objectSpreadUpdateExpr(expression, setters, locals);
  return undefined;
}

export function objectSpreadUpdateExpr(
  expression: ts.ObjectLiteralExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>
): BoundExpr | undefined {
  if (expression.properties.length < 2) return undefined;
  const [spread, ...properties] = expression.properties;
  if (!ts.isSpreadAssignment(spread)) return undefined;
  let current = valueExpr(spread.expression, setters, locals);
  if (!current) return undefined;
  const reads = new Set(current.reads);
  for (const property of properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const name = propertyName(property.name);
    if (!name) return undefined;
    const value = valueExpr(property.initializer, setters, locals);
    if (!value) return undefined;
    value.reads.forEach((read) => reads.add(read));
    current = {
      expr: { kind: "updateField", target: current.expr, path: [name], value: value.expr },
      reads: [...reads]
    };
  }
  return current;
}

export interface OptionalReadPath {
  base: string;
  path: string[];
  optional: boolean;
}

export function nullishOptionalReadExpr(
  expression: ts.BinaryExpression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr> = new Map()
): BoundExpr | undefined {
  const fallback = literalValue(expression.right);
  if (fallback === undefined) return undefined;
  const read = optionalReadPath(expression.left);
  if (!read?.optional || read.path.length === 0) return undefined;
  const local = locals.get(read.base);
  const varId = local?.expr.kind === "read" ? local.expr.var : stateVarForName(read.base, setters);
  if (!varId) return undefined;
  const basePath = local?.expr.kind === "read" ? local.expr.path ?? [] : [];
  return {
    expr: {
      kind: "cond",
      args: [
        { kind: "eq", args: [{ kind: "read", var: varId, ...(basePath.length > 0 ? { path: basePath } : {}) }, { kind: "lit", value: null }] },
        { kind: "lit", value: fallback },
        { kind: "read", var: varId, path: [...basePath, ...read.path] }
      ]
    },
    reads: [varId]
  };
}

export function optionalReadPath(expression: ts.Expression): OptionalReadPath | undefined {
  if (ts.isIdentifier(expression)) return { base: expression.text, path: [], optional: false };
  if (isPropertyAccessLike(expression)) {
    const base = optionalReadPath(expression.expression);
    if (!base) return undefined;
    return {
      base: base.base,
      path: [...base.path, expression.name.text],
      optional: base.optional || Boolean((expression as ts.PropertyAccessExpression & { questionDotToken?: unknown }).questionDotToken)
    };
  }
  return undefined;
}


export function booleanExpr(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>
): BoundExpr | undefined {
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { expr: { kind: "lit", value: true }, reads: [] };
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { expr: { kind: "lit", value: false }, reads: [] };
  if (ts.isIdentifier(expression)) return valueExpr(expression, setters, locals);
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    const parsed = booleanExpr(expression.operand, setters, locals);
    return parsed ? { expr: { kind: "not", args: [parsed.expr] }, reads: parsed.reads } : undefined;
  }
  if (ts.isParenthesizedExpression(expression)) return booleanExpr(expression.expression, setters, locals);
  if (ts.isBinaryExpression(expression)) {
    if (expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      const left = booleanExpr(expression.left, setters, locals);
      const right = booleanExpr(expression.right, setters, locals);
      if (!left || !right) return undefined;
      return {
        expr: { kind: expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? "and" : "or", args: [left.expr, right.expr] },
        reads: [...new Set([...left.reads, ...right.reads])]
      };
    }
    if (
      expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
      expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
    ) {
      const left = valueExpr(expression.left, setters, locals);
      const right = valueExpr(expression.right, setters, locals);
      if (!left || !right) return undefined;
      return {
        expr: {
          kind: expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken || expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ? "neq" : "eq",
          args: [left.expr, right.expr]
        },
        reads: [...new Set([...left.reads, ...right.reads])]
      };
    }
  }
  return undefined;
}

export function modeledReadExpr(
  expression: ts.Expression,
  setters: Map<string, SetterBinding>,
  locals: Map<string, BoundExpr>
): BoundExpr | undefined {
  const path = propertyAccessPath(expression);
  if (!path || path.length === 0) return undefined;
  const [base, ...segments] = path;
  const local = locals.get(base);
  if (local) {
    if (segments.length === 0) return local;
    if (local.expr.kind !== "read") return undefined;
    return {
      expr: { kind: "read", var: local.expr.var, path: [...(local.expr.path ?? []), ...segments] },
      reads: local.reads
    };
  }
  const setter = setterForName(base, setters);
  const stateVar = setter?.varId;
  if (!stateVar) return undefined;
  if (setter.domain.kind === "tagged" && segments.length > 0 && segments[0] !== setter.domain.tag) {
    return { expr: { kind: "lit", value: firstValue(taggedPathDomain(setter.domain, segments) ?? { kind: "tokens", count: 1 }) }, reads: [] };
  }
  return {
    expr: { kind: "read", var: stateVar, ...(segments.length > 0 ? { path: segments } : {}) },
    reads: [stateVar]
  };
}

export function readBinding(varId: string): BoundExpr {
  return { expr: { kind: "read", var: varId }, reads: [varId] };
}

export function stateVarForName(name: string, setters: Map<string, SetterBinding>): string | undefined {
  return setterForName(name, setters)?.varId;
}

export function setterForName(name: string, setters: Map<string, SetterBinding>): SetterBinding | undefined {
  return setters.get(name) ?? [...setters.values()].find((setter) => setter.stateName === name);
}

export function taggedPathDomain(domain: Extract<AbstractDomain, { kind: "tagged" }>, path: readonly string[]): AbstractDomain | undefined {
  const [field, ...rest] = path;
  if (!field) return domain;
  const variants = Object.values(domain.variants).filter((variant): variant is Extract<AbstractDomain, { kind: "record" }> => variant.kind === "record");
  const fieldDomains = variants.map((variant) => variant.fields[field]).filter((candidate): candidate is AbstractDomain => Boolean(candidate));
  if (fieldDomains.length === 0) return undefined;
  const first = fieldDomains[0]!;
  if (rest.length === 0) return first;
  return first.kind === "record" ? domainAtRecordPath(first, rest) : undefined;
}

export function domainAtRecordPath(domain: Extract<AbstractDomain, { kind: "record" }>, path: readonly string[]): AbstractDomain | undefined {
  const [field, ...rest] = path;
  if (!field) return domain;
  const next = domain.fields[field];
  if (!next || rest.length === 0) return next;
  return next.kind === "record" ? domainAtRecordPath(next, rest) : undefined;
}

export function andGuard(left: ExprIR, right: ExprIR): ExprIR {
  if (isTrueLiteral(left)) return right;
  if (isTrueLiteral(right)) return left;
  return { kind: "and", args: [left, right] };
}

export function isTrueLiteral(expr: ExprIR): boolean {
  return expr.kind === "lit" && expr.value === true;
}

export function isEventAttribute(name: string): boolean {
  return name === "onClick" || name === "onSubmit" || name === "onChange" || name === "onInput";
}

export function propertyAccessPath(node: ts.Expression): string[] | undefined {
  if (ts.isIdentifier(node)) return [node.text];
  if (isPropertyAccessLike(node)) {
    const base = propertyAccessPath(node.expression);
    return base ? [...base, node.name.text] : undefined;
  }
  return undefined;
}
