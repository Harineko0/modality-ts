import type {
  FrameworkCtx,
  FrameworkPlugin,
  HookCall,
  RenderBoundary,
  SurfaceCall,
  SurfaceDecl,
  SurfaceNode,
} from "modality-ts/extract/engine/spi";
import { registerFrameworkPlugin } from "modality-ts/extract/engine/spi";
import { createFrameworkPlugin } from "modality-ts/extract/plugins";
import {
  isReactEffectHookName,
  isReactHookNamed,
  recognizeReactHook,
} from "./hooks.js";
import {
  isReactFlushSyncCall,
  isReactLazyCall,
  isReactStartTransitionCall,
  isReactSuspenseElement,
  isReactUseCall,
  isReactUseTransitionCall,
  recognizeReactRenderBoundary,
  SUSPENSE_DOMAIN,
} from "./render-boundaries.js";
import { classifySurfaceComponent } from "./surface-components.js";

export type { ReactEffectHookName } from "./hooks.js";
export {
  isReactEffectHookName,
  isReactFlushSyncCall,
  isReactHookNamed,
  isReactLazyCall,
  isReactStartTransitionCall,
  isReactSuspenseElement,
  isReactUseCall,
  isReactUseTransitionCall,
  recognizeReactHook,
  recognizeReactRenderBoundary,
  SUSPENSE_DOMAIN,
};

export function reactFramework(): FrameworkPlugin {
  const base = createFrameworkPlugin({
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
    classifyComponent(decl: SurfaceDecl, _ctx: FrameworkCtx) {
      return classifySurfaceComponent(decl);
    },
  });
  return base;
}

registerFrameworkPlugin(reactFramework());

export default reactFramework;
