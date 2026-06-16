import * as ts from "typescript";
import type { AbstractDomain, Value } from "modality-ts/core";
import type {
  SemanticTypeContext,
  DomainRefinementProvider,
} from "modality-ts/extract/engine/spi";
import {
  firstValue,
  typeAliasDeclarations,
} from "modality-ts/extract/engine/spi";
import {
  inferDomainFromExpressionSemanticDetailed,
  inferDomainFromTypeNodeSemanticDetailed,
} from "../../engine/ts/type-domains.js";
import {
  inferDomainFromTypeNodeDetailed,
  type DomainInferenceResult,
} from "../../engine/ts/domains.js";
import { literalValue, propertyName } from "../../engine/ts/ast.js";
import { validateValue } from "modality-ts/core";

export { typeAliasDeclarations };

export interface FieldDomainResult extends DomainInferenceResult {
  initial: Value;
}

export function inferFieldDomain(
  initializer: ts.Expression | undefined,
  typeNode?: ts.TypeNode,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  varId?: string,
  sourceFile?: ts.SourceFile,
  types?: SemanticTypeContext,
  domainRefinements?: readonly DomainRefinementProvider[],
): FieldDomainResult {
  const unwrappedInitializer = unwrapExpression(initializer);
  const semanticSource = types?.sourceFile ?? sourceFile;
  if (typeNode && types?.checker) {
    const inferred = inferDomainFromTypeNodeSemanticDetailed(
      typeNode,
      {
        checker: types.checker,
        sourceFile: semanticSource,
        typeAliases,
        varId,
        initializer: unwrappedInitializer,
        domainRefinements,
      },
      new Set(),
      {
        initializer: unwrappedInitializer,
        sourceFile: semanticSource,
        varId,
        domainRefinements,
      },
    );
    const initial = unwrappedInitializer
      ? valueFromExpression(unwrappedInitializer, inferred.domain)
      : firstValue(inferred.domain);
    return { ...inferred, initial };
  }
  if (typeNode) {
    const inferred = inferDomainFromTypeNodeDetailed(
      typeNode,
      typeAliases,
      new Set(),
      {
        initializer: unwrappedInitializer,
        sourceFile,
        varId,
        domainRefinements,
      },
    );
    const initial = unwrappedInitializer
      ? valueFromExpression(unwrappedInitializer, inferred.domain)
      : firstValue(inferred.domain);
    return { ...inferred, initial };
  }
  if (unwrappedInitializer) {
    if (types?.checker && semanticSource) {
      const inferred = inferDomainFromExpressionSemanticDetailed(
        unwrappedInitializer,
        {
          checker: types.checker,
          sourceFile: semanticSource,
          typeAliases,
          varId,
          initializer: unwrappedInitializer,
          domainRefinements,
        },
        typeAliases,
        typeNode,
      );
      return {
        ...inferred,
        initial: valueFromExpression(unwrappedInitializer, inferred.domain),
      };
    }
    const domain = domainFromExpression(unwrappedInitializer, typeAliases);
    return {
      domain,
      initial: valueFromExpression(unwrappedInitializer, domain),
      caveats: [],
    };
  }
  const domain: AbstractDomain = { kind: "tokens", count: 1 };
  return { domain, initial: firstValue(domain), caveats: [] };
}

function unwrapExpression(
  expression: ts.Expression | undefined,
): ts.Expression | undefined {
  if (!expression) return undefined;
  if (
    ts.isAsExpression(expression) ||
    ts.isTypeAssertionExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function domainFromExpression(
  expr: ts.Expression,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  typeArg?: ts.TypeNode,
): AbstractDomain {
  if (typeArg) {
    return inferDomainFromTypeNodeDetailed(typeArg, typeAliases).domain;
  }
  if (
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return { kind: "bool" };
  }
  if (ts.isStringLiteral(expr)) return { kind: "enum", values: [expr.text] };
  if (ts.isNumericLiteral(expr)) {
    return {
      kind: "boundedInt",
      min: Number(expr.text),
      max: Number(expr.text),
    };
  }
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return { kind: "option", inner: { kind: "tokens", count: 1 } };
  }
  if (ts.isArrayLiteralExpression(expr)) return { kind: "lengthCat" };
  if (ts.isObjectLiteralExpression(expr)) {
    return domainFromObjectLiteral(expr, typeAliases);
  }
  return { kind: "tokens", count: 1 };
}

function domainFromObjectLiteral(
  node: ts.ObjectLiteralExpression,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AbstractDomain {
  const fields: Record<string, AbstractDomain> = {};
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyName(prop.name);
    if (!name) continue;
    fields[name] = domainFromExpression(prop.initializer, typeAliases);
  }
  return { kind: "record", fields };
}

function valueFromExpression(
  expr: ts.Expression,
  domain: AbstractDomain,
): Value {
  if (expr.kind === ts.SyntaxKind.TrueKeyword) {
    return validInitialOrFirst(domain, true);
  }
  if (expr.kind === ts.SyntaxKind.FalseKeyword) {
    return validInitialOrFirst(domain, false);
  }
  if (ts.isStringLiteral(expr)) {
    return validInitialOrFirst(domain, expr.text);
  }
  if (ts.isNumericLiteral(expr)) {
    return validInitialOrFirst(domain, Number(expr.text));
  }
  if (expr.kind === ts.SyntaxKind.NullKeyword) {
    return validInitialOrFirst(domain, null);
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return validInitialOrFirst(
      domain,
      expr.elements.length === 0
        ? "0"
        : expr.elements.length === 1
          ? "1"
          : "many",
    );
  }
  if (ts.isObjectLiteralExpression(expr)) {
    return valueFromObjectLiteral(expr, domain);
  }
  const lit = literalValue(expr);
  if (lit !== undefined) return validInitialOrFirst(domain, lit as Value);
  return firstValue(domain);
}

function validInitialOrFirst(domain: AbstractDomain, value: Value): Value {
  return validateValue(domain, value) ? value : firstValue(domain);
}

function valueFromObjectLiteral(
  node: ts.ObjectLiteralExpression,
  domain: AbstractDomain,
): Value {
  const values: Record<string, Value> = {};
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const name = propertyName(prop.name);
    if (!name) continue;
    const fieldDomain =
      domain.kind === "record" ? domain.fields[name] : undefined;
    values[name] = valueFromExpression(
      prop.initializer,
      fieldDomain ?? { kind: "tokens", count: 1 },
    );
  }
  return values;
}

export function isActionFunction(
  expr: ts.Expression,
): expr is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(expr) || ts.isFunctionExpression(expr);
}

export function returnObjectLiteral(
  fn: ts.ArrowFunction | ts.FunctionExpression,
): ts.ObjectLiteralExpression | undefined {
  if (!ts.isBlock(fn.body)) {
    if (ts.isObjectLiteralExpression(fn.body)) return fn.body;
    if (ts.isParenthesizedExpression(fn.body)) {
      const inner = fn.body.expression;
      if (ts.isObjectLiteralExpression(inner)) return inner;
    }
    return undefined;
  }
  for (const stmt of fn.body.statements) {
    if (
      ts.isReturnStatement(stmt) &&
      stmt.expression &&
      ts.isObjectLiteralExpression(stmt.expression)
    ) {
      return stmt.expression;
    }
  }
  return undefined;
}

export function propertyNameFromMember(
  name: ts.PropertyName,
): string | undefined {
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteral(name)) return name.text;
  if (ts.isNumericLiteral(name)) return name.text;
  return undefined;
}
