import type * as ts from "typescript";
import type {
  EffectModelProvider,
  EffectModelRecognition,
  EffectSurfaceCall,
} from "modality-ts/extract/engine/spi";
import type { EffectCtx } from "modality-ts/extract/engine/spi";
import {
  bindTimerHandle,
  isTimerClearCall,
  isTimerScheduleCall,
  registerTimerFromScheduleCall,
  timerClearSummaryFromCall,
  timerStateVarDecl,
} from "../../engine/ts/transition/timers.js";

function recognizeTimerEffect(
  call: EffectSurfaceCall,
  ctx: EffectCtx,
): EffectModelRecognition | undefined {
  if (!ctx.component || !ctx.source || !ctx.fileName) return undefined;
  if (isTimerScheduleCall(call)) {
    const timerIndex = ctx.timerIndex?.value ?? 0;
    const registered = registerTimerFromScheduleCall(
      ctx.source,
      ctx.fileName,
      call,
      ctx.setters,
      ctx.component,
      ctx.timerContext ?? "handler",
      timerIndex,
      ctx.timerBindings ?? new Map(),
    );
    if (!registered) return undefined;
    ctx.timerRegistrations?.push(registered.registration);
    if (ctx.timerIndex) ctx.timerIndex.value += 1;
    ctx.envTransitions?.push(registered.fireTransition);
    return {
      model: {
        channel: "timer",
        enqueue: registered.scheduleSummary.effect,
        resolution: {
          domain: timerStateVarDecl(registered.registration.varId).domain,
          effect: registered.fireTransition.effect,
        },
      },
      scheduleSummary: registered.scheduleSummary,
    };
  }
  if (isTimerClearCall(call)) {
    const clearSummary = timerClearSummaryFromCall(
      call,
      ctx.timerBindings ?? new Map(),
    );
    if (!clearSummary) return undefined;
    return {
      model: {
        channel: "timer",
        enqueue: clearSummary.effect,
        resolution: {
          domain: timerStateVarDecl("").domain,
          effect: clearSummary.effect,
        },
      },
      scheduleSummary: clearSummary,
    };
  }
  return undefined;
}

export function timerEffectModelProvider(): EffectModelProvider {
  return {
    id: "timers",
    version: "0.1.0",
    packageNames: [],
    kind: "effect-model",
    recognizeEffect: recognizeTimerEffect,
  };
}

export function bindTimerDeclaration(
  declaration: ts.VariableDeclaration,
  timerVarIdValue: string,
  bindings: Map<string, string>,
): void {
  bindTimerHandle(declaration, timerVarIdValue, bindings);
}

export default timerEffectModelProvider;
