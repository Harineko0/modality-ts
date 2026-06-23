import type { AbstractDomain } from "modality-ts/core";
import { createTypePlugin } from "modality-ts/extract/plugins";
import * as ts from "typescript";
import type {
  TypePlugin,
  TypeRefinementContext,
  TypeRefinementResolution,
} from "../../../engine/spi/type-plugin.js";
import { unprovableNumericDomainCaveat } from "../../../engine/ts/caveats.js";
import { sourceAnchorFromNode } from "../../../engine/ts/domain-refinements.js";
import {
  sourceFileFromRefinementContext,
  tsExpressionFromRefinementContext,
  tsTypeNodeFromRefinementContext,
} from "../../../engine/ts/type-refinement-bridge.js";

export function zodTypePlugin(): TypePlugin {
  return createTypePlugin({
    id: "zod",
    version: "0.1.0",
    packageNames: ["zod"],
    refineDomain: resolveZodSchema,
  });
}

function resolveZodSchema(
  ctx: TypeRefinementContext,
): TypeRefinementResolution | undefined {
  const inferredExpression = schemaExpressionFromZodInfer(ctx);
  const expression = inferredExpression ?? expressionFromContext(ctx);
  if (!expression || !ts.isExpression(expression)) return undefined;
  const schemaDomain = domainFromZodSchemaExpression(
    expression,
    inferredExpression !== undefined,
  );
  if (schemaDomain) return { domain: schemaDomain, caveats: [] };

  const parsed = parseZodNumberChain(expression);
  if (!parsed) return undefined;
  if (parsed.dynamic) {
    return {
      caveats: [
        unprovableNumericDomainCaveat(
          ctx.varId ?? "numeric",
          "Zod numeric schema uses dynamic bounds",
          sourceAnchorFromNode(
            expression,
            sourceFileFromRefinementContext(ctx),
          ),
        ),
      ],
    };
  }
  const domain = domainFromZodNumberParse(parsed);
  if (domain) return { domain, caveats: [] };
  return {
    caveats: [
      unprovableNumericDomainCaveat(
        ctx.varId ?? "numeric",
        "Unsupported or unprovable Zod numeric schema",
        sourceAnchorFromNode(expression, sourceFileFromRefinementContext(ctx)),
      ),
    ],
  };
}

function domainFromZodSchemaExpression(
  expression: ts.Expression,
  allowUninformativeTokens: boolean,
): AbstractDomain | undefined {
  const chain = flattenCallChain(expression);
  if (chain.length === 0) return undefined;
  const root = chain[0];
  if (!root) return undefined;
  let domain: AbstractDomain | undefined;
  if (root.name === "string" && root.args.length === 0) {
    domain = allowUninformativeTokens
      ? { kind: "tokens", count: 1 }
      : undefined;
  } else if (root.name === "boolean" && root.args.length === 0) {
    domain = { kind: "bool" };
  } else if (root.name === "enum" && root.args.length === 1) {
    domain = domainFromZodEnum(root.args[0]);
  } else if (root.name === "object" && root.args.length === 1) {
    domain = domainFromZodObject(root.args[0]);
  }
  if (!domain) return undefined;
  for (const step of chain.slice(1)) {
    if (step.name === "optional" || step.name === "nullable") {
      domain = { kind: "option", inner: domain };
    }
  }
  return domain;
}

function domainFromZodEnum(
  expression: ts.Expression | undefined,
): AbstractDomain | undefined {
  if (!expression || !ts.isArrayLiteralExpression(expression)) return undefined;
  const values: string[] = [];
  for (const element of expression.elements) {
    if (!ts.isStringLiteral(element)) return undefined;
    values.push(element.text);
  }
  if (values.length === 0) return undefined;
  return { kind: "enum", values: [...new Set(values)].sort() };
}

function domainFromZodObject(
  expression: ts.Expression | undefined,
): AbstractDomain | undefined {
  if (!expression || !ts.isObjectLiteralExpression(expression))
    return undefined;
  const fields: Record<string, AbstractDomain> = {};
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const name = propertyName(property.name);
    if (!name) return undefined;
    const domain = domainFromZodSchemaExpression(property.initializer, true);
    if (!domain) return undefined;
    fields[name] = domain;
  }
  return { kind: "record", fields };
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

