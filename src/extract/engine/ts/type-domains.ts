import * as ts from "typescript";
import type { AbstractDomain } from "modality-ts/core";
import { unprovableNumericDomainCaveat } from "./caveats.js";
import {
  inferDomainFromTypeNodeDetailed,
  type DomainInferenceContext,
  type DomainInferenceResult,
} from "./domains.js";
import { resolveDomainRefinements } from "./domain-refinements.js";
import type { DomainRefinementProvider } from "../spi/index.js";

const MAX_RECORD_PROPERTIES = 64;

export interface TypeDomainInferenceContext {
  checker: ts.TypeChecker;
  sourceFile?: ts.SourceFile;
  varId?: string;
  typeAliases?: ReadonlyMap<string, ts.TypeNode>;
  initializer?: ts.Expression;
  declaration?: ts.VariableDeclaration;
  domainRefinements?: readonly DomainRefinementProvider[];
}

export function inferDomainFromType(
  type: ts.Type,
  ctx: TypeDomainInferenceContext,
): AbstractDomain {
  return inferDomainFromTypeDetailed(type, ctx).domain;
}

export function inferDomainFromTypeDetailed(
  type: ts.Type,
  ctx: TypeDomainInferenceContext,
  visited: Set<number> = new Set(),
): DomainInferenceResult {
  const typeId = (type as ts.Type & { id?: number }).id;
  if (typeId !== undefined) {
    if (visited.has(typeId)) {
      return { domain: { kind: "tokens", count: 1 }, caveats: [] };
    }
    visited.add(typeId);
  }

  if (type.flags & ts.TypeFlags.Undefined) {
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }
  if (type.flags & ts.TypeFlags.Null) {
    return {
      domain: { kind: "option", inner: { kind: "tokens", count: 1 } },
      caveats: [],
    };
  }
  if (type.flags & ts.TypeFlags.Never) {
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }
  if (
    type.flags &
    (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.TemplateLiteral)
  ) {
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }
  if (type.flags & ts.TypeFlags.ESSymbol) {
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }

  if (type.isStringLiteral()) {
    return {
      domain: { kind: "enum", values: [type.value] },
      caveats: [],
    };
  }
  const literalString = stringLiteralFromTypeString(
    ctx.checker.typeToString(type),
  );
  if (literalString !== undefined) {
    return { domain: { kind: "enum", values: [literalString] }, caveats: [] };
  }
  if (type.isNumberLiteral()) {
    const value = type.value;
    return {
      domain: { kind: "boundedInt", min: value, max: value },
      caveats: [],
    };
  }
  if (isBooleanLike(ctx.checker, type)) {
    return { domain: { kind: "bool" }, caveats: [] };
  }
  if (isBroadString(type, ctx.checker)) {
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }
  if (isBroadNumber(type)) {
    return broadNumberResult(ctx);
  }

  if (type.isUnion()) {
    return domainFromUnionType(type, ctx, visited);
  }

  if (ctx.checker.isArrayType(type) || ctx.checker.isTupleType(type)) {
    return { domain: { kind: "lengthCat" }, caveats: [] };
  }

  if (isBoxedPrimitive(type, ctx.checker)) {
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }

  if (type.flags & ts.TypeFlags.Object) {
    const objectType = ctx.checker.getApparentType(type);
    return domainFromObjectType(objectType, ctx, visited);
  }

  return { domain: { kind: "tokens", count: 1 }, caveats: [] };
}

