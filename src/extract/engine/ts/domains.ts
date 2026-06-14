import * as ts from "typescript";
import {
  validateValue,
  type AbstractDomain,
  type Value,
} from "modality-ts/core";

export function inferDomainFromTypeNode(
  node: ts.TypeNode | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
): AbstractDomain {
  if (!node) return { kind: "tokens", count: 1 };
  switch (node.kind) {
    case ts.SyntaxKind.BooleanKeyword:
      return { kind: "bool" };
    case ts.SyntaxKind.StringKeyword:
    case ts.SyntaxKind.NumberKeyword:
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return { kind: "tokens", count: 1 };
    case ts.SyntaxKind.LiteralType:
      return domainFromLiteralType(node as ts.LiteralTypeNode);
    case ts.SyntaxKind.UnionType:
      return domainFromUnion(node as ts.UnionTypeNode, typeAliases);
    case ts.SyntaxKind.TypeLiteral:
      return domainFromTypeLiteral(node as ts.TypeLiteralNode);
    case ts.SyntaxKind.ArrayType:
      return { kind: "lengthCat" };
    case ts.SyntaxKind.TypeReference:
      return domainFromTypeReference(node as ts.TypeReferenceNode, typeAliases);
    default:
      return { kind: "tokens", count: 1 };
  }
}

export function inferUseStateDomain(
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
  if (ts.isStringLiteral(initial) || ts.isNumericLiteral(initial))
    return { kind: "enum", values: [initial.text] };
  if (initial.kind === ts.SyntaxKind.NullKeyword)
    return { kind: "option", inner: { kind: "tokens", count: 1 } };
  if (ts.isArrayLiteralExpression(initial)) return { kind: "lengthCat" };
  return { kind: "tokens", count: 1 };
}

export function initialValueForUseState(
  call: ts.CallExpression,
  domain: AbstractDomain,
): Value {
  const initial = call.arguments[0];
  if (!initial) return firstValue(domain);
  const parsed = initialValueFromExpression(initial, domain);
  if (parsed !== undefined) return parsed;
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
  return firstValue(domain);
}

export function firstValue(domain: AbstractDomain): Value {
  switch (domain.kind) {
    case "bool":
      return false;
    case "enum":
      return domain.values[0] ?? "";
    case "boundedInt":
      return domain.min;
    case "option":
      return null;
    case "record":
      return Object.fromEntries(
        Object.entries(domain.fields).map(([key, field]) => [
          key,
          firstValue(field),
        ]),
      );
    case "tagged": {
      const [tagValue, variant] = Object.entries(domain.variants)[0] ?? [
        "unknown",
        { kind: "record", fields: {} } as const,
      ];
      return { ...(firstValue(variant) as object), [domain.tag]: tagValue };
    }
    case "tokens":
      return domain.names?.[0] ?? "tok1";
    case "lengthCat":
      return "0";
    case "boundedList":
      return [];
  }
}

export function typeAliasDeclarations(
  source: ts.SourceFile,
): Map<string, ts.TypeNode> {
  const aliases = new Map<string, ts.TypeNode>();
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && ts.isIdentifier(node.name))
      aliases.set(node.name.text, node.type);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return aliases;
}

function initialValueFromExpression(
  expression: ts.Expression,
  domain: AbstractDomain,
): Value | undefined {
  const literal = literalValue(expression);
  if (literal !== undefined)
    return validateValue(domain, literal) ? literal : undefined;
  if (domain.kind === "option")
    return initialValueFromExpression(expression, domain.inner);
  if (domain.kind === "record" && ts.isObjectLiteralExpression(expression)) {
    const fields: Record<string, Value> = {};
    for (const [field, fieldDomain] of Object.entries(domain.fields)) {
      const property = expression.properties.find(
        (candidate): candidate is ts.PropertyAssignment =>
          ts.isPropertyAssignment(candidate) &&
          propertyName(candidate.name) === field,
      );
      fields[field] = property
        ? (initialValueFromExpression(property.initializer, fieldDomain) ??
          firstValue(fieldDomain))
        : firstValue(fieldDomain);
    }
    return fields;
  }
  return undefined;
}

function validInitialOrFirst(domain: AbstractDomain, value: Value): Value {
  return validateValue(domain, value) ? value : firstValue(domain);
}

function domainFromLiteralType(node: ts.LiteralTypeNode): AbstractDomain {
  const lit = node.literal;
  if (
    lit.kind === ts.SyntaxKind.TrueKeyword ||
    lit.kind === ts.SyntaxKind.FalseKeyword
  )
    return { kind: "bool" };
  if (ts.isStringLiteral(lit)) return { kind: "enum", values: [lit.text] };
  if (ts.isNumericLiteral(lit))
    return { kind: "boundedInt", min: Number(lit.text), max: Number(lit.text) };
  if (lit.kind === ts.SyntaxKind.NullKeyword)
    return { kind: "option", inner: { kind: "tokens", count: 1 } };
  return { kind: "tokens", count: 1 };
}

