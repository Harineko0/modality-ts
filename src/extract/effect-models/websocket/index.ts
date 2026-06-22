import type {
  EffectAssignmentRecognition,
  EffectCtx,
  EffectPlugin,
  EffectRecognition,
  EffectSurfaceCall,
} from "modality-ts/extract/engine/spi";
import { findNodeAt } from "modality-ts/extract/lang/ts";
import { createEffectPlugin } from "modality-ts/extract/plugins";
import * as ts from "typescript";
import {
  bindWebSocketHandle,
  environmentStateVarDecl,
  isWebSocketCallbackAssignment,
  isWebSocketConstructor,
  registerWebSocketCallbackAssignment,
  registerWebSocketConstructor,
  type WebSocketRegistration,
  webSocketCleanupSummaryFromCall,
} from "../../engine/ts/transition/environment-callbacks.js";
import type { SetterBinding } from "../../engine/ts/types.js";

export function websocketEffectPlugin(): EffectPlugin {
  return createEffectPlugin({
    id: "websocket",
    version: "0.1.0",
    packageNames: [],
    recognizeEffect(
      call: EffectSurfaceCall,
      ctx: EffectCtx,
    ): EffectRecognition | undefined {
      const tsCall = call as unknown as ts.CallExpression | ts.NewExpression;
      const runtime = ctx as EffectCtx & {
        source?: ts.SourceFile;
        timerContext?: string;
        webSocketIndex?: { value: number };
        webSocketBindings?: Map<string, string>;
        webSocketRegistrations?: WebSocketRegistration[];
        environment?: import("../../engine/ts/environment-config.js").EnvironmentEventConfig;
        setters:
          | Map<string, SetterBinding>
          | ReadonlyMap<string, SetterBinding>;
        handlers?: Map<
          string,
          import("../../engine/ts/types.js").ExtractableHandler
        >;
        resetSymbols?: ReadonlySet<string>;
        snapshotReads?: boolean;
        snapshottedReads?: ReadonlySet<string>;
        timerBindings?: Map<string, string>;
        timerRegistrations?: import("../../engine/ts/transition/timers.js").TimerRegistration[];
        transitionBindings?: Map<
          string,
          import("../../engine/ts/transition/concurrent.js").TransitionBinding
        >;
        envTransitions?: import("modality-ts/core").Transition[];
        warnings?: import("../../engine/ts/types.js").ExtractionWarning[];
      };
      if (!runtime.component || !runtime.source || !runtime.fileName)
        return undefined;
      if (ts.isNewExpression(tsCall) && isWebSocketConstructor(tsCall)) {
        const webSocketIndex = runtime.webSocketIndex?.value ?? 0;
        const registered = registerWebSocketConstructor(
          runtime.source,
          runtime.fileName,
          tsCall,
          runtime.component,
          runtime.timerContext ?? "handler",
          webSocketIndex,
          runtime.webSocketBindings ?? new Map(),
          runtime.environment,
        );
        if (!registered) return undefined;
        runtime.webSocketRegistrations?.push(registered.registration);
        if (runtime.webSocketIndex) runtime.webSocketIndex.value += 1;
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
      if (ts.isCallExpression(tsCall)) {
        const cleanup = webSocketCleanupSummaryFromCall(
          tsCall,
          runtime.webSocketBindings ?? new Map(),
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
        const callbackStatement = ts.isExpressionStatement(tsCall.parent)
          ? tsCall.parent
          : ts.factory.createExpressionStatement(tsCall);
        const callback = registerWebSocketCallbackFromStatement(
          callbackStatement,
          runtime,
        );
        if (callback) return callback;
      }
      return undefined;
    },
    recognizeEffectAssignment(
      statement: import("modality-ts/extract/lang/ts").SurfaceStmt,
      ctx: EffectCtx,
    ): EffectAssignmentRecognition | undefined {
      if (statement.kind !== "assign") return undefined;
      const runtime = ctx as EffectCtx & {
        source?: ts.SourceFile;
        component?: string;
        fileName?: string;
        setters:
          | Map<string, SetterBinding>
          | ReadonlyMap<string, SetterBinding>;
        webSocketBindings?: Map<string, string>;
        webSocketRegistrations?: WebSocketRegistration[];
        handlers?: Map<
          string,
          import("../../engine/ts/types.js").ExtractableHandler
        >;
        resetSymbols?: ReadonlySet<string>;
        snapshotReads?: boolean;
        snapshottedReads?: ReadonlySet<string>;
        timerContext?: string;
        timerIndex?: { value: number };
        timerBindings?: Map<string, string>;
        timerRegistrations?: import("../../engine/ts/transition/timers.js").TimerRegistration[];
        webSocketIndex?: { value: number };
        environment?: import("../../engine/ts/environment-config.js").EnvironmentEventConfig;
        transitionBindings?: Map<
          string,
          import("../../engine/ts/transition/concurrent.js").TransitionBinding
        >;
        envTransitions?: import("modality-ts/core").Transition[];
        warnings?: import("../../engine/ts/types.js").ExtractionWarning[];
      };
      if (!runtime.component || !runtime.source || !runtime.fileName)
        return undefined;
      const tsStatement = surfaceAssignToExpressionStatement(
        statement,
        runtime.source,
      );
      if (!tsStatement) return undefined;
      const setters = new Map([...runtime.setters.entries()] as [
        string,
        SetterBinding,
      ][]);
      const webSocketAssignment = isWebSocketCallbackAssignment(
        tsStatement,
        runtime.webSocketBindings ?? new Map(),
        runtime.webSocketRegistrations ?? [],
      );
      if (!webSocketAssignment) return undefined;
      const registered = registerWebSocketCallbackAssignment(
        runtime.source,
        runtime.fileName,
        webSocketAssignment,
        setters,
        runtime.component,
        {
          handlers: runtime.handlers,
          resetSymbols: runtime.resetSymbols,
          snapshotReads: runtime.snapshotReads,
          snapshottedReads: runtime.snapshottedReads,
          component: runtime.component,
          timerContext: runtime.timerContext,
          timerIndex: runtime.timerIndex,
          timerBindings: runtime.timerBindings,
          timerRegistrations: runtime.timerRegistrations,
          webSocketRegistrations: runtime.webSocketRegistrations,
          webSocketBindings: runtime.webSocketBindings,
          webSocketIndex: runtime.webSocketIndex,
          environment: runtime.environment,
          transitionBindings: runtime.transitionBindings,
          envTransitions: runtime.envTransitions,
          fileName: runtime.fileName,
          source: runtime.source,
        },
        runtime.environment,
      );
      for (const transition of registered.transitions) {
        runtime.envTransitions?.push(transition);
      }
      runtime.warnings?.push(...registered.warnings);
      return { scheduleSummaries: [] };
    },
  });
}

function registerWebSocketCallbackFromStatement(
  statement: ts.ExpressionStatement,
  runtime: EffectCtx & {
    source?: ts.SourceFile;
    component?: string;
    fileName?: string;
    setters: Map<string, SetterBinding> | ReadonlyMap<string, SetterBinding>;
    webSocketBindings?: Map<string, string>;
    webSocketRegistrations?: WebSocketRegistration[];
    handlers?: Map<
      string,
      import("../../engine/ts/types.js").ExtractableHandler
    >;
    resetSymbols?: ReadonlySet<string>;
    snapshotReads?: boolean;
    snapshottedReads?: ReadonlySet<string>;
    timerContext?: string;
    timerIndex?: { value: number };
    timerBindings?: Map<string, string>;
    timerRegistrations?: import("../../engine/ts/transition/timers.js").TimerRegistration[];
    webSocketIndex?: { value: number };
    environment?: import("../../engine/ts/environment-config.js").EnvironmentEventConfig;
    transitionBindings?: Map<
      string,
      import("../../engine/ts/transition/concurrent.js").TransitionBinding
    >;
    envTransitions?: import("modality-ts/core").Transition[];
    warnings?: import("../../engine/ts/types.js").ExtractionWarning[];
  },
): EffectRecognition | undefined {
  if (!runtime.component || !runtime.source || !runtime.fileName) {
    return undefined;
  }
  const setters = new Map([...runtime.setters.entries()] as [
    string,
    SetterBinding,
  ][]);
  const webSocketAssignment = isWebSocketCallbackAssignment(
    statement,
    runtime.webSocketBindings ?? new Map(),
    runtime.webSocketRegistrations ?? [],
  );
  if (!webSocketAssignment) return undefined;
  const registered = registerWebSocketCallbackAssignment(
    runtime.source,
    runtime.fileName,
    webSocketAssignment,
    setters,
    runtime.component,
    {
      handlers: runtime.handlers,
      resetSymbols: runtime.resetSymbols,
      snapshotReads: runtime.snapshotReads,
      snapshottedReads: runtime.snapshottedReads,
      component: runtime.component,
      timerContext: runtime.timerContext,
      timerIndex: runtime.timerIndex,
      timerBindings: runtime.timerBindings,
      timerRegistrations: runtime.timerRegistrations,
      webSocketRegistrations: runtime.webSocketRegistrations,
      webSocketBindings: runtime.webSocketBindings,
      webSocketIndex: runtime.webSocketIndex,
      environment: runtime.environment,
      transitionBindings: runtime.transitionBindings,
      envTransitions: runtime.envTransitions,
      fileName: runtime.fileName,
      source: runtime.source,
    },
    runtime.environment,
  );
  for (const transition of registered.transitions) {
    runtime.envTransitions?.push(transition);
  }
  runtime.warnings?.push(...registered.warnings);
  return {
    model: {
      channel: "websocket",
      enqueue: { kind: "seq", effects: [] },
      resolution: {
        domain: environmentStateVarDecl("").domain,
        effect: { kind: "seq", effects: [] },
      },
    },
    scheduleSummary: {
      effect: { kind: "seq", effects: [] },
      reads: [],
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

export default websocketEffectPlugin;

function surfaceAssignToExpressionStatement(
  statement: import("modality-ts/extract/lang/ts").SurfaceStmt,
  source: ts.SourceFile,
): ts.ExpressionStatement | undefined {
  if (statement.kind !== "assign") return undefined;
  const node = findNodeAt(source, statement.origin);
  if (!node) return undefined;
  if (ts.isExpressionStatement(node)) return node;
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return ts.factory.createExpressionStatement(node);
  }
  return undefined;
}