export function inferDomainFromTypeNodeSemanticDetailed(
  typeNode: ts.TypeNode,
  ctx: TypeDomainInferenceContext,
  visited: ReadonlySet<string> = new Set(),
  astContext: DomainInferenceContext = {},
): DomainInferenceResult {
  if (!ctx.checker || !ctx.sourceFile) {
    return inferDomainFromTypeNodeDetailed(
      typeNode,
      ctx.typeAliases ?? new Map(),
      visited,
      astContext,
    );
  }

  const declaredType = ctx.checker.getTypeFromTypeNode(typeNode);
  if (isBroadNumber(declaredType)) {
    return broadNumberResult({ ...ctx, varId: ctx.varId ?? astContext.varId });
  }
  if (isBroadString(declaredType, ctx.checker)) {
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }

  // Inference order for typed nodes: (1) schema/native numeric refinement adapters
  // for erased bounds, (2) TypeScript semantic structural mapping, (3) AST fallback.
  // Schema adapters (Zod, ArkType, native Bounded/Wrapping/Uint8) are refinement
  // providers only — non-numerical schema shapes flow through semantic mapping when
  // `z.infer` / `typeof schema.infer` preserves finite structure in the checker.
  const numeric = resolveDomainRefinements(
    {
      typeNode,
      initializer: astContext.initializer ?? ctx.initializer,
      declaration: astContext.declaration ?? ctx.declaration,
      sourceFile: ctx.sourceFile,
      typeAliases: ctx.typeAliases ?? new Map(),
      visited,
      varId: ctx.varId ?? astContext.varId,
    },
    ctx.domainRefinements ?? astContext.domainRefinements ?? [],
  );
  if (numeric.domain) {
    return {
      domain: numeric.domain,
      caveats: numeric.caveats,
      reductions: numeric.reductions,
    };
  }
  if (numeric.caveats.length > 0) {
    return { domain: { kind: "tokens", count: 1 }, caveats: numeric.caveats };
  }

  const type = ctx.checker.getTypeFromTypeNode(typeNode);
  const semantic = inferDomainFromTypeDetailed(type, ctx);
  if (semantic.domain.kind === "tokens" && semantic.caveats.length === 0) {
    const ast = inferDomainFromTypeNodeDetailed(
      typeNode,
      ctx.typeAliases ?? new Map(),
      visited,
      astContext,
    );
    if (ast.domain.kind !== "tokens" || ast.caveats.length > 0) {
      return ast;
    }
  }
  return semantic;
}

export function inferDomainFromExpressionSemanticDetailed(
  expression: ts.Expression,
  ctx: TypeDomainInferenceContext,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  broadTypeNode?: ts.TypeNode,
): DomainInferenceResult {
  if (!ctx.checker || !ctx.sourceFile) {
    return inferDomainFromTypeNodeDetailed(undefined, typeAliases, new Set(), {
      initializer: expression,
      sourceFile: ctx.sourceFile,
      varId: ctx.varId,
    });
  }

  const numeric = resolveDomainRefinements(
    {
      initializer: expression,
      sourceFile: ctx.sourceFile,
      typeAliases,
      visited: new Set(),
      varId: ctx.varId,
    },
    ctx.domainRefinements ?? [],
  );
  if (numeric.domain) {
    return {
      domain: numeric.domain,
      caveats: numeric.caveats,
      reductions: numeric.reductions,
    };
  }
  if (numeric.caveats.length > 0) {
    return { domain: { kind: "tokens", count: 1 }, caveats: numeric.caveats };
  }

  if (broadTypeNode) {
    const declared = ctx.checker.getTypeFromTypeNode(broadTypeNode);
    if (isBroadString(declared, ctx.checker) || isBroadNumber(declared)) {
      return broadTypeResult(declared, ctx);
    }
  }

  const expressionType = ctx.checker.getTypeAtLocation(expression);
  if (
    isBroadString(expressionType, ctx.checker) ||
    isBroadNumber(expressionType)
  ) {
    return broadTypeResult(expressionType, ctx);
  }

  return inferDomainFromTypeDetailed(expressionType, ctx);
}

function stringLiteralFromTypeString(typeString: string): string | undefined {
  const match = /^"([^"]*)"$/.exec(typeString);
  return match?.[1];
}

function referencesRecursiveType(
  checker: ts.TypeChecker,
  propertyType: ts.Type,
  selfId: number | undefined,
  visited: Set<number>,
): boolean {
  const members = propertyType.isUnion() ? propertyType.types : [propertyType];
  for (const member of members) {
    if (isNullishType(member)) continue;
    const apparent = checker.getApparentType(member);
    const propertyId = (apparent as ts.Type & { id?: number }).id;
    if (
      propertyId !== undefined &&
      ((selfId !== undefined && propertyId === selfId) ||
        visited.has(propertyId))
    ) {
      return true;
    }
  }
  return false;
}

function isBooleanLike(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.isUnion()) {
    const members = type.types.filter((member) => !isNullishType(member));
    return (
      members.length > 0 &&
      members.every((member) => isBooleanLike(checker, member))
    );
  }
  if (type === checker.getBooleanType()) return true;
  if (type.flags & ts.TypeFlags.BooleanLiteral) return true;
  const text = checker.typeToString(type).toLowerCase();
  return text === "boolean" || text === "true" || text === "false";
}