interface NumericBound {
  value: number;
  inclusive: boolean;
}

interface ZodNumberParse {
  integral: boolean;
  lower?: NumericBound;
  upper?: NumericBound;
  multipleOf?: number;
  dynamic: boolean;
}

function domainFromZodNumberParse(
  parsed: ZodNumberParse | null,
): AbstractDomain | undefined {
  if (!parsed) return undefined;
  if (!parsed.integral || !parsed.lower || !parsed.upper) return undefined;

  const min = normalizeLowerBound(parsed.lower);
  const max = normalizeUpperBound(parsed.upper);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    return undefined;
  }

  if (parsed.multipleOf !== undefined) {
    if (!isValidPositiveIntegerDivisor(parsed.multipleOf)) return undefined;
    const values = enumerateDivisibleIntegers(min, max, parsed.multipleOf);
    if (values.length === 0) return undefined;
    if (isContiguousIntegers(values)) {
      const minValue = values.at(0);
      const maxValue = values.at(-1);
      if (minValue === undefined || maxValue === undefined) return undefined;
      return {
        kind: "boundedInt",
        min: minValue,
        max: maxValue,
        overflow: "forbid",
      };
    }
    return { kind: "intSet", values, overflow: "forbid" };
  }

  return { kind: "boundedInt", min, max, overflow: "forbid" };
}

function expressionFromContext(
  ctx: TypeRefinementContext,
): ts.Expression | undefined {
  return tsExpressionFromRefinementContext(ctx, ctx.initializer);
}

function schemaExpressionFromZodInfer(
  ctx: TypeRefinementContext,
): ts.Expression | undefined {
  const typeNode = tsTypeNodeFromRefinementContext(ctx);
  if (
    !typeNode ||
    !ts.isTypeReferenceNode(typeNode) ||
    typeNode.typeArguments?.length !== 1
  ) {
    return undefined;
  }
  const typeName = typeNode.typeName;
  if (
    !ts.isQualifiedName(typeName) ||
    !ts.isIdentifier(typeName.left) ||
    typeName.left.text !== "z" ||
    typeName.right.text !== "infer"
  ) {
    return undefined;
  }
  const query = typeNode.typeArguments[0];
  if (
    !query ||
    !ts.isTypeQueryNode(query) ||
    !ts.isIdentifier(query.exprName)
  ) {
    return undefined;
  }
  return resolveConstInitializer(
    query.exprName.text,
    sourceFileFromRefinementContext(ctx),
  );
}

function resolveConstInitializer(
  name: string,
  sourceFile?: ts.SourceFile,
): ts.Expression | undefined {
  if (!sourceFile) return undefined;
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text === name &&
        declaration.initializer
      ) {
        return declaration.initializer;
      }
    }
  }
  return undefined;
}

// Integer normalization: inclusive lower uses ceil, exclusive lower uses floor+1;
// inclusive upper uses floor, exclusive upper uses ceil-1.
function normalizeLowerBound(bound: NumericBound): number {
  if (bound.inclusive) {
    return Number.isInteger(bound.value) ? bound.value : Math.ceil(bound.value);
  }
  return Number.isInteger(bound.value)
    ? bound.value + 1
    : Math.floor(bound.value) + 1;
}

function normalizeUpperBound(bound: NumericBound): number {
  if (bound.inclusive) {
    return Number.isInteger(bound.value)
      ? bound.value
      : Math.floor(bound.value);
  }
  return Number.isInteger(bound.value)
    ? bound.value - 1
    : Math.ceil(bound.value) - 1;
}

function isValidPositiveIntegerDivisor(value: number): boolean {
  return Number.isInteger(value) && value > 0 && Number.isFinite(value);
}

// Divisibility follows JavaScript remainder semantics: value % k === 0.
function enumerateDivisibleIntegers(
  min: number,
  max: number,
  divisor: number,
): number[] {
  const values: number[] = [];
  for (let value = min; value <= max; value++) {
    if (value % divisor === 0) values.push(value);
  }
  return values;
}

function isContiguousIntegers(values: readonly number[]): boolean {
  if (values.length <= 1) return true;
  for (let index = 1; index < values.length; index++) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous === undefined || current === undefined) return false;
    if (current !== previous + 1) return false;
  }
  return true;
}

