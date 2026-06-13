import * as ts from "typescript";
import type { StateSourcePlugin, SourceDecl, WriteChannel } from "modality-ts/extraction/spi";
import type { AbstractDomain, SourceAnchor, StateVarDecl, Value } from "modality-ts/kernel";
import * as harness from "./harness.js";

export function useStateSource(): StateSourcePlugin {
  return {
    id: "use-state",
    version: "0.1.0",
    packageNames: ["react"],
    discover: (ctx) => discoverUseState(ctx.sourceText, ctx.fileName, ctx.route),
    writeChannels: (ctx) => discoverUseStateWriteChannels(ctx.sourceText, ctx.fileName),
    harness,
    conformance: {
      testedVersions: "react>=18"
    }
  };
}

export default useStateSource;

export function discoverUseState(sourceText: string, fileName = "App.tsx", route = "/"): SourceDecl[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const typeAliases = typeAliasDeclarations(source);
  const providerComponents = providerComponentNames(source);
  const decls: SourceDecl[] = [];
  const visit = (node: ts.Node, componentName: string | undefined): void => {
    const component = componentNameFor(node) ?? componentName;
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && isUseStateCall(node.initializer)) {
      const stateName = node.name.elements[0];
      const setterName = node.name.elements[1];
      if (ts.isBindingElement(stateName) && ts.isIdentifier(stateName.name)) {
        const componentId = component ?? "Anonymous";
        const domain = inferUseStateDomain(node.initializer, typeAliases);
        const varId = `local:${componentId}.${stateName.name.text}`;
        const origin = { file: fileName, ...lineAndColumn(source, node) };
        const variable: StateVarDecl = {
          id: varId,
          domain,
          origin,
          scope: providerComponents.has(componentId) ? { kind: "global" } : { kind: "route-local", route },
          initial: initialValueForUseState(node.initializer, domain)
        };
        decls.push({
          id: varId,
          kind: "useState",
          var: variable,
          origin,
          metadata: {
            component: componentId,
            stateName: stateName.name.text,
            ...(setterName && ts.isBindingElement(setterName) && ts.isIdentifier(setterName.name) ? { setterName: setterName.name.text } : {})
          }
        });
      }
    }
    ts.forEachChild(node, (child) => visit(child, component));
  };
  visit(source, undefined);
  return decls;
}

export function discoverUseStateWriteChannels(sourceText: string, fileName = "App.tsx"): WriteChannel[] {
  return discoverUseState(sourceText, fileName, "/").flatMap((decl) => {
    const setterName = decl.metadata?.setterName;
    if (typeof setterName !== "string" || !decl.var) return [];
    return [{
      id: `${decl.id}.setter`,
      varId: decl.var.id,
      symbolName: setterName,
      source: decl.origin as SourceAnchor
    }];
  });
}