function isBroadString(type: ts.Type, checker?: ts.TypeChecker): boolean {
  if (checker && checker.typeToString(type) === "string") return true;
  return (
    (type.flags & ts.TypeFlags.String) !== 0 &&
    !type.isStringLiteral() &&
    !(type.flags & ts.TypeFlags.TemplateLiteral)
  );
}

function isBroadNumber(type: ts.Type): boolean {
  return (type.flags & ts.TypeFlags.Number) !== 0 && !type.isNumberLiteral();
}

function isBoxedPrimitive(type: ts.Type, checker: ts.TypeChecker): boolean {
  if (!(type.flags & ts.TypeFlags.Object)) return false;
  const symbol = type.getSymbol();
  if (!symbol) return false;
  const name = symbol.getName();
  return (
    name === "String" ||
    name === "Number" ||
    name === "Boolean" ||
    name === "BigInt"
  );
}

function broadNumberResult(
  ctx: TypeDomainInferenceContext,
): DomainInferenceResult {
  const source =
    ctx.initializer && ctx.sourceFile
      ? sourceAnchor(ctx.initializer, ctx.sourceFile)
      : undefined;
  return {
    domain: { kind: "tokens", count: 1 },
    caveats: ctx.varId
      ? [
          unprovableNumericDomainCaveat(
            ctx.varId,
            "bare number without statically provable finite domain",
            source,
          ),
        ]
      : [],
  };
}

function broadTypeResult(
  type: ts.Type,
  ctx: TypeDomainInferenceContext,
): DomainInferenceResult {
  if (isBroadNumber(type)) return broadNumberResult(ctx);
  return { domain: { kind: "tokens", count: 1 }, caveats: [] };
}

function sourceAnchor(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): { file: string; line: number; column: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { file: sourceFile.fileName, line: line + 1, column: character + 1 };
}

function domainFromUnionType(
  type: ts.UnionType,
  ctx: TypeDomainInferenceContext,
  visited: Set<number>,
): DomainInferenceResult {
  const members = type.types;
  const nullish = members.filter(isNullishType);
  const rest = members.filter((member) => !isNullishType(member));
  if (nullish.length > 0 && rest.length > 0) {
    const inner = inferUnionMembers(rest, ctx, visited);
    return {
      domain: { kind: "option", inner: inner.domain },
      caveats: inner.caveats,
    };
  }
  return inferUnionMembers(members, ctx, visited);
}

function isNullishType(type: ts.Type): boolean {
  return (
    (type.flags & ts.TypeFlags.Undefined) !== 0 ||
    (type.flags & ts.TypeFlags.Null) !== 0
  );
}