function parseZodNumberChain(expression: ts.Expression): ZodNumberParse | null {
  const chain = flattenCallChain(expression);
  if (chain.length === 0) return null;
  const root = chain[0];
  if (root?.name !== "number" || root.args.length > 0) return null;
  const result: ZodNumberParse = { integral: false, dynamic: false };
  for (const step of chain.slice(1)) {
    if (step.name === "int") {
      result.integral = true;
      continue;
    }
    if (step.name === "min" || step.name === "gte") {
      const bound = staticNumericArg(step.args[0]);
      if (bound === undefined) {
        result.dynamic = true;
        continue;
      }
      applyLowerBound(result, bound, true);
      continue;
    }
    if (step.name === "max" || step.name === "lte") {
      const bound = staticNumericArg(step.args[0]);
      if (bound === undefined) {
        result.dynamic = true;
        continue;
      }
      applyUpperBound(result, bound, true);
      continue;
    }
    if (step.name === "gt") {
      const bound = staticNumericArg(step.args[0]);
      if (bound === undefined) {
        result.dynamic = true;
        continue;
      }
      applyLowerBound(result, bound, false);
      continue;
    }
    if (step.name === "lt") {
      const bound = staticNumericArg(step.args[0]);
      if (bound === undefined) {
        result.dynamic = true;
        continue;
      }
      applyUpperBound(result, bound, false);
      continue;
    }
    if (step.name === "positive") {
      applyLowerBound(result, 0, false);
      continue;
    }
    if (step.name === "nonnegative") {
      applyLowerBound(result, 0, true);
      continue;
    }
    if (step.name === "negative") {
      applyUpperBound(result, 0, false);
      continue;
    }
    if (step.name === "nonpositive") {
      applyUpperBound(result, 0, true);
      continue;
    }
    if (step.name === "multipleOf" || step.name === "step") {
      const divisor = staticNumericArg(step.args[0]);
      if (divisor === undefined) {
        result.dynamic = true;
        continue;
      }
      result.multipleOf = divisor;
      continue;
    }
    return null;
  }
  return result;
}

function applyLowerBound(
  parsed: ZodNumberParse,
  value: number,
  inclusive: boolean,
): void {
  const candidate: NumericBound = { value, inclusive };
  if (!parsed.lower || isStricterLowerBound(candidate, parsed.lower)) {
    parsed.lower = candidate;
  }
}

function applyUpperBound(
  parsed: ZodNumberParse,
  value: number,
  inclusive: boolean,
): void {
  const candidate: NumericBound = { value, inclusive };
  if (!parsed.upper || isStricterUpperBound(candidate, parsed.upper)) {
    parsed.upper = candidate;
  }
}

function isStricterLowerBound(
  candidate: NumericBound,
  current: NumericBound,
): boolean {
  if (candidate.value > current.value) return true;
  if (candidate.value < current.value) return false;
  return !candidate.inclusive && current.inclusive;
}

function isStricterUpperBound(
  candidate: NumericBound,
  current: NumericBound,
): boolean {
  if (candidate.value < current.value) return true;
  if (candidate.value > current.value) return false;
  return !candidate.inclusive && current.inclusive;
}

interface ChainStep {
  name: string;
  args: ts.Expression[];
}

function flattenCallChain(expression: ts.Expression): ChainStep[] {
  const steps: ChainStep[] = [];
  let current: ts.Expression = expression;
  while (ts.isCallExpression(current)) {
    const callee = current.expression;
    if (ts.isPropertyAccessExpression(callee)) {
      steps.unshift({
        name: callee.name.text,
        args: [...current.arguments],
      });
      current = callee.expression;
      continue;
    }
    if (ts.isIdentifier(callee)) {
      steps.unshift({ name: callee.text, args: [...current.arguments] });
      break;
    }
    break;
  }
  if (
    steps.length === 0 &&
    ts.isPropertyAccessExpression(current) &&
    current.name.text === "number"
  ) {
    steps.unshift({ name: "number", args: [] });
  }
  return steps;
}

function staticNumericArg(
  expression: ts.Expression | undefined,
): number | undefined {
  if (!expression) return undefined;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expression.operand)
  ) {
    return -Number(expression.operand.text);
  }
  return undefined;
}
