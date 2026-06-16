import type { AbstractDomain } from "modality-ts/core";
import type {
  SemanticTypeContext,
  DomainRefinementProvider,
} from "modality-ts/extract/engine/spi";
import {
  inferDomainFromTypeNode,
  typeAliasDeclarations,
} from "modality-ts/extract/engine/spi";
import { inferDomainFromTypeNodeSemanticDetailed } from "../../engine/ts/type-domains.js";
import type * as ts from "typescript";

export { typeAliasDeclarations };

export function inferPayloadDomain(
  typeArg: ts.TypeNode | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  types?: SemanticTypeContext,
  sourceFile?: ts.SourceFile,
  domainRefinements?: readonly DomainRefinementProvider[],
): AbstractDomain {
  const astDomain = inferDomainFromTypeNode(typeArg, typeAliases);
  if (!typeArg || !types?.checker) {
    return astDomain;
  }
  const semanticDomain = inferDomainFromTypeNodeSemanticDetailed(
    typeArg,
    {
      checker: types.checker,
      sourceFile: types.sourceFile ?? sourceFile,
      typeAliases,
      domainRefinements,
    },
    new Set(),
    { domainRefinements },
  ).domain;
  if (astDomain.kind === "tokens" && semanticDomain.kind !== "tokens") {
    return semanticDomain;
  }
  return astDomain;
}
