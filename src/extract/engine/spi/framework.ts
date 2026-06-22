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
  symbols?: import("./symbol-port.js").SymbolPort;
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
 * Resolves a callee identifier to its exported name, including import aliases
 * when an L1 SymbolPort is available on the framework context.
 */
export function resolveImportedName(
  node: ts.Identifier,
  ctx: FrameworkCtx,
): string {
  if (ctx.symbols) {
    const fileName = ctx.sourceFile?.fileName ?? ctx.fileName ?? "";
    const binding = ctx.symbols.importBinding({
      name: node.text,
      origin: {
        file: fileName,
        start: node.getStart(),
        end: node.getEnd(),
      },
    });
    if (binding) return binding.exportedName;
  }
  return node.text;
}