function domainFromUnion(
  node: ts.UnionTypeNode,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
): AbstractDomain {
  const nonNull = node.types.filter(
    (part) =>
      part.kind !== ts.SyntaxKind.UndefinedKeyword &&
      !(
        ts.isLiteralTypeNode(part) &&
        part.literal.kind === ts.SyntaxKind.NullKeyword
      ),
  );
  if (nonNull.length !== node.types.length && nonNull.length > 0) {
    return {
      kind: "option",
      inner:
        nonNull.length === 1
          ? inferDomainFromTypeNode(nonNull[0], typeAliases)
          : domainFromUnionMembers(nonNull),
    };
  }
  return domainFromUnionMembers(node.types);
}

function domainFromUnionMembers(types: readonly ts.TypeNode[]): AbstractDomain {
  const literalValues: string[] = [];
  const numericValues: number[] = [];
  for (const part of types) {
    if (!ts.isLiteralTypeNode(part))
      return taggedUnionFromMembers(types) ?? { kind: "tokens", count: 1 };
    const lit = part.literal;
    if (ts.isStringLiteral(lit)) literalValues.push(lit.text);
    else if (ts.isNumericLiteral(lit)) numericValues.push(Number(lit.text));
    else return taggedUnionFromMembers(types) ?? { kind: "tokens", count: 1 };
  }
  if (numericValues.length === types.length) {
    return {
      kind: "boundedInt",
      min: Math.min(...numericValues),
      max: Math.max(...numericValues),
    };
  }
  return { kind: "enum", values: literalValues };
}

function taggedUnionFromMembers(
  types: readonly ts.TypeNode[],
): AbstractDomain | undefined {
  const members = types.filter(ts.isTypeLiteralNode);
  if (members.length !== types.length) return undefined;
  const tagCandidates = new Map<string, Set<string>>();
  for (const member of members) {
    for (const prop of member.members.filter(ts.isPropertySignature)) {
      if (
        !prop.type ||
        !ts.isIdentifier(prop.name) ||
        !ts.isLiteralTypeNode(prop.type) ||
        !ts.isStringLiteral(prop.type.literal)
      )
        continue;
      const set = tagCandidates.get(prop.name.text) ?? new Set<string>();
      set.add(prop.type.literal.text);
      tagCandidates.set(prop.name.text, set);
    }
  }
  const tag = [...tagCandidates].find(
    ([, values]) => values.size === members.length,
  )?.[0];
  if (!tag) return undefined;
  const variants: Record<string, AbstractDomain> = {};
  for (const member of members) {
    const tagProp = member.members.find(
      (prop): prop is ts.PropertySignature =>
        ts.isPropertySignature(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === tag,
    );
    if (
      !tagProp?.type ||
      !ts.isLiteralTypeNode(tagProp.type) ||
      !ts.isStringLiteral(tagProp.type.literal)
    )
      return undefined;
    variants[tagProp.type.literal.text] = domainFromTypeLiteral(member, tag);
  }
  return { kind: "tagged", tag, variants };
}

function domainFromTypeLiteral(
  node: ts.TypeLiteralNode,
  omitField?: string,
): AbstractDomain {
  const fields: Record<string, AbstractDomain> = {};
  for (const member of node.members) {
    if (
      !ts.isPropertySignature(member) ||
      !member.type ||
      !ts.isIdentifier(member.name) ||
      member.name.text === omitField
    )
      continue;
    fields[member.name.text] = inferDomainFromTypeNode(member.type);
  }
  return { kind: "record", fields };
}

function domainFromTypeReference(
  node: ts.TypeReferenceNode,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
): AbstractDomain {
  const name = node.typeName.getText();
  const alias = typeAliases.get(name);
  if (alias) return inferDomainFromTypeNode(alias, typeAliases);
  if (
    (name === "Array" || name === "ReadonlyArray") &&
    node.typeArguments?.length === 1
  )
    return { kind: "lengthCat" };
  if (name === "Record") return { kind: "tokens", count: 1 };
  return { kind: "tokens", count: 1 };
}

function literalValue(expression: ts.Expression): Value | undefined {
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (expression.kind === ts.SyntaxKind.NullKeyword) return null;
  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  )
    return expression.text;
  if (ts.isNumericLiteral(expression)) return Number(expression.text);
  return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  )
    return name.text;
  return undefined;
}