function inferUnionMembers(
  members: readonly ts.Type[],
  ctx: TypeDomainInferenceContext,
  visited: Set<number>,
): DomainInferenceResult {
  if (members.length === 0) {
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }
  if (members.length === 1) {
    return inferDomainFromTypeDetailed(members[0]!, ctx, new Set(visited));
  }
  if (members.every((member) => member.isStringLiteral())) {
    const values = members
      .map((member) => member.value as string)
      .sort((left, right) => left.localeCompare(right));
    return { domain: { kind: "enum", values }, caveats: [] };
  }
  if (members.every((member) => member.isNumberLiteral())) {
    const values = members.map((member) => member.value as number);
    return { domain: domainFromNumericLiterals(values), caveats: [] };
  }
  if (
    members.every(
      (member) =>
        member.flags & ts.TypeFlags.BooleanLiteral ||
        member.flags & ts.TypeFlags.Boolean,
    )
  ) {
    return { domain: { kind: "bool" }, caveats: [] };
  }

  const tagged = tryTaggedUnion(members, ctx, visited);
  if (tagged) return tagged;

  const objectMembers = members.filter(
    (member) => (member.flags & ts.TypeFlags.Object) !== 0,
  );
  if (objectMembers.length === members.length && objectMembers.length > 1) {
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }

  return { domain: { kind: "tokens", count: 1 }, caveats: [] };
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

function domainFromObjectType(
  type: ts.Type,
  ctx: TypeDomainInferenceContext,
  visited: Set<number>,
): DomainInferenceResult {
  const selfType = ctx.checker.getApparentType(type);
  const selfId = (selfType as ts.Type & { id?: number }).id;
  const stringIndex = ctx.checker.getIndexTypeOfType(type, ts.IndexKind.String);
  const numberIndex = ctx.checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  const properties = ctx.checker.getPropertiesOfType(type);
  if ((stringIndex || numberIndex) && properties.length === 0) {
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }
  if (properties.length > MAX_RECORD_PROPERTIES) {
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }

  for (const property of properties) {
    if (property.flags & ts.SymbolFlags.Method) continue;
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration) continue;
    const propertyType = ctx.checker.getTypeOfSymbolAtLocation(
      property,
      declaration,
    );
    if (referencesRecursiveType(ctx.checker, propertyType, selfId, visited)) {
      return { domain: { kind: "tokens", count: 1 }, caveats: [] };
    }
  }

  const fields: Record<string, AbstractDomain> = {};
  const caveats: DomainInferenceResult["caveats"] = [];
  for (const property of properties) {
    if (property.flags & ts.SymbolFlags.Method) continue;
    const name = property.getName();
    if (name.startsWith("__")) continue;
    const declaration = property.valueDeclaration ?? property.declarations?.[0];
    if (!declaration) continue;
    const propertyType = ctx.checker.getTypeOfSymbolAtLocation(
      property,
      declaration,
    );
    if (isBooleanLike(ctx.checker, propertyType)) {
      fields[name] = { kind: "bool" };
      continue;
    }
    const inferred = inferDomainFromTypeDetailed(
      propertyType,
      ctx,
      new Set(visited),
    );
    if (inferred.domain.kind !== "tokens") {
      let fieldDomain = inferred.domain;
      if (property.flags & ts.SymbolFlags.Optional) {
        if (fieldDomain.kind !== "option") {
          fieldDomain = { kind: "option", inner: fieldDomain };
        }
      }
      fields[name] = fieldDomain;
      caveats.push(...inferred.caveats);
      continue;
    }
    if (ctx.checker.typeToString(propertyType) === "string") {
      fields[name] = { kind: "tokens", count: 1 };
      continue;
    }
    fields[name] = inferred.domain;
    caveats.push(...inferred.caveats);
  }

  if (Object.keys(fields).length === 0) {
    return { domain: { kind: "tokens", count: 1 }, caveats: [] };
  }
  return { domain: { kind: "record", fields }, caveats };
}

function tryTaggedUnion(
  members: readonly ts.Type[],
  ctx: TypeDomainInferenceContext,
  visited: Set<number>,
): DomainInferenceResult | undefined {
  const objectMembers = members.map((member) =>
    ctx.checker.getApparentType(member),
  );
  if (
    !objectMembers.every((member) => (member.flags & ts.TypeFlags.Object) !== 0)
  ) {
    return undefined;
  }

  const propertySets = objectMembers.map((member) =>
    ctx.checker.getPropertiesOfType(member),
  );
  const commonNames = propertySets
    .slice(1)
    .reduce(
      (common, props) =>
        new Set(
          [...common].filter((name) => props.some((p) => p.getName() === name)),
        ),
      new Set(propertySets[0]?.map((prop) => prop.getName()) ?? []),
    );

  for (const tagName of commonNames) {
    const tagValues: string[] = [];
    let valid = true;
    const variants: Record<string, AbstractDomain> = {};
    for (const member of objectMembers) {
      const property = ctx.checker
        .getPropertiesOfType(member)
        .find((prop) => prop.getName() === tagName);
      if (!property) {
        valid = false;
        break;
      }
      const declaration =
        property.valueDeclaration ?? property.declarations?.[0];
      if (!declaration) {
        valid = false;
        break;
      }
      const tagType = ctx.checker.getTypeOfSymbolAtLocation(
        property,
        declaration,
      );
      if (!tagType.isStringLiteral()) {
        valid = false;
        break;
      }
      const tagValue = tagType.value as string;
      if (tagValues.includes(tagValue)) {
        valid = false;
        break;
      }
      tagValues.push(tagValue);
      const record = domainFromObjectType(member, ctx, new Set(visited));
      if (record.domain.kind !== "record") {
        valid = false;
        break;
      }
      const { [tagName]: _tag, ...rest } = record.domain.fields;
      variants[tagValue] = { kind: "record", fields: rest };
    }
    if (valid && tagValues.length === objectMembers.length) {
      return {
        domain: { kind: "tagged", tag: tagName, variants },
        caveats: [],
      };
    }
  }
  return undefined;
}
