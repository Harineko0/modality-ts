import * as ts from "typescript";
import { lowerExpr, lowerStatement } from "../../lang/ts/lower.js";
import type { NodeRef } from "../../lang/ts/node-ref.js";
import { nodeRefFor } from "../../lang/ts/node-ref.js";
import type {
  SurfaceCall,
  SurfaceNode,
  SymbolRef,
} from "../../lang/ts/surface-ir.js";
import type {
  EngineFrameworkContext,
  FrameworkCtx,
  HookCall,
  RenderBoundary,
} from "../spi/index.js";

export function recognizeHookFromTs(
  call: ts.CallExpression,
  engineFw: EngineFrameworkContext,
  fileName: string,
): HookCall | undefined {
  const surface = lowerExpr(call, fileName);
  if (surface.kind !== "call") return undefined;
  return engineFw.framework.recognizeHook(surface, engineFw.ctx);
}

export function recognizeRenderBoundaryFromTs(
  node: ts.Node,
  engineFw: EngineFrameworkContext,
  fileName: string,
): RenderBoundary | undefined {
  // Only lower nodes that can directly be render boundaries: JSX elements and call expressions.
  // Skipping other node kinds (e.g. ParenthesizedExpression) prevents lowerExpr's unwrapping
  // from producing false-positive boundary detections on wrapper nodes.
  if (
    !ts.isJsxElement(node) &&
    !ts.isJsxSelfClosingElement(node) &&
    !ts.isCallExpression(node)
  ) {
    return undefined;
  }
  const surface = lowerExpr(node as ts.Expression, fileName);
  return engineFw.framework.recognizeRenderBoundary(
    surface as SurfaceNode,
    engineFw.ctx,
  );
}

export function surfaceCallFromTs(
  call: ts.CallExpression,
  fileName: string,
): SurfaceCall {
  const surface = lowerExpr(call, fileName);
  if (surface.kind !== "call") {
    throw new Error("Expected call expression when lowering to SurfaceCall");
  }
  return surface;
}

export function frameworkCtxWithFile(
  ctx: FrameworkCtx,
  fileName: string,
): FrameworkCtx {
  return ctx.fileName ? ctx : { ...ctx, fileName };
}

export function lowerSurfaceNodeFromTs(
  node: ts.Node,
  fileName: string,
): SurfaceNode {
  if (ts.isStatement(node)) {
    return lowerStatement(node, fileName) as SurfaceNode;
  }
  if (
    ts.isExpression(node) ||
    ts.isJsxElement(node) ||
    ts.isJsxSelfClosingElement(node) ||
    ts.isJsxFragment(node)
  ) {
    return lowerExpr(node as ts.Expression, fileName) as SurfaceNode;
  }
  return { kind: "opaque", origin: nodeRefFor(node, fileName) };
}

export function symbolRefFromIdentifier(
  identifier: ts.Identifier,
  fileName: string,
): SymbolRef {
  return {
    name: identifier.text,
    origin: nodeRefFor(identifier, fileName),
  };
}

export function nodeRefFromTsNode(node: ts.Node, fileName: string): NodeRef {
  return nodeRefFor(node, fileName);
}
