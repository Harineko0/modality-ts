import type {
  EffectCtx,
  EffectPlugin,
  EffectRecognition,
  EffectSurfaceCall,
} from "modality-ts/extract/engine/spi";
import { createEffectPlugin } from "modality-ts/extract/plugins";
import * as ts from "typescript";
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
): EffectRecognition | undefined {
  const tsCall = call as unknown as ts.CallExpression;
  if (!("flags" in tsCall) || !ts.isCallExpression(tsCall)) return undefined;
  const runtime = ctx as EffectCtx & {
    source?: ts.SourceFile;
    timerContext?: string;
    timerIndex?: { value: number };
    timerBindings?: Map<string, string>;
    timerRegistrations?: unknown[];
    envTransitions?: unknown[];
  };
  if (!runtime.component || !runtime.source || !runtime.fileName)
    return undefined;
  const setters =
    runtime.setters instanceof Map
      ? runtime.setters
      : new Map([...runtime.setters.entries()]);
  if (isTimerScheduleCall(tsCall)) {
    const timerIndex = runtime.timerIndex?.value ?? 0;
    const registered = registerTimerFromScheduleCall(
      runtime.source,
      runtime.fileName,
      tsCall,
      setters,
      runtime.component,
      runtime.timerContext ?? "handler",
      timerIndex,
      runtime.timerBindings ?? new Map(),
    );
    if (!registered) return undefined;
    runtime.timerRegistrations?.push(registered.registration);
    if (runtime.timerIndex) runtime.timerIndex.value += 1;
    runtime.envTransitions?.push(registered.fireTransition);
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
  if (isTimerClearCall(tsCall)) {
    const clearSummary = timerClearSummaryFromCall(
      tsCall,
      runtime.timerBindings ?? new Map(),
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

export function timerEffectPlugin(): EffectPlugin {
  return createEffectPlugin({
    id: "timers",
    version: "0.1.0",
    packageNames: [],
    recognizeEffect: recognizeTimerEffect,
  });
}

export function bindTimerDeclaration(
  declaration: ts.VariableDeclaration,
  timerVarIdValue: string,
  bindings: Map<string, string>,
): void {
  bindTimerHandle(declaration, timerVarIdValue, bindings);
}

export default timerEffectPlugin;
