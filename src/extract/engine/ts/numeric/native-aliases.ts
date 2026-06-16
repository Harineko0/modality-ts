import * as ts from "typescript";
import type { AbstractDomain } from "modality-ts/core";
import type {
  DomainRefinementContext,
  DomainRefinementResolution,
} from "../../spi/index.js";
import { numericLiteralFromTypeNode } from "../domain-refinements.js";

const NATIVE_ALIASES: Record<
  string,
  { min: number; max: number; overflow: "forbid" | "wrap" }
> = {
  Uint8: { min: 0, max: 255, overflow: "wrap" },
  Byte: { min: 0, max: 255, overflow: "wrap" },
  Uint16: { min: 0, max: 65535, overflow: "wrap" },
  Short: { min: -32768, max: 32767, overflow: "wrap" },
};

export function resolveNativeNumericAlias(
  ctx: DomainRefinementContext,
): DomainRefinementResolution | undefined {
  const ref = typeReference(ctx.typeNode);
  if (!ref) return undefined;
  const { name, typeArgs } = ref;
  if (name === "Bounded" && typeArgs.length === 2) {
    const min = numericLiteralFromTypeNode(typeArgs[0]);
    const max = numericLiteralFromTypeNode(typeArgs[1]);
    if (min === undefined || max === undefined) return undefined;
    return boundedResolution(min, max, "forbid");
  }
  if (name === "Wrapping" && typeArgs.length === 2) {
    const min = numericLiteralFromTypeNode(typeArgs[0]);
    const max = numericLiteralFromTypeNode(typeArgs[1]);
    if (min === undefined || max === undefined) return undefined;
    return boundedResolution(min, max, "wrap");
  }
  const preset = NATIVE_ALIASES[name];
  if (preset) return boundedResolution(preset.min, preset.max, preset.overflow);
  const alias = ctx.typeAliases.get(name);
  if (alias) {
    return resolveNativeNumericAlias({
      ...ctx,
      typeNode: alias,
      visited: new Set([...ctx.visited, name]),
    });
  }
  return undefined;
}

function boundedResolution(
  min: number,
  max: number,
  overflow: "forbid" | "wrap",
): DomainRefinementResolution {
  const domain: AbstractDomain = {
    kind: "boundedInt",
    min,
    max,
    overflow,
  };
  return { domain, caveats: [] };
}

function typeReference(
  node: ts.TypeNode | undefined,
): { name: string; typeArgs: ts.TypeNode[] } | undefined {
  if (!node || !ts.isTypeReferenceNode(node)) return undefined;
  const name = node.typeName.getText();
  return { name, typeArgs: [...(node.typeArguments ?? [])] };
}
