import type {
  ComponentRole,
  FrameworkCtx,
  FrameworkPlugin,
  HookCall,
  RenderBoundary,
  SurfaceCall,
  SurfaceDecl,
  SurfaceNode,
} from "modality-ts/extract/engine/spi";
import { registerFrameworkPlugin } from "modality-ts/extract/engine/spi";
import { componentNameFor, startsUppercase } from "../../engine/ts/ast.js";
import { isCustomHookDeclaration } from "../../engine/ts/components.js";
import {
  isReactEffectHookName,
  isReactFlushSyncCall,
  isReactHookNamed,
  isReactStartTransitionCall,
  isReactUseTransitionCall,
  reactEffectPhase,
  recognizeReactHook,
} from "./hooks.js";
import {
  isReactLazyCall,
  isReactSuspenseElement,
  isReactUseCall,
  recognizeReactRenderBoundary,
  SUSPENSE_DOMAIN,
} from "./render-boundaries.js";

export { SUSPENSE_DOMAIN };
export {
  isReactEffectHookName,
  isReactFlushSyncCall,
  isReactHookNamed,
  isReactLazyCall,
  isReactStartTransitionCall,
  isReactSuspenseElement,
  isReactUseCall,
  isReactUseTransitionCall,
  reactEffectPhase,
  recognizeReactHook,
  recognizeReactRenderBoundary,
};
export type { ReactEffectHookName } from "./hooks.js";

export function reactFramework(): FrameworkPlugin {
  return {
    id: "react",
    version: "0.1.0",
    packageNames: ["react"],
    recognizeHook(call: SurfaceCall, ctx: FrameworkCtx): HookCall | undefined {
      return recognizeReactHook(call, ctx);
    },
    recognizeRenderBoundary(
      node: SurfaceNode,
      ctx: FrameworkCtx,
    ): RenderBoundary | undefined {
      return recognizeReactRenderBoundary(node, ctx);
    },
    classifyComponent(
      decl: SurfaceDecl,
      _ctx: FrameworkCtx,
    ): ComponentRole | undefined {
      if (isCustomHookDeclaration(decl)) return "custom-hook";
      const name = componentNameFor(decl);
      if (name && startsUppercase(name)) return "component";
      return undefined;
    },
  };
}

registerFrameworkPlugin(reactFramework());
import "./source-extraction.js";

export default reactFramework;
