import type {
  EffectModelAssignmentRecognition,
  EffectModelProvider,
  EffectModelRecognition,
  EffectSurfaceCall,
} from "modality-ts/extract/engine/spi";
import type { EffectCtx } from "modality-ts/extract/engine/spi";
import * as ts from "typescript";
import {
  bindWebSocketHandle,
  environmentStateVarDecl,
  isWebSocketCallbackAssignment,
  isWebSocketConstructor,
  registerWebSocketCallbackAssignment,
  registerWebSocketConstructor,
  webSocketCleanupSummaryFromCall,
} from "../../engine/ts/transition/environment-callbacks.js";

export function websocketEffectModelProvider(): EffectModelProvider {
  return {
    id: "websocket",
    version: "0.1.0",
    packageNames: [],
    kind: "effect-model",
    recognizeEffect(
      call: EffectSurfaceCall,
      ctx: EffectCtx,
    ): EffectModelRecognition | undefined {
      if (!ctx.component || !ctx.source || !ctx.fileName) return undefined;
      if (ts.isNewExpression(call) && isWebSocketConstructor(call)) {
        const webSocketIndex = ctx.webSocketIndex?.value ?? 0;
        const registered = registerWebSocketConstructor(
          ctx.source,
          ctx.fileName,
          call,
          ctx.component,
          ctx.timerContext ?? "handler",
          webSocketIndex,
          ctx.webSocketBindings ?? new Map(),
          ctx.environment,
        );
        if (!registered) return undefined;
        ctx.webSocketRegistrations?.push(registered.registration);
        if (ctx.webSocketIndex) ctx.webSocketIndex.value += 1;
        return {
          model: {
            channel: "websocket",
            enqueue: registered.connectSummary.effect,
            resolution: {
              domain: environmentStateVarDecl(registered.registration.varId)
                .domain,
              effect: registered.connectSummary.effect,
            },
          },
          scheduleSummary: registered.connectSummary,
        };
      }
      if (ts.isCallExpression(call)) {
        const cleanup = webSocketCleanupSummaryFromCall(
          call,
          ctx.webSocketBindings ?? new Map(),
        );
        if (cleanup) {
          return {
            model: {
              channel: "websocket",
              enqueue: cleanup.effect,
              resolution: {
                domain: environmentStateVarDecl("").domain,
                effect: cleanup.effect,
              },
            },
            scheduleSummary: cleanup,
          };
        }
      }
      return undefined;
    },
    recognizeEffectAssignment(
      statement: ts.ExpressionStatement,
      ctx: EffectCtx,
    ): EffectModelAssignmentRecognition | undefined {
      if (!ctx.component || !ctx.source || !ctx.fileName) return undefined;
      const webSocketAssignment = isWebSocketCallbackAssignment(
        statement,
        ctx.webSocketBindings ?? new Map(),
        ctx.webSocketRegistrations ?? [],
      );
      if (!webSocketAssignment) return undefined;
      const registered = registerWebSocketCallbackAssignment(
        ctx.source,
        ctx.fileName,
        webSocketAssignment,
        ctx.setters,
        ctx.component,
        {
          handlers: ctx.handlers,
          resetSymbols: ctx.resetSymbols,
          snapshotReads: ctx.snapshotReads,
          snapshottedReads: ctx.snapshottedReads,
          component: ctx.component,
          timerContext: ctx.timerContext,
          timerIndex: ctx.timerIndex,
          timerBindings: ctx.timerBindings,
          timerRegistrations: ctx.timerRegistrations,
          webSocketRegistrations: ctx.webSocketRegistrations,
          webSocketBindings: ctx.webSocketBindings,
          webSocketIndex: ctx.webSocketIndex,
          environment: ctx.environment,
          transitionBindings: ctx.transitionBindings,
          envTransitions: ctx.envTransitions,
          fileName: ctx.fileName,
          source: ctx.source,
        },
        ctx.environment,
      );
      for (const transition of registered.transitions) {
        ctx.envTransitions?.push(transition);
      }
      ctx.warnings?.push(...registered.warnings);
      return { scheduleSummaries: [] };
    },
  };
}

export function bindWebSocketDeclaration(
  declaration: ts.VariableDeclaration,
  webSocketVarId: string,
  bindings: Map<string, string>,
): void {
  if (ts.isIdentifier(declaration.name)) {
    bindWebSocketHandle(declaration, webSocketVarId, bindings);
  }
}

export default websocketEffectModelProvider;
