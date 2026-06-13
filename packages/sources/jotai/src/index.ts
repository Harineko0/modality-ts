import * as ts from "typescript";
import type { SourceDecl, StateSourcePlugin, WriteChannel } from "@modality/extraction/spi";
import type { AbstractDomain, SourceAnchor, StateVarDecl, Value } from "@modality/kernel";
import * as harness from "./harness.js";

export function jotaiSource(): StateSourcePlugin {
  return {
    id: "jotai",
    version: "0.1.0",
    packageNames: ["jotai"],
    discover: (ctx) => discoverJotaiAtoms(ctx.sourceText, ctx.fileName),
    writeChannels: (ctx) => discoverJotaiWriteChannels(ctx.sourceText, ctx.fileName),
    safetyWarnings: (ctx) => discoverJotaiSafetyWarnings(ctx.sourceText, ctx.fileName),
    harness,
    conformance: {
      testedVersions: "jotai>=2"
    }
  };
}

export default jotaiSource;

export function discoverJotaiSafetyWarnings(sourceText: string, fileName = "state.ts"): { message: string; source?: SourceAnchor }[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const warnings: { message: string; source?: SourceAnchor }[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !isJotaiModule(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported !== "getDefaultStore") continue;
      warnings.push({
        message: "Global taint jotai:getDefaultStore",
        source: { file: fileName, ...lineAndColumn(source, specifier) }
      });
    }
  }
  return warnings;
}

export function discoverJotaiAtoms(sourceText: string, fileName = "state.ts"): SourceDecl[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const importedAtomNames = atomImportNames(source);
  if (importedAtomNames.size === 0) return [];

  const decls: SourceDecl[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isAtomCall(node.initializer, importedAtomNames)) {
      const origin = { file: fileName, ...lineAndColumn(source, node) };
      const domain = inferAtomDomain(node.initializer);
      const variable: StateVarDecl = {
        id: `atom:${node.name.text}`,
        domain,
        origin,
        scope: { kind: "global" },
        initial: initialValueForAtom(node.initializer, domain)
      };
      decls.push({
        id: variable.id,
        kind: "jotai/atom",
        var: variable,
        origin,
        metadata: { atomName: node.name.text }
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return decls;
}

export function discoverJotaiWriteChannels(sourceText: string, fileName = "state.ts"): WriteChannel[] {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const setters = setAtomImportNames(source);
  const defaultStoreGetters = getDefaultStoreImportNames(source);
  if (setters.useAtom.size === 0 && setters.useSetAtom.size === 0 && defaultStoreGetters.size === 0) return [];

  const channels: WriteChannel[] = [];
  const defaultStoreNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isGetDefaultStoreCall(node.initializer, defaultStoreGetters)) {
      defaultStoreNames.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) && node.initializer && isUseAtomLikeCall(node.initializer, setters.useAtom)) {
      const atomArg = node.initializer.arguments[0];
      const setter = node.name.elements.at(-1);
      if (atomArg && ts.isIdentifier(atomArg) && setter && ts.isBindingElement(setter) && ts.isIdentifier(setter.name)) {
        channels.push({
          id: `atom:${atomArg.text}.setter`,
          varId: `atom:${atomArg.text}`,
          symbolName: setter.name.text,
          source: { file: fileName, ...lineAndColumn(source, node) } satisfies SourceAnchor
        });
      }
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isUseAtomLikeCall(node.initializer, setters.useSetAtom)) {
      const atomArg = node.initializer.arguments[0];
      if (atomArg && ts.isIdentifier(atomArg)) {
        channels.push({
          id: `atom:${atomArg.text}.setter`,
          varId: `atom:${atomArg.text}`,
          symbolName: node.name.text,
          source: { file: fileName, ...lineAndColumn(source, node) } satisfies SourceAnchor
        });
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "set" && ts.isIdentifier(node.expression.expression) && defaultStoreNames.has(node.expression.expression.text)) {
      const atomArg = node.arguments[0];
      if (atomArg && ts.isIdentifier(atomArg)) {
        channels.push({
          id: `atom:${atomArg.text}.store-set`,
          varId: `atom:${atomArg.text}`,
          symbolName: `${node.expression.expression.text}.set:${atomArg.text}`,
          source: { file: fileName, ...lineAndColumn(source, node) } satisfies SourceAnchor
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return channels;
}

function getDefaultStoreImportNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !isJotaiModule(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported === "getDefaultStore") names.add(specifier.name.text);
    }
  }
  return names;
}

function atomImportNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !isJotaiModule(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      if ((specifier.propertyName?.text ?? specifier.name.text) === "atom") names.add(specifier.name.text);
    }
  }
  return names;
}

function setAtomImportNames(source: ts.SourceFile): { useAtom: Set<string>; useSetAtom: Set<string> } {
  const useAtom = new Set<string>();
  const useSetAtom = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !isJotaiModule(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      const imported = specifier.propertyName?.text ?? specifier.name.text;
      if (imported === "useAtom") useAtom.add(specifier.name.text);
      if (imported === "useSetAtom") useSetAtom.add(specifier.name.text);
    }
  }
  return { useAtom, useSetAtom };
}

function isJotaiModule(moduleSpecifier: ts.Expression): boolean {
  return ts.isStringLiteral(moduleSpecifier) && moduleSpecifier.text === "jotai";
}

