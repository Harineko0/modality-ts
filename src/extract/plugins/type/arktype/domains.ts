import type { AbstractDomain } from "modality-ts/core";
import { createTypePlugin } from "modality-ts/extract/plugins";
import * as ts from "typescript";
import type {
  TypePlugin,
  TypeRefinementContext,
  TypeRefinementResolution,
} from "../../../engine/spi/type-plugin.js";
import {
  modelSlackCaveat,
  unprovableNumericDomainCaveat,
} from "../../../engine/ts/caveats.js";
import { sourceAnchorFromNode } from "../../../engine/ts/domain-refinements.js";
import {
  sourceFileFromRefinementContext,
  tsExpressionFromRefinementContext,
  tsTypeNodeFromRefinementContext,
} from "../../../engine/ts/type-refinement-bridge.js";

const ARKTYPE_INTEGER_RANGE = /^(-?\d+)\s*<=\s*number\.integer\s*<=\s*(-?\d+)$/;
const ARKTYPE_BOUNDED_DIVISOR =
  /^(-?\d+)\s*(<=|<)\s*\(\s*number\.integer\s*%\s*(\d+)\s*\)\s*(<=|<)\s*(-?\d+)$/;
const ARKTYPE_STRING_LENGTH =
  /^(?:(-?\d+)\s*(<|<=)\s*)?string(?:\.\w+)?\s*(>|>=|<|<=)\s*(-?\d+)(?:\s*(<|<=)\s*string(?:\.\w+)?)?$/;
const ARKTYPE_ARRAY_LENGTH =
  /^(?:(-?\d+)\s*(<|<=)\s*)?[\w.]+\[\]\s*(>|>=|<|<=)\s*(-?\d+)(?:\s*(<|<=)\s*[\w.]+\[\])?$/;
const ARKTYPE_UNBOUNDED_DIVISOR = /^number(?:\.integer)?\s*%\s*(\d+)$/;

type ArktypeParseResult =
  | { kind: "domain"; domain: AbstractDomain }
  | { kind: "caveat"; reason: string; numeric?: boolean }
  | { kind: "abstain" };

export function arktypeTypePlugin(): TypePlugin {
  return createTypePlugin({
    id: "arktype",
    version: "0.1.0",
    packageNames: ["arktype"],
    refineDomain: resolveArktypeSchema,
  });
}

function resolveArktypeSchema(
  ctx: TypeRefinementContext,
): TypeRefinementResolution | undefined {
  const expression =
    schemaExpressionFromArktypeInfer(ctx) ??
    tsExpressionFromRefinementContext(ctx, ctx.initializer);
  if (!expression) return undefined;
  const objectSchema = arktypeObjectExpression(expression);
  if (objectSchema) {
    const domain = domainFromArktypeObject(objectSchema);
    if (domain) return { domain, caveats: [] };
  }
  const schema = staticStringValue(expression);
  if (!schema) return undefined;
  const parsed = parseArktypeSchema(schema);
  const source = sourceAnchorFromNode(
    expression,
    sourceFileFromRefinementContext(ctx),
  );
  const id = ctx.varId ?? "schema";
  if (parsed.kind === "domain") {
    return { domain: parsed.domain, caveats: [] };
  }
  if (parsed.kind === "caveat") {
    const caveat = parsed.numeric
      ? unprovableNumericDomainCaveat(id, parsed.reason, source)
      : modelSlackCaveat(id, parsed.reason, source);
    return { caveats: [caveat] };
  }
  if (looksLikeArktypeSchema(expression, schema)) {
    return {
      caveats: [
        unprovableNumericDomainCaveat(
          id,
          "Unsupported arktype numeric schema grammar",
          source,
        ),
      ],
    };
  }
  return undefined;
}

function arktypeObjectExpression(
  expression: ts.Expression,
): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(expression)) return expression;
  if (!ts.isCallExpression(expression)) return undefined;
  const callee = expression.expression;
  if (!ts.isIdentifier(callee) || callee.text !== "type") return undefined;
  const argument = expression.arguments[0];
  return argument && ts.isObjectLiteralExpression(argument)
    ? argument
    : undefined;
}

function domainFromArktypeObject(
  expression: ts.ObjectLiteralExpression,
): AbstractDomain | undefined {
  const fields: Record<string, AbstractDomain> = {};
  for (const property of expression.properties) {
    if (!ts.isPropertyAssignment(property)) return undefined;
    const rawName = propertyName(property.name);
    if (!rawName) return undefined;
    const optional = rawName.endsWith("?");
    const name = optional ? rawName.slice(0, -1) : rawName;
    const domain = domainFromArktypeExpression(property.initializer);
    if (!domain) return undefined;
    fields[name] =
      optional && domain.kind !== "option"
        ? { kind: "option", inner: domain }
        : domain;
  }
  return { kind: "record", fields };
}

function domainFromArktypeExpression(
  expression: ts.Expression,
): AbstractDomain | undefined {
  const schema = staticStringValue(expression);
  if (!schema) return undefined;
  const trimmed = schema.trim();
  if (trimmed === "boolean") return { kind: "bool" };
  if (trimmed === "string") return { kind: "tokens", count: 1 };
  const parsed = parseArktypeSchema(trimmed);
  return parsed.kind === "domain" ? parsed.domain : undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return undefined;
}

