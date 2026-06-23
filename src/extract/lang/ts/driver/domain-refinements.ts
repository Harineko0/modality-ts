import type { SourceAnchor } from "modality-ts/core";
import * as ts from "typescript";
import type {
  TypePlugin,
  TypeRefinementContext,
  TypeRefinementResolution,
} from "../../../engine/spi/type-plugin.js";
import { resolveNativeNumericAlias } from "./numeric/native-aliases.js";

export function emptyTypeRefinementResolution(): TypeRefinementResolution {
  return { caveats: [] };
}

export function resolveDomainRefinements(
  ctx: TypeRefinementContext,
  providers: readonly TypePlugin[] = [],
): TypeRefinementResolution {
  const native = resolveNativeNumericAlias(ctx);
  if (native && (native.domain !== undefined || native.caveats.length > 0)) {
    return native;
  }
  for (const provider of providers) {
    const result = provider.refineDomain(ctx);
    if (result && (result.domain !== undefined || result.caveats.length > 0)) {
      return result;
    }
  }
  return { caveats: [] };
}

export function numericLiteralFromTypeNode(
  node: ts.TypeNode | undefined,
): number | undefined {
  if (!node) return undefined;
  if (ts.isLiteralTypeNode(node) && ts.isNumericLiteral(node.literal))
    return Number(node.literal.text);
  return undefined;
}

export function sourceAnchorFromNode(
  node: ts.Node,
  sourceFile?: ts.SourceFile,
): SourceAnchor | undefined {
  if (!sourceFile) return undefined;
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(
    node.getStart(sourceFile),
  );
  return { file: sourceFile.fileName, line: line + 1, column: character + 1 };
}
