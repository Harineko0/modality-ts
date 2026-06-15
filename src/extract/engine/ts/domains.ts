import * as ts from "typescript";
import {
  validateValue,
  type AbstractDomain,
  type ExtractionCaveat,
  type NumericReduction,
  type Value,
} from "modality-ts/core";
import { unprovableNumericDomainCaveat } from "./caveats.js";
import type { ExtractionWarning } from "./types.js";
import { resolveNumericDomain } from "./numeric/resolver.js";
import {
  exactFirstReduction,
  mergeNumericReductions,
} from "./numeric/abstraction.js";

export interface DomainInferenceResult {
  domain: AbstractDomain;
  caveats: ExtractionCaveat[];
  reductions?: NumericReduction[];
}

export interface DomainInferenceContext {
  initializer?: ts.Expression;
  declaration?: ts.VariableDeclaration;
  sourceFile?: ts.SourceFile;
  varId?: string;
}

export function inferDomainFromTypeNode(
  node: ts.TypeNode | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  visited: ReadonlySet<string> = new Set(),
): AbstractDomain {
  return inferDomainFromTypeNodeDetailed(node, typeAliases, visited).domain;
}

export function inferDomainFromTypeNodeDetailed(
  node: ts.TypeNode | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  visited: ReadonlySet<string> = new Set(),
  context: DomainInferenceContext = {},
): DomainInferenceResult {
  if (!node) return abstractNumeric("missing type");
  switch (node.kind) {
    case ts.SyntaxKind.BooleanKeyword:
      return { domain: { kind: "bool" }, caveats: [] };
    case ts.SyntaxKind.StringKeyword:
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return { domain: { kind: "tokens", count: 1 }, caveats: [] };
    case ts.SyntaxKind.NumberKeyword:
      return inferNumericDomain(node, typeAliases, visited, context);
    case ts.SyntaxKind.LiteralType:
      return {
        domain: domainFromLiteralType(node as ts.LiteralTypeNode),
        caveats: [],
      };
    case ts.SyntaxKind.UnionType:
      return domainFromUnionDetailed(
        node as ts.UnionTypeNode,
        typeAliases,
        visited,
        context,
      );
    case ts.SyntaxKind.TypeLiteral:
      return domainFromTypeLiteralDetailed(
        node as ts.TypeLiteralNode,
        undefined,
        typeAliases,
        visited,
        context,
      );
    case ts.SyntaxKind.ArrayType:
      return { domain: { kind: "lengthCat" }, caveats: [] };
    case ts.SyntaxKind.TypeReference:
      return domainFromTypeReferenceDetailed(
        node as ts.TypeReferenceNode,
        typeAliases,
        visited,
        context,
      );
    default:
      return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }
}

export function inferUseStateDomain(
  call: ts.CallExpression,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
): AbstractDomain {
  return inferUseStateDomainDetailed(call, typeAliases).domain;
}

export function inferUseStateDomainDetailed(
  call: ts.CallExpression,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  sourceFile?: ts.SourceFile,
  varId?: string,
): DomainInferenceResult {
  const typeArg = call.typeArguments?.[0];
  const initializer = call.arguments[0];
  if (typeArg) {
    return inferDomainFromTypeNodeDetailed(typeArg, typeAliases, new Set(), {
      initializer,
      sourceFile,
      varId,
    });
  }
  if (initializer) {
    const schemaResolved = resolveNumericDomain({
      initializer,
      sourceFile,
      typeAliases,
      visited: new Set(),
      varId,
    });
    if (schemaResolved.domain) {
      return {
        domain: schemaResolved.domain,
        caveats: schemaResolved.caveats,
        reductions: schemaResolved.reductions,
      };
    }
    if (schemaResolved.caveats.length > 0) {
      return {
        domain: { kind: "tokens", count: 1 },
        caveats: schemaResolved.caveats,
      };
    }
    if (
      initializer.kind === ts.SyntaxKind.TrueKeyword ||
      initializer.kind === ts.SyntaxKind.FalseKeyword
    )
      return { domain: { kind: "bool" }, caveats: [] };
    if (ts.isStringLiteral(initializer) || ts.isNumericLiteral(initializer))
      return {
        domain: { kind: "enum", values: [initializer.text] },
        caveats: [],
      };
    if (initializer.kind === ts.SyntaxKind.NullKeyword)
      return {
        domain: { kind: "option", inner: { kind: "tokens", count: 1 } },
        caveats: [],
      };
    if (ts.isArrayLiteralExpression(initializer))
      return { domain: { kind: "lengthCat" }, caveats: [] };
  }
  return { domain: { kind: "tokens", count: 1 }, caveats: [] };
}

