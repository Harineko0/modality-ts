import type { AbstractDomain } from "modality-ts/core";
import type {
  SemanticTypeContext,
  DomainRefinementProvider,
} from "modality-ts/extract/engine/spi";
import {
  compilerBackedTypeAliases,
  inferDomainFromTypeNode,
} from "modality-ts/extract/engine/spi";
import { inferDomainSemantic } from "../../engine/ts/type-domains.js";
import * as ts from "typescript";

export function inferQueryPayloadDomain(
  typeArg: ts.TypeNode | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  types?: SemanticTypeContext,
  sourceFile?: ts.SourceFile,
  domainRefinements?: readonly DomainRefinementProvider[],
): AbstractDomain {
  if (!typeArg) return { kind: "tokens", count: 1 };
  const fallbackAliases = compilerBackedTypeAliases(
    sourceFile ??
      ts.createSourceFile("unknown.ts", "", ts.ScriptTarget.Latest, true),
    types,
  );
  const astDomain = inferDomainFromTypeNode(typeArg, fallbackAliases);
  if (!types?.checker) return astDomain;
  const semanticDomain = inferDomainSemantic(typeArg, {
    checker: types.checker,
    sourceFile: types.sourceFile ?? sourceFile,
    domainRefinements,
    typeAliases: fallbackAliases,
  }).domain;
  if (isUninformativeDomain(astDomain) && semanticDomain.kind !== "tokens") {
    return semanticDomain;
  }
  return astDomain;
}

export function inferInfinitePageDomain(
  payloadDomain: AbstractDomain,
): AbstractDomain {
  return {
    kind: "enum",
    values: ["empty", "onePage", "manyPages"],
  };
}

export function inferMutationDataDomain(
  typeArg: ts.TypeNode | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
  types?: SemanticTypeContext,
  sourceFile?: ts.SourceFile,
  domainRefinements?: readonly DomainRefinementProvider[],
): AbstractDomain {
  return inferQueryPayloadDomain(
    typeArg,
    typeAliases,
    types,
    sourceFile,
    domainRefinements,
  );
}

export function inferMutationVariablesDomain(
  typeArg: ts.TypeNode | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AbstractDomain {
  if (!typeArg) return { kind: "tokens", count: 1 };
  return inferDomainFromTypeNode(typeArg, typeAliases);
}

export function domainFromInitialData(
  expr: ts.Expression | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode>,
): AbstractDomain | undefined {
  if (!expr) return undefined;
  if (ts.isStringLiteral(expr)) {
    return { kind: "enum", values: [expr.text] };
  }
  if (ts.isNumericLiteral(expr)) {
    return {
      kind: "boundedInt",
      min: Number(expr.text),
      max: Number(expr.text),
    };
  }
  if (
    expr.kind === ts.SyntaxKind.TrueKeyword ||
    expr.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return { kind: "bool" };
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return { kind: "lengthCat" };
  }
  if (ts.isObjectLiteralExpression(expr)) {
    const fields: Record<string, AbstractDomain> = {};
    for (const prop of expr.properties) {
      if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name))
        continue;
      const inner = domainFromInitialData(prop.initializer, typeAliases);
      if (inner) fields[prop.name.text] = inner;
    }
    if (Object.keys(fields).length > 0) {
      return { kind: "record", fields };
    }
  }
  return undefined;
}

function isUninformativeDomain(domain: AbstractDomain): boolean {
  if (domain.kind === "tokens") return true;
  if (domain.kind === "option") return isUninformativeDomain(domain.inner);
  return false;
}