export function inferDomainFromTypeNode(node: ts.TypeNode | undefined, typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map()): AbstractDomain {
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

function inferUseStateDomain(call: ts.CallExpression, typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map()): AbstractDomain {
  const typeArg = call.typeArguments?.[0];
  if (typeArg) return inferDomainFromTypeNode(typeArg, typeAliases);
  const initial = call.arguments[0];
  if (!initial) return { kind: "tokens", count: 1 };
  if (initial.kind === ts.SyntaxKind.TrueKeyword || initial.kind === ts.SyntaxKind.FalseKeyword) return { kind: "bool" };
  if (ts.isStringLiteral(initial)) return { kind: "enum", values: [initial.text] };
  if (ts.isNumericLiteral(initial)) return { kind: "boundedInt", min: Number(initial.text), max: Number(initial.text) };
  if (initial.kind === ts.SyntaxKind.NullKeyword) return { kind: "option", inner: { kind: "tokens", count: 1 } };
  if (ts.isArrayLiteralExpression(initial)) return { kind: "lengthCat" };
  return { kind: "tokens", count: 1 };
}

function initialValueForUseState(call: ts.CallExpression, domain: AbstractDomain): Value {
  const initial = call.arguments[0];
  if (!initial) return firstValue(domain);
  if (initial.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (initial.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteral(initial)) return initial.text;
  if (ts.isNumericLiteral(initial)) return Number(initial.text);
  if (initial.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(initial)) return initial.elements.length === 0 ? "0" : initial.elements.length === 1 ? "1" : "many";
  return firstValue(domain);
}

function domainFromLiteralType(node: ts.LiteralTypeNode): AbstractDomain {
  const lit = node.literal;
  if (lit.kind === ts.SyntaxKind.TrueKeyword || lit.kind === ts.SyntaxKind.FalseKeyword) return { kind: "bool" };
  if (ts.isStringLiteral(lit)) return { kind: "enum", values: [lit.text] };
  if (ts.isNumericLiteral(lit)) return { kind: "boundedInt", min: Number(lit.text), max: Number(lit.text) };
  if (lit.kind === ts.SyntaxKind.NullKeyword) return { kind: "option", inner: { kind: "tokens", count: 1 } };
  return { kind: "tokens", count: 1 };
}

function domainFromUnion(node: ts.UnionTypeNode, typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map()): AbstractDomain {
  const nonNull = node.types.filter((part) => part.kind !== ts.SyntaxKind.UndefinedKeyword && !(ts.isLiteralTypeNode(part) && part.literal.kind === ts.SyntaxKind.NullKeyword));
  if (nonNull.length !== node.types.length && nonNull.length === 1) {
    return { kind: "option", inner: inferDomainFromTypeNode(nonNull[0], typeAliases) };
  }
  const literalValues: string[] = [];
  const numericValues: number[] = [];
  for (const part of node.types) {
    if (!ts.isLiteralTypeNode(part)) return taggedUnionFrom(node) ?? { kind: "tokens", count: 1 };
    const lit = part.literal;
    if (ts.isStringLiteral(lit)) literalValues.push(lit.text);
    else if (ts.isNumericLiteral(lit)) numericValues.push(Number(lit.text));
    else return taggedUnionFrom(node) ?? { kind: "tokens", count: 1 };
  }
  if (numericValues.length === node.types.length) return { kind: "boundedInt", min: Math.min(...numericValues), max: Math.max(...numericValues) };
  return { kind: "enum", values: literalValues };
}

function taggedUnionFrom(node: ts.UnionTypeNode): AbstractDomain | undefined {
  const members = node.types.filter(ts.isTypeLiteralNode);
  if (members.length !== node.types.length) return undefined;
  const tagCandidates = new Map<string, Set<string>>();
  for (const member of members) {
    for (const prop of member.members.filter(ts.isPropertySignature)) {
      if (!prop.type || !ts.isIdentifier(prop.name) || !ts.isLiteralTypeNode(prop.type) || !ts.isStringLiteral(prop.type.literal)) continue;
      const set = tagCandidates.get(prop.name.text) ?? new Set<string>();
      set.add(prop.type.literal.text);
      tagCandidates.set(prop.name.text, set);
    }
  }
  const tag = [...tagCandidates].find(([, values]) => values.size === members.length)?.[0];
  if (!tag) return undefined;
  const variants: Record<string, AbstractDomain> = {};
  for (const member of members) {
    const tagProp = member.members.find((prop): prop is ts.PropertySignature => ts.isPropertySignature(prop) && ts.isIdentifier(prop.name) && prop.name.text === tag);
    if (!tagProp?.type || !ts.isLiteralTypeNode(tagProp.type) || !ts.isStringLiteral(tagProp.type.literal)) return undefined;
    variants[tagProp.type.literal.text] = domainFromTypeLiteral(member, tag);
  }
  return { kind: "tagged", tag, variants };
}

function domainFromTypeLiteral(node: ts.TypeLiteralNode, omitField?: string): AbstractDomain {
  const fields: Record<string, AbstractDomain> = {};
  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || !member.type || !ts.isIdentifier(member.name) || member.name.text === omitField) continue;
    fields[member.name.text] = inferDomainFromTypeNode(member.type);
  }
  return { kind: "record", fields };
}

function domainFromTypeReference(node: ts.TypeReferenceNode, typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map()): AbstractDomain {
  const name = node.typeName.getText();
  const alias = typeAliases.get(name);
  if (alias) return inferDomainFromTypeNode(alias, typeAliases);
  if ((name === "Array" || name === "ReadonlyArray") && node.typeArguments?.length === 1) return { kind: "lengthCat" };
  if (name === "Record") return { kind: "tokens", count: 1 };
  return { kind: "tokens", count: 1 };
}

function typeAliasDeclarations(source: ts.SourceFile): Map<string, ts.TypeNode> {
  const aliases = new Map<string, ts.TypeNode>();
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && ts.isIdentifier(node.name)) aliases.set(node.name.text, node.type);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return aliases;
}

function isUseStateCall(node: ts.Expression): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "useState";
}

function componentNameFor(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name && startsUppercase(node.name.text)) return node.name.text;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && startsUppercase(node.name.text)) return node.name.text;
  return undefined;
}

function providerComponentNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    const name = componentNameFor(node);
    if (name && node.getText(source).includes(".Provider")) names.add(name);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function startsUppercase(value: string): boolean {
  return /^[A-Z]/.test(value);
}

function firstValue(domain: AbstractDomain): Value {
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
      return Object.fromEntries(Object.entries(domain.fields).map(([key, field]) => [key, firstValue(field)]));
    case "tagged": {
      const [tagValue, variant] = Object.entries(domain.variants)[0] ?? ["unknown", { kind: "record", fields: {} } as const];
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

function lineAndColumn(source: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
  return { line: pos.line + 1, column: pos.character + 1 };
}