export function domainInferenceWarnings(
  result: DomainInferenceResult,
  anchor?: { line?: number; column?: number },
): ExtractionWarning[] {
  return result.caveats.map((caveat) => ({
    message: caveat.reason,
    ...anchor,
    caveat,
  }));
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
    case "intSet":
      return domain.values[0] ?? 0;
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

function inferNumericDomain(
  node: ts.TypeNode,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  visited: ReadonlySet<string>,
  context: DomainInferenceContext,
): DomainInferenceResult {
  const resolved = resolveNumericDomain({
    typeNode: node,
    initializer: context.initializer,
    declaration: context.declaration,
    sourceFile: context.sourceFile,
    typeAliases,
    visited,
    varId: context.varId,
  });
  if (resolved.domain) {
    return withDomainReductions(
      {
        domain: resolved.domain,
        caveats: resolved.caveats,
        reductions: resolved.reductions,
      },
      context,
    );
  }
  if (resolved.caveats.length > 0) {
    return { domain: { kind: "tokens", count: 1 }, caveats: resolved.caveats };
  }
  return abstractNumeric(context.varId ?? "numeric", node, context.sourceFile);
}

function withDomainReductions(
  result: DomainInferenceResult,
  context: DomainInferenceContext,
): DomainInferenceResult {
  if (!context.varId) return result;
  const inferred = exactFirstReduction(context.varId, result.domain);
  const reductions = mergeNumericReductions(
    result.reductions,
    inferred ? [inferred] : [],
  );
  return reductions.length > 0 ? { ...result, reductions } : result;
}

function reductionsForDomain(
  varId: string,
  domain: AbstractDomain,
  context: DomainInferenceContext,
): NumericReduction[] | undefined {
  const reduction = exactFirstReduction(
    varId,
    domain,
    sourceFromContext(context),
  );
  return reduction ? [reduction] : undefined;
}

function sourceFromContext(
  context: DomainInferenceContext,
): { file: string; line: number; column: number } | undefined {
  if (!context.declaration || !context.sourceFile) return undefined;
  const { line, character } = context.sourceFile.getLineAndCharacterOfPosition(
    context.declaration.getStart(context.sourceFile),
  );
  return {
    file: context.sourceFile.fileName,
    line: line + 1,
    column: character + 1,
  };
}

function abstractNumeric(
  id: string,
  node?: ts.Node,
  sourceFile?: ts.SourceFile,
): DomainInferenceResult {
  const source =
    node && sourceFile
      ? (() => {
          const { line, character } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          return {
            file: sourceFile.fileName,
            line: line + 1,
            column: character + 1,
          };
        })()
      : undefined;
  return {
    domain: { kind: "tokens", count: 1 },
    caveats: [
      unprovableNumericDomainCaveat(
        id,
        "bare number without statically provable finite domain",
        source,
      ),
    ],
  };
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

function domainFromUnionDetailed(
  node: ts.UnionTypeNode,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  visited: ReadonlySet<string>,
  context: DomainInferenceContext,
): DomainInferenceResult {
  const nonNull = node.types.filter(
    (part) =>
      part.kind !== ts.SyntaxKind.UndefinedKeyword &&
      !(
        ts.isLiteralTypeNode(part) &&
        part.literal.kind === ts.SyntaxKind.NullKeyword
      ),
  );
  if (nonNull.length !== node.types.length && nonNull.length > 0) {
    const inner =
      nonNull.length === 1
        ? inferDomainFromTypeNodeDetailed(
            nonNull[0],
            typeAliases,
            visited,
            context,
          )
        : domainFromUnionMembersDetailed(
            nonNull,
            typeAliases,
            visited,
            context,
          );
    return {
      domain: { kind: "option", inner: inner.domain },
      caveats: inner.caveats,
      reductions: inner.reductions,
    };
  }
  return domainFromUnionMembersDetailed(
    node.types,
    typeAliases,
    visited,
    context,
  );
}

function domainFromUnionMembersDetailed(
  types: readonly ts.TypeNode[],
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  visited: ReadonlySet<string>,
  context: DomainInferenceContext,
): DomainInferenceResult {
  const literalValues: string[] = [];
  const numericValues: number[] = [];
  for (const part of types) {
    if (!ts.isLiteralTypeNode(part)) {
      const tagged =
        taggedUnionFromMembers(types, typeAliases, visited) ??
        ({ kind: "tokens", count: 1 } as const);
      return { domain: tagged, caveats: [] };
    }
    const lit = part.literal;
    if (ts.isStringLiteral(lit)) literalValues.push(lit.text);
    else if (ts.isNumericLiteral(lit)) numericValues.push(Number(lit.text));
    else {
      const tagged =
        taggedUnionFromMembers(types, typeAliases, visited) ??
        ({ kind: "tokens", count: 1 } as const);
      return { domain: tagged, caveats: [] };
    }
  }
  if (numericValues.length === types.length) {
    const domain = domainFromNumericLiterals(numericValues);
    return {
      domain,
      caveats: [],
      reductions: context.varId
        ? reductionsForDomain(context.varId, domain, context)
        : undefined,
    };
  }
  return { domain: { kind: "enum", values: literalValues }, caveats: [] };
}

function domainFromNumericLiterals(values: readonly number[]): AbstractDomain {
  const sorted = [...new Set(values)].sort((left, right) => left - right);
  if (sorted.length === 0) return { kind: "tokens", count: 1 };
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min === undefined || max === undefined)
    return { kind: "tokens", count: 1 };
  const dense = sorted.length === max - min + 1;
  if (dense) return { kind: "boundedInt", min, max };
  return { kind: "intSet", values: sorted };
}

function taggedUnionFromMembers(
  types: readonly ts.TypeNode[],
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  visited: ReadonlySet<string> = new Set(),
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
    variants[tagProp.type.literal.text] = domainFromTypeLiteral(
      member,
      tag,
      typeAliases,
      visited,
    );
  }
  return { kind: "tagged", tag, variants };
}

