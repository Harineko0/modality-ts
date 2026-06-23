import * as ts from "typescript";
import type {
  EngineFrameworkPlugin,
  TsExtractableHandler,
} from "../../../engine/ts/framework-ts-bridge.js";
import { isExtractableHandler } from "../../../engine/ts/ast.js";
import type { FrameworkPlugin } from "modality-ts/extract/engine/spi";

export function unwrapCallbackExpr(
  node: ts.Expression,
): TsExtractableHandler | undefined {
  if (
    !ts.isCallExpression(node) ||
    !ts.isIdentifier(node.expression) ||
    node.expression.text !== "useCallback"
  )
    return undefined;
  const first = node.arguments[0];
  return first && isExtractableHandler(first) ? first : undefined;
}

export function isMemoValueCall(node: ts.CallExpression): boolean {
  return ts.isIdentifier(node.expression) && node.expression.text === "useMemo";
}

export function isContextReadCall(node: ts.CallExpression): boolean {
  return (
    ts.isIdentifier(node.expression) && node.expression.text === "useContext"
  );
}

export function extendReactFrameworkWithTsFacets(
  plugin: FrameworkPlugin,
): EngineFrameworkPlugin {
  return {
    ...plugin,
    unwrapCallbackExpr,
    isMemoValueCall,
    isContextReadCall,
  };
}
