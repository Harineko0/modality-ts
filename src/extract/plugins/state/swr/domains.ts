import type { AbstractDomain } from "modality-ts/core";
import type { TypePlugin } from "modality-ts/extract/engine/spi";
import type { SemanticTypeContext } from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import {
  compilerBackedTypeAliases,
  inferDomainFromTypeNode,
} from "../../../lang/ts/driver/domains.js";
import { inferDomainSemantic } from "../../../lang/ts/driver/type-domains.js";

export function inferPayloadDomain(
  typeArg: ts.TypeNode | undefined,
  _typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
  types?: SemanticTypeContext,
  sourceFile?: ts.SourceFile,
  typePlugins?: readonly TypePlugin[],
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
    typePlugins,
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