function domainFromTypeLiteralDetailed(
  node: ts.TypeLiteralNode,
  omitField: string | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  visited: ReadonlySet<string>,
  context: DomainInferenceContext,
): DomainInferenceResult {
  const fields: Record<string, AbstractDomain> = {};
  const caveats: ExtractionCaveat[] = [];
  for (const member of node.members) {
    if (
      !ts.isPropertySignature(member) ||
      !member.type ||
      !ts.isIdentifier(member.name) ||
      member.name.text === omitField
    )
      continue;
    const inferred = inferDomainFromTypeNodeDetailed(
      member.type,
      typeAliases,
      visited,
      context,
    );
    fields[member.name.text] = inferred.domain;
    caveats.push(...inferred.caveats);
  }
  return { domain: { kind: "record", fields }, caveats };
}

function domainFromTypeLiteral(
  node: ts.TypeLiteralNode,
  omitField?: string,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  visited: ReadonlySet<string> = new Set(),
): AbstractDomain {
  return domainFromTypeLiteralDetailed(
    node,
    omitField,
    typeAliases,
    visited,
    {},
  ).domain;
}

function domainFromTypeReferenceDetailed(
  node: ts.TypeReferenceNode,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  visited: ReadonlySet<string>,
  context: DomainInferenceContext,
): DomainInferenceResult {
  const name = node.typeName.getText();
  if (visited.has(name))
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  const resolved = resolveNumericDomain({
    typeNode: node,
    initializer: context.initializer,
    declaration: context.declaration,
    sourceFile: context.sourceFile,
    typeAliases,
    visited,
    varId: context.varId,
  });
  if (resolved.domain) {
    return withDomainReductions(
      {
        domain: resolved.domain,
        caveats: resolved.caveats,
        reductions: resolved.reductions,
      },
      context,
    );
  }
  if (resolved.caveats.length > 0) {
    return { domain: { kind: "tokens", count: 1 }, caveats: resolved.caveats };
  }
  const alias = typeAliases.get(name);
  if (alias) {
    return inferDomainFromTypeNodeDetailed(
      alias,
      typeAliases,
      new Set([...visited, name]),
      context,
    );
  }
  if (
    (name === "Array" || name === "ReadonlyArray") &&
    node.typeArguments?.length === 1
  )
    return { domain: { kind: "lengthCat" }, caveats: [] };
  if (name === "Record")
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  return { domain: { kind: "tokens", count: 1 }, caveats: [] };
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
