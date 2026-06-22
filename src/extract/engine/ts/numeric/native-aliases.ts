import type { AbstractDomain } from "modality-ts/core";
import * as ts from "typescript";
import type {
  TypeRefinementContext,
  TypeRefinementResolution,
} from "../../spi/type-plugin.js";
import { numericLiteralFromTypeNode } from "../domain-refinements.js";
import { tsNodeAt } from "../type-refinement-bridge.js";

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
  ctx: TypeRefinementContext,
): TypeRefinementResolution | undefined {
  const ref = typeReference(ctx);
  if (!ref) return undefined;
  const { name, typeArgRefs } = ref;
  if (name === "Bounded" && typeArgRefs.length === 2) {
    const min = numericLiteralFromTypeRef(ctx, typeArgRefs[0]);
    const max = numericLiteralFromTypeRef(ctx, typeArgRefs[1]);
    if (min === undefined || max === undefined) return undefined;
    return boundedResolution(min, max, "forbid");
  }
  if (name === "Wrapping" && typeArgRefs.length === 2) {
    const min = numericLiteralFromTypeRef(ctx, typeArgRefs[0]);
    const max = numericLiteralFromTypeRef(ctx, typeArgRefs[1]);
    if (min === undefined || max === undefined) return undefined;
    return boundedResolution(min, max, "wrap");
  }
  const preset = NATIVE_ALIASES[name];
  if (preset) return boundedResolution(preset.min, preset.max, preset.overflow);
  const alias = ctx.typeAliases.get(name);
  if (alias) {
    return resolveNativeNumericAlias({
      ...ctx,
      typeAnnotation: alias,
      visited: new Set([...ctx.visited, name]),
    });
  }
  return undefined;
}

function boundedResolution(
  min: number,
  max: number,
  overflow: "forbid" | "wrap",
): TypeRefinementResolution {
  const domain: AbstractDomain = {
    kind: "boundedInt",
    min,
    max,
    overflow,
  };
  return { domain, caveats: [] };
}

function typeReference(ctx: TypeRefinementContext):
  | {
      name: string;
      typeArgRefs: import("../../../lang/ts/node-ref.js").NodeRef[];
    }
  | undefined {
  if (!ctx.typeAnnotation) return undefined;
  const node = tsNodeAt(ctx, ctx.typeAnnotation);
  if (!node || !ts.isTypeReferenceNode(node)) return undefined;
  const name = node.typeName.getText();
  const typeArgRefs = (node.typeArguments ?? []).map((typeArg) =>
    nodeRefForTypeArg(typeArg, ctx),
  );
  return { name, typeArgRefs };
}

function nodeRefForTypeArg(
  node: ts.TypeNode,
  ctx: TypeRefinementContext,
): import("../../../lang/ts/node-ref.js").NodeRef {
  const fileName = ctx.fileName ?? node.getSourceFile().fileName;
  return {
    file: fileName,
    start: node.getStart(),
    end: node.getEnd(),
  };
}

function numericLiteralFromTypeRef(
  ctx: TypeRefinementContext,
  ref: import("../../../lang/ts/node-ref.js").NodeRef,
): number | undefined {
  const node = tsNodeAt(ctx, ref);
  return numericLiteralFromTypeNode(
    node && ts.isTypeNode(node) ? node : undefined,
  );
}
