import type { AbstractDomain, SourceAnchor } from "modality-ts/core";
import type { NodeRef } from "../../lang/node-ref.js";
import type {
  SurfaceCall,
  SurfaceDecl,
  SurfaceExpr,
  SurfaceFunction,
  SurfaceNode,
  SymbolRef,
} from "../../lang/surface-ir.js";
import type { ModalityAdapterBase } from "./index.js";
import type { SymbolPort } from "./symbol-port.js";

export type { SurfaceCall, SurfaceDecl, SurfaceExpr, SurfaceNode };

export interface FrameworkCtx {
  fileName?: string;
  symbols?: SymbolPort;
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
    | { kind: "callback"; handler: NodeRef }
    | { kind: "context" };
  origin: SourceAnchor;
}

export interface RenderBoundary {
  kind: "suspense" | "lazy" | "use";
  domain?: AbstractDomain;
  origin: SourceAnchor;
}

export interface UnwrapHandlerCtx {
  fileName: string;
  symbols?: SymbolPort;
}

export interface FrameworkPlugin extends ModalityAdapterBase {
  kind: "framework";
  recognizeHook(call: SurfaceCall, ctx: FrameworkCtx): HookCall | undefined;
  recognizeRenderBoundary(
    node: SurfaceNode,
    ctx: FrameworkCtx,
  ): RenderBoundary | undefined;
  classifyComponent?(
    decl: SurfaceDecl,
    ctx: FrameworkCtx,
  ): ComponentRole | undefined;
  unwrapHandler?(
    expr: SurfaceExpr,
    ctx: UnwrapHandlerCtx,
  ): SurfaceFunction | undefined;
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
 * Resolves a callee symbol to its exported name, including import aliases
 * when an L1 SymbolPort is available on the framework context.
 */
export function resolveImportedName(
  symbol: SymbolRef,
  ctx: FrameworkCtx,
): string {
  if (ctx.symbols) {
    const binding = ctx.symbols.importBinding(symbol);
    if (binding) return binding.exportedName;
  }
  return symbol.name;
}

export function calleeNameFromCall(
  call: SurfaceCall,
  ctx: FrameworkCtx,
): string | undefined {
  if (call.callee.kind !== "ref") return undefined;
  return resolveImportedName(call.callee.symbol, ctx);
}

export function sourceAnchorFromNodeRef(
  ref: NodeRef,
  fileName?: string,
): SourceAnchor {
  return { file: fileName ?? ref.file };
}
