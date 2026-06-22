import type { AbstractDomain, SourceAnchor } from "modality-ts/core";
import type {
  FrameworkCtx,
  RenderBoundary,
  SurfaceCall,
  SurfaceExpr,
  SurfaceNode,
} from "modality-ts/extract/engine/spi";
import {
  resolveImportedName,
  sourceAnchorFromNodeRef,
} from "modality-ts/extract/engine/spi";

export const SUSPENSE_DOMAIN: AbstractDomain = {
  kind: "enum",
  values: ["ready", "suspended"],
};

function surfaceOrigin(
  node: { origin: { file: string; start: number; end: number } },
  ctx: FrameworkCtx,
): SourceAnchor {
  return sourceAnchorFromNodeRef(node.origin, ctx.fileName);
}

export function isReactSuspenseElement(
  node: SurfaceNode,
  _ctx: FrameworkCtx,
): boolean {
  return node.kind === "jsx" && node.tag === "Suspense";
}

export function isReactLazyCall(
  node: SurfaceExpr,
  _ctx: FrameworkCtx,
): node is SurfaceCall {
  if (node.kind !== "call") return false;
  if (node.callee.kind !== "member") return false;
  return (
    node.callee.name === "lazy" &&
    node.callee.object.kind === "ref" &&
    node.callee.object.symbol.name === "React"
  );
}

export function isReactUseCall(
  node: SurfaceExpr,
  ctx: FrameworkCtx,
): node is SurfaceCall {
  if (node.kind !== "call") return false;
  if (node.callee.kind !== "ref") return false;
  return resolveImportedName(node.callee.symbol, ctx) === "use";
}

export function recognizeReactRenderBoundary(
  node: SurfaceNode,
  ctx: FrameworkCtx,
): RenderBoundary | undefined {
  if (node.kind === "jsx" && node.tag === "Suspense") {
    return {
      kind: "suspense",
      domain: SUSPENSE_DOMAIN,
      origin: surfaceOrigin(node, ctx),
    };
  }
  if (node.kind !== "call") return undefined;
  if (isReactLazyCall(node, ctx)) {
    return {
      kind: "lazy",
      origin: surfaceOrigin(node, ctx),
    };
  }
  if (isReactUseCall(node, ctx)) {
    return {
      kind: "use",
      origin: surfaceOrigin(node, ctx),
    };
  }
  return undefined;
}

export function isReactStartTransitionCall(
  call: SurfaceCall,
  ctx: FrameworkCtx,
): boolean {
  return calleeNameFromCall(call, ctx) === "startTransition";
}

export function isReactFlushSyncCall(
  call: SurfaceCall,
  ctx: FrameworkCtx,
): boolean {
  return calleeNameFromCall(call, ctx) === "flushSync";
}

export function isReactUseTransitionCall(
  call: SurfaceCall,
  ctx: FrameworkCtx,
): boolean {
  return calleeNameFromCall(call, ctx) === "useTransition";
}

function calleeNameFromCall(
  call: SurfaceCall,
  ctx: FrameworkCtx,
): string | undefined {
  if (call.callee.kind !== "ref") return undefined;
  return resolveImportedName(call.callee.symbol, ctx);
}
