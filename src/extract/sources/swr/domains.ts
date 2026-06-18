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

export function inferPayloadDomain(
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
  if (!types?.checker) {
    return astDomain;
  }
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

function isUninformativeDomain(domain: AbstractDomain): boolean {
  if (domain.kind === "tokens") return true;
  if (domain.kind === "option") return isUninformativeDomain(domain.inner);
  return false;
}
