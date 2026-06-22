import type { AbstractDomain, SourceAnchor } from "modality-ts/core";
import type * as ts from "typescript";
import type { ModalityAdapterBase, SemanticTypeContext } from "./index.js";

export type SurfaceCall = ts.CallExpression;
export type SurfaceNode = ts.Node;
export type SurfaceDecl = ts.Node;

export interface FrameworkCtx {
  types?: SemanticTypeContext;
  sourceFile?: ts.SourceFile;
  fileName?: string;
}

export type ComponentRole = "component" | "custom-hook";

export interface HookCall {
  hook:
    | { kind: "state" }
    | { kind: "effect"; phase: number }
    | { kind: "transition" }
    | { kind: "start-transition" }
    | { kind: "flush-sync" }
    | { kind: "deferred" }
    | { kind: "callback"; handler: ts.Expression }
    | { kind: "context" };
  origin: SourceAnchor;
}

export interface RenderBoundary {
  kind: "suspense" | "lazy" | "use";
  domain?: AbstractDomain;
  origin: SourceAnchor;
}

export interface FrameworkPlugin extends ModalityAdapterBase {
  recognizeHook(call: SurfaceCall, ctx: FrameworkCtx): HookCall | undefined;
  recognizeRenderBoundary(
    node: SurfaceNode,
    ctx: FrameworkCtx,
  ): RenderBoundary | undefined;
  classifyComponent?(
    decl: SurfaceDecl,
    ctx: FrameworkCtx,
  ): ComponentRole | undefined;
}

export interface EngineFrameworkContext {
  framework: FrameworkPlugin;
  ctx: FrameworkCtx;
}

export function createEngineFrameworkContext(
  framework: FrameworkPlugin,
  ctx: FrameworkCtx = {},
): EngineFrameworkContext {
  return { framework, ctx };
}

/**
 * Resolves a callee identifier to its bare name. Until L1 `importBinding` lands
 * (Part 6), this returns the identifier text unchanged for identity stability.
 */
export function resolveImportedName(
  node: ts.Identifier,
  _ctx: FrameworkCtx,
): string {
  // TODO(Part 6): consume L1 SymbolPort.importBinding when available.
  return node.text;
}