function parseArktypeSchema(schema: string): ArktypeParseResult {
  const trimmed = schema.trim();
  const literalUnion = parseStringLiteralUnion(trimmed);
  if (literalUnion) {
    return {
      kind: "domain",
      domain: { kind: "enum", values: literalUnion },
    };
  }
  const integerRange = parseBoundedIntegerRange(trimmed);
  if (integerRange) return integerRange;
  const boundedDivisor = parseBoundedDivisorRange(trimmed);
  if (boundedDivisor) return boundedDivisor;
  if (ARKTYPE_STRING_LENGTH.test(trimmed)) {
    return {
      kind: "caveat",
      reason:
        "Unsupported arktype string length schema; use an overlay predicate abstraction for non-empty strings",
    };
  }
  if (ARKTYPE_ARRAY_LENGTH.test(trimmed)) {
    return {
      kind: "caveat",
      reason:
        "Unsupported arktype array length schema; current lengthCat cannot encode non-empty-only constraints",
    };
  }
  if (ARKTYPE_UNBOUNDED_DIVISOR.test(trimmed)) {
    return {
      kind: "caveat",
      reason:
        "Unsupported arktype unbounded divisor schema; finite bounds required",
      numeric: true,
    };
  }
  return { kind: "abstain" };
}

function parseStringLiteralUnion(
  schema: string,
): readonly string[] | undefined {
  const parts = schema.split("|").map((part) => part.trim());
  if (parts.length === 0) return undefined;
  const values: string[] = [];
  for (const part of parts) {
    const literal = parseQuotedStringLiteral(part);
    if (literal === undefined) return undefined;
    values.push(literal);
  }
  return [...new Set(values)].sort();
}

function parseQuotedStringLiteral(token: string): string | undefined {
  const sourceFile = ts.createSourceFile(
    "arktype-literal.ts",
    token,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.statements.length !== 1) return undefined;
  const statement = sourceFile.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) return undefined;
  const { expression } = statement;
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }
  return undefined;
}

function parseBoundedIntegerRange(
  schema: string,
): ArktypeParseResult | undefined {
  const match = ARKTYPE_INTEGER_RANGE.exec(schema);
  if (!match) return undefined;
  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
    return {
      kind: "caveat",
      reason: "Unsupported arktype numeric schema bounds",
      numeric: true,
    };
  }
  return {
    kind: "domain",
    domain: { kind: "boundedInt", min, max, overflow: "forbid" },
  };
}

function parseBoundedDivisorRange(
  schema: string,
): ArktypeParseResult | undefined {
  const match = ARKTYPE_BOUNDED_DIVISOR.exec(schema);
  if (!match) return undefined;
  const leftBound = Number(match[1]);
  const leftOp = match[2] as "<" | "<=";
  const divisor = Number(match[3]);
  const rightOp = match[4] as "<" | "<=";
  const rightBound = Number(match[5]);
  if (
    !Number.isInteger(leftBound) ||
    !Number.isInteger(rightBound) ||
    !Number.isInteger(divisor)
  ) {
    return {
      kind: "caveat",
      reason: "Unsupported arktype numeric schema bounds",
      numeric: true,
    };
  }
  if (divisor === 0) {
    return {
      kind: "caveat",
      reason: "Unsupported arktype divisor schema; modulo by zero",
      numeric: true,
    };
  }
  const min = leftOp === "<" ? leftBound + 1 : leftBound;
  const max = rightOp === "<" ? rightBound - 1 : rightBound;
  if (min > max) {
    return {
      kind: "caveat",
      reason: "Unsupported arktype numeric schema bounds",
      numeric: true,
    };
  }
  const values: number[] = [];
  for (let value = min; value <= max; value++) {
    if (value % divisor === 0) values.push(value);
  }
  if (values.length === 0) {
    return {
      kind: "caveat",
      reason: "Unsupported arktype numeric schema bounds",
      numeric: true,
    };
  }
  if (divisor === 1 && isContiguousIntegers(values)) {
    const minValue = values.at(0);
    const maxValue = values.at(-1);
    if (minValue === undefined || maxValue === undefined) {
      return {
        kind: "caveat",
        reason: "Unsupported arktype numeric schema bounds",
        numeric: true,
      };
    }
    return {
      kind: "domain",
      domain: {
        kind: "boundedInt",
        min: minValue,
        max: maxValue,
        overflow: "forbid",
      },
    };
  }
  return {
    kind: "domain",
    domain: { kind: "intSet", values, overflow: "forbid" },
  };
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

function staticStringValue(expression: ts.Expression): string | undefined {
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  )
    return expression.text;
  if (ts.isCallExpression(expression)) {
    const callee = expression.expression;
    if (
      ts.isIdentifier(callee) &&
      callee.text === "type" &&
      expression.arguments.length === 1
    ) {
      const argument = expression.arguments[0];
      if (argument) return staticStringValue(argument);
    }
  }
  return undefined;
}

function looksLikeArktypeSchema(
  expression: ts.Expression,
  schema?: string,
): boolean {
  if (ts.isCallExpression(expression)) {
    const callee = expression.expression;
    if (ts.isIdentifier(callee) && callee.text === "type") return true;
  }
  const text = schema ?? staticStringValue(expression);
  if (!text) return false;
  return (
    text.includes("number.integer") ||
    text.includes("number %") ||
    text.includes("string") ||
    /^['"]/.test(text.trim()) ||
    text.includes("[]")
  );
}

function schemaExpressionFromArktypeInfer(
  ctx: TypeRefinementContext,
): ts.Expression | undefined {
  const typeNode = tsTypeNodeFromRefinementContext(ctx);
  if (
    !typeNode ||
    !ts.isTypeQueryNode(typeNode) ||
    !ts.isQualifiedName(typeNode.exprName) ||
    typeNode.exprName.right.text !== "infer" ||
    !ts.isIdentifier(typeNode.exprName.left)
  ) {
    return undefined;
  }
  return resolveConstInitializer(
    typeNode.exprName.left.text,
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