function isAtomCall(node: ts.Expression, atomNames: Set<string>): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && atomNames.has(node.expression.text);
}

function isUseAtomLikeCall(node: ts.Expression, names: Set<string>): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text);
}

function isGetDefaultStoreCall(node: ts.Expression, names: Set<string>): node is ts.CallExpression {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text);
}

function inferAtomDomain(call: ts.CallExpression): AbstractDomain {
  const typeArg = call.typeArguments?.[0];
  if (typeArg) return inferDomainFromTypeNode(typeArg);
  const initial = call.arguments[0];
  if (!initial) return { kind: "tokens", count: 1 };
  if (initial.kind === ts.SyntaxKind.TrueKeyword || initial.kind === ts.SyntaxKind.FalseKeyword) return { kind: "bool" };
  if (ts.isStringLiteral(initial)) return { kind: "enum", values: [initial.text] };
  if (ts.isNumericLiteral(initial)) return { kind: "boundedInt", min: Number(initial.text), max: Number(initial.text) };
  if (initial.kind === ts.SyntaxKind.NullKeyword) return { kind: "option", inner: { kind: "tokens", count: 1 } };
  if (ts.isArrayLiteralExpression(initial)) return { kind: "lengthCat" };
  if (ts.isObjectLiteralExpression(initial)) return domainFromObjectLiteral(initial);
  return { kind: "tokens", count: 1 };
}

function initialValueForAtom(call: ts.CallExpression, domain: AbstractDomain): Value {
  const initial = call.arguments[0];
  if (!initial) return firstValue(domain);
  if (initial.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (initial.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isStringLiteral(initial)) return initial.text;
  if (ts.isNumericLiteral(initial)) return Number(initial.text);
  if (initial.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(initial)) return initial.elements.length === 0 ? "0" : initial.elements.length === 1 ? "1" : "many";
  if (ts.isObjectLiteralExpression(initial)) return valueFromObjectLiteral(initial, domain);
  return firstValue(domain);
}

function inferDomainFromTypeNode(node: ts.TypeNode | undefined): AbstractDomain {
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
      return domainFromUnion(node as ts.UnionTypeNode);
    case ts.SyntaxKind.TypeLiteral:
      return domainFromTypeLiteral(node as ts.TypeLiteralNode);
    case ts.SyntaxKind.ArrayType:
      return { kind: "lengthCat" };
    case ts.SyntaxKind.TypeReference:
      return domainFromTypeReference(node as ts.TypeReferenceNode);
    default:
      return { kind: "tokens", count: 1 };
  }
}

function domainFromLiteralType(node: ts.LiteralTypeNode): AbstractDomain {
  const lit = node.literal;
  if (lit.kind === ts.SyntaxKind.TrueKeyword || lit.kind === ts.SyntaxKind.FalseKeyword) return { kind: "bool" };
  if (ts.isStringLiteral(lit)) return { kind: "enum", values: [lit.text] };
  if (ts.isNumericLiteral(lit)) return { kind: "boundedInt", min: Number(lit.text), max: Number(lit.text) };
  if (lit.kind === ts.SyntaxKind.NullKeyword) return { kind: "option", inner: { kind: "tokens", count: 1 } };
  return { kind: "tokens", count: 1 };
}

function domainFromUnion(node: ts.UnionTypeNode): AbstractDomain {
  const nonNull = node.types.filter((part) => part.kind !== ts.SyntaxKind.UndefinedKeyword && !(ts.isLiteralTypeNode(part) && part.literal.kind === ts.SyntaxKind.NullKeyword));
  if (nonNull.length !== node.types.length && nonNull.length === 1) {
    return { kind: "option", inner: inferDomainFromTypeNode(nonNull[0]) };
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

function domainFromObjectLiteral(node: ts.ObjectLiteralExpression): AbstractDomain {
  const fields: Record<string, AbstractDomain> = {};
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
    fields[prop.name.text] = domainFromExpression(prop.initializer);
  }
  return { kind: "record", fields };
}

function domainFromExpression(expr: ts.Expression): AbstractDomain {
  if (expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword) return { kind: "bool" };
  if (ts.isStringLiteral(expr)) return { kind: "enum", values: [expr.text] };
  if (ts.isNumericLiteral(expr)) return { kind: "boundedInt", min: Number(expr.text), max: Number(expr.text) };
  if (expr.kind === ts.SyntaxKind.NullKeyword) return { kind: "option", inner: { kind: "tokens", count: 1 } };
  if (ts.isArrayLiteralExpression(expr)) return { kind: "lengthCat" };
  if (ts.isObjectLiteralExpression(expr)) return domainFromObjectLiteral(expr);
  return { kind: "tokens", count: 1 };
}

function domainFromTypeReference(node: ts.TypeReferenceNode): AbstractDomain {
  const name = node.typeName.getText();
  if ((name === "Array" || name === "ReadonlyArray") && node.typeArguments?.length === 1) return { kind: "lengthCat" };
  return { kind: "tokens", count: 1 };
}

function valueFromObjectLiteral(node: ts.ObjectLiteralExpression, domain: AbstractDomain): Value {
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
  if (ts.isArrayLiteralExpression(expr)) return expr.elements.length === 0 ? "0" : expr.elements.length === 1 ? "1" : "many";
  if (ts.isObjectLiteralExpression(expr)) return valueFromObjectLiteral(expr, domainFromObjectLiteral(expr));
  return "tok1";
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
