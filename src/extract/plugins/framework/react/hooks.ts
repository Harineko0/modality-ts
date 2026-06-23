import type { SourceAnchor } from "modality-ts/core";
import type {
  FrameworkCtx,
  HookCall,
  SurfaceCall,
} from "modality-ts/extract/engine/spi";
import {
  calleeNameFromCall,
  sourceAnchorFromNodeRef,
} from "modality-ts/extract/engine/spi";
import type { NodeRef } from "modality-ts/extract/lang/ts";

export type ReactEffectHookName =
  | "useEffect"
  | "useLayoutEffect"
  | "useInsertionEffect";

const EFFECT_HOOK_NAMES = new Set<string>([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
]);

export function reactEffectPhase(hookName: ReactEffectHookName): number {
  return hookName === "useEffect" ? 1 : 0;
}

function sourceAnchorFor(call: SurfaceCall, ctx: FrameworkCtx): SourceAnchor {
  return sourceAnchorFromNodeRef(call.origin, ctx.fileName);
}

function callbackHandlerRef(call: SurfaceCall): NodeRef | undefined {
  const callback = call.args[0];
  if (!callback || callback.kind === "array") return undefined;
  if ("origin" in callback) return callback.origin;
  return undefined;
}

export function recognizeReactHook(
  call: SurfaceCall,
  ctx: FrameworkCtx,
): HookCall | undefined {
  const name = calleeNameFromCall(call, ctx);
  if (!name) return undefined;
  const origin = sourceAnchorFor(call, ctx);

  if (name === "useState" || name === "useReducer" || name === "useRef") {
    return { hook: { kind: "state" }, origin };
  }
  if (EFFECT_HOOK_NAMES.has(name)) {
    return {
      hook: {
        kind: "effect",
        phase: reactEffectPhase(name as ReactEffectHookName),
      },
      origin,
    };
  }
  if (name === "useTransition") {
    return { hook: { kind: "transition" }, origin };
  }
  if (name === "startTransition") {
    return { hook: { kind: "start-transition" }, origin };
  }
  if (name === "flushSync") {
    return { hook: { kind: "flush-sync" }, origin };
  }
  if (name === "useDeferredValue") {
    return { hook: { kind: "deferred" }, origin };
  }
  if (name === "useContext") {
    return { hook: { kind: "context" }, origin };
  }
  if (name === "useCallback") {
    const handler = callbackHandlerRef(call);
    if (handler) {
      return { hook: { kind: "callback", handler }, origin };
    }
    return undefined;
  }
  return undefined;
}

export function isReactEffectHookName(
  call: SurfaceCall,
  ctx: FrameworkCtx,
): ReactEffectHookName | undefined {
  const name = calleeNameFromCall(call, ctx);
  if (!name || !EFFECT_HOOK_NAMES.has(name)) return undefined;
  return name as ReactEffectHookName;
}

export function isReactHookNamed(
  call: SurfaceCall,
  ctx: FrameworkCtx,
  expected: string,
): boolean {
  return calleeNameFromCall(call, ctx) === expected;
}
