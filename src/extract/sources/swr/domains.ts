import type { AbstractDomain } from "modality-ts/core";
import * as ts from "typescript";

export function inferPayloadDomain(
  typeArg: ts.TypeNode | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
): AbstractDomain {
  if (!typeArg) return { kind: "tokens", count: 1 };
  switch (typeArg.kind) {
    case ts.SyntaxKind.BooleanKeyword:
      return { kind: "bool" };
    case ts.SyntaxKind.LiteralType:
      return domainFromLiteralType(typeArg as ts.LiteralTypeNode);
    case ts.SyntaxKind.UnionType:
      return domainFromUnion(typeArg as ts.UnionTypeNode, typeAliases);
    case ts.SyntaxKind.TypeLiteral:
      return domainFromTypeLiteral(typeArg as ts.TypeLiteralNode, typeAliases);
    case ts.SyntaxKind.ArrayType:
      return { kind: "lengthCat" };
    case ts.SyntaxKind.TypeReference: {
      const name = (typeArg as ts.TypeReferenceNode).typeName.getText();
      const alias = typeAliases.get(name);
      if (alias) return inferPayloadDomain(alias, typeAliases);
      if (name === "Array" || name === "ReadonlyArray")
        return { kind: "lengthCat" };
      return { kind: "tokens", count: 1 };
    }
    default:
      return { kind: "tokens", count: 1 };
  }
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
          ? inferPayloadDomain(nonNull[0], typeAliases)
          : domainFromUnionMembers(nonNull),
    };
  }
  return domainFromUnionMembers(node.types);
}

function domainFromUnionMembers(types: readonly ts.TypeNode[]): AbstractDomain {
  const literalValues: string[] = [];
  const numericValues: number[] = [];
  for (const part of types) {
    if (!ts.isLiteralTypeNode(part)) return { kind: "tokens", count: 1 };
    const lit = part.literal;
    if (ts.isStringLiteral(lit)) literalValues.push(lit.text);
    else if (ts.isNumericLiteral(lit)) numericValues.push(Number(lit.text));
    else return { kind: "tokens", count: 1 };
  }
  if (numericValues.length === types.length)
    return {
      kind: "boundedInt",
      min: Math.min(...numericValues),
      max: Math.max(...numericValues),
    };
  return { kind: "enum", values: literalValues };
}

function domainFromTypeLiteral(
  node: ts.TypeLiteralNode,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AbstractDomain {
  const fields: Record<string, AbstractDomain> = {};
  for (const member of node.members) {
    if (
      !ts.isPropertySignature(member) ||
      !member.type ||
      !ts.isIdentifier(member.name)
    )
      continue;
    fields[member.name.text] = inferPayloadDomain(member.type, typeAliases);
  }
  return { kind: "record", fields };
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
