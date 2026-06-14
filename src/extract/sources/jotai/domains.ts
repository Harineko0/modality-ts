import * as ts from "typescript";
import {
  firstValue,
  inferDomainFromTypeNode,
  typeAliasDeclarations,
} from "modality-ts/extract/engine/spi";
import {
  validateValue,
  type AbstractDomain,
  type Value,
} from "modality-ts/core";

export { typeAliasDeclarations };

export function inferAtomDomain(
  call: ts.CallExpression,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
): AbstractDomain {
  const typeArg = call.typeArguments?.[0];
  if (typeArg) return inferDomainFromTypeNode(typeArg, typeAliases);
  const initial = call.arguments[0];
  if (!initial) return { kind: "tokens", count: 1 };
  if (
    initial.kind === ts.SyntaxKind.TrueKeyword ||
    initial.kind === ts.SyntaxKind.FalseKeyword
  )
    return { kind: "bool" };
  if (ts.isStringLiteral(initial))
    return { kind: "enum", values: [initial.text] };
  if (ts.isNumericLiteral(initial))
    return {
      kind: "boundedInt",
      min: Number(initial.text),
      max: Number(initial.text),
    };
  if (initial.kind === ts.SyntaxKind.NullKeyword)
    return { kind: "option", inner: { kind: "tokens", count: 1 } };
  if (ts.isArrayLiteralExpression(initial)) return { kind: "lengthCat" };
  if (ts.isObjectLiteralExpression(initial))
    return domainFromObjectLiteral(initial);
  return { kind: "tokens", count: 1 };
}

export function initialValueForAtom(
  call: ts.CallExpression,
  domain: AbstractDomain,
): Value {
  const initial = call.arguments[0];
  if (!initial) return firstValue(domain);
  if (initial.kind === ts.SyntaxKind.TrueKeyword)
    return validInitialOrFirst(domain, true);
  if (initial.kind === ts.SyntaxKind.FalseKeyword)
    return validInitialOrFirst(domain, false);
  if (ts.isStringLiteral(initial))
    return validInitialOrFirst(domain, initial.text);
  if (ts.isNumericLiteral(initial))
    return validInitialOrFirst(domain, Number(initial.text));
  if (initial.kind === ts.SyntaxKind.NullKeyword)
    return validInitialOrFirst(domain, null);
  if (ts.isArrayLiteralExpression(initial))
    return validInitialOrFirst(
      domain,
      initial.elements.length === 0
        ? "0"
        : initial.elements.length === 1
          ? "1"
          : "many",
    );
  if (ts.isObjectLiteralExpression(initial))
    return valueFromObjectLiteral(initial, domain);
  return firstValue(domain);
}

function validInitialOrFirst(domain: AbstractDomain, value: Value): Value {
  return validateValue(domain, value) ? value : firstValue(domain);
}

function domainFromObjectLiteral(
  node: ts.ObjectLiteralExpression,
): AbstractDomain {
  const fields: Record<string, AbstractDomain> = {};
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    fields[prop.name.text] = domainFromExpression(prop.initializer);
  }
  return { kind: "record", fields };
}

function domainFromExpression(expr: ts.Expression): AbstractDomain {
  if (
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword
  )
    return { kind: "bool" };
  if (ts.isStringLiteral(expr)) return { kind: "enum", values: [expr.text] };
  if (ts.isNumericLiteral(expr))
    return {
      kind: "boundedInt",
      min: Number(expr.text),
      max: Number(expr.text),
    };
  if (expr.kind === ts.SyntaxKind.NullKeyword)
    return { kind: "option", inner: { kind: "tokens", count: 1 } };
  if (ts.isArrayLiteralExpression(expr)) return { kind: "lengthCat" };
  if (ts.isObjectLiteralExpression(expr)) return domainFromObjectLiteral(expr);
  return { kind: "tokens", count: 1 };
}

function valueFromObjectLiteral(
  node: ts.ObjectLiteralExpression,
  domain: AbstractDomain,
): Value {
  const values: Record<string, Value> = {};
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    values[prop.name.text] = valueFromExpression(prop.initializer);
  }
  if (domain.kind === "tagged" && !(domain.tag in values)) {
    const tag = Object.keys(domain.variants)[0] ?? "unknown";
    return { ...values, [domain.tag]: tag };
  }
  return values;
}

function valueFromExpression(expr: ts.Expression): Value {
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteral(expr)) return expr.text;
  if (ts.isNumericLiteral(expr)) return Number(expr.text);
  if (expr.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(expr))
    return expr.elements.length === 0
      ? "0"
      : expr.elements.length === 1
        ? "1"
        : "many";
  if (ts.isObjectLiteralExpression(expr))
    return valueFromObjectLiteral(expr, domainFromObjectLiteral(expr));
  return "tok1";
}
