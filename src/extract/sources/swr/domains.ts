import type { AbstractDomain } from "modality-ts/core";
import {
  inferDomainFromTypeNode,
  typeAliasDeclarations,
} from "modality-ts/extract/engine/spi";
import type * as ts from "typescript";

export { typeAliasDeclarations };

export function inferPayloadDomain(
  typeArg: ts.TypeNode | undefined,
  typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map(),
): AbstractDomain {
  return inferDomainFromTypeNode(typeArg, typeAliases);
}
