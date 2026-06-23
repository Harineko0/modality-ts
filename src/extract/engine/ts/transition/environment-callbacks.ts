import type { EffectIR, StateVarDecl } from "modality-ts/core";
import type * as ts from "typescript";
import type { WebSocketEnvironmentConfig } from "../environment-config.js";
import type { EffectSummary, ExtractableHandler } from "../types.js";

const WEBSOCKET_DOMAIN = {
  kind: "enum" as const,
  values: ["idle", "connecting", "open", "closed", "error"],
};

type WebSocketLifecycleEvent = "open" | "close" | "error" | "message";

export interface WebSocketRegistration {
  varId: string;
  url?: string;
  config?: WebSocketEnvironmentConfig;
  registrationIndex: number;
  registeredEvents: Set<WebSocketLifecycleEvent>;
  messageCallbackNode?: ts.Node;
}

export interface WebSocketConstructorResult {
  registration: WebSocketRegistration;
  connectSummary: EffectSummary;
}

export interface WebSocketCallbackAssignment {
  varId: string;
  registration: WebSocketRegistration;
  event: WebSocketLifecycleEvent;
  callback: ExtractableHandler;
  node: ts.Node;
}

export function environmentStateVarDecl(varId: string): StateVarDecl {
  return {
    id: varId,
    domain: WEBSOCKET_DOMAIN,
    origin: "system",
    scope: { kind: "global" },
    role: { kind: "environment" },
    initial: "idle",
  };
}

export function webSocketVarId(
  component: string,
  context: string,
  index: number,
): string {
  return `sys:websocket:${component}.${context}#${index}`;
}

export function webSocketConnectingAssign(varId: string): EffectIR {
  return {
    kind: "assign",
    var: varId,
    expr: { kind: "lit", value: "connecting" },
  };
}

function webSocketStateAssign(varId: string, state: string): EffectIR {
  return { kind: "assign", var: varId, expr: { kind: "lit", value: state } };
}

function webSocketStateGuard(
  varId: string,
  states: readonly string[],
): import("modality-ts/core").ExprIR {
  const guards = states.map((state): import("modality-ts/core").ExprIR => ({
    kind: "eq",
    args: [
      { kind: "read", var: varId },
      { kind: "lit", value: state },
    ],
  }));
  if (guards.length === 1) return guards[0] ?? { kind: "lit", value: true };
  return { kind: "or", args: guards };
}

function lifecycleGuardStates(
  event: WebSocketLifecycleEvent,
): readonly string[] {
  switch (event) {
    case "open":
      return ["connecting", "closed"];
    case "close":
    case "error":
      return ["connecting", "open"];
    default:
      return ["open"];
  }
}

function implicitOpenTransition(
  source: ts.SourceFile,
  fileName: string,
  component: string,
  registration: WebSocketRegistration,
): import("modality-ts/core").Transition {
  const lineAndColumn = (node: ts.Node) => {
    const pos = source.getLineAndCharacterOfPosition(node.getStart(source));
    return { line: pos.line + 1, column: pos.character + 1 };
  };
  return {
    id: `${component}.websocket.onopen.implicit`,
    cls: "env",
    label: { kind: "env", key: `${component}.websocket.onopen` },
    source: registration.messageCallbackNode
      ? [{ file: fileName, ...lineAndColumn(registration.messageCallbackNode) }]
      : [],
    guard: webSocketStateGuard(
      registration.varId,
      lifecycleGuardStates("open"),
    ),
    effect: webSocketStateAssign(registration.varId, "open"),
    reads: [registration.varId],
    writes: [registration.varId],
    confidence: "exact",
  };
}

export function finalizeImplicitWebSocketOpens(
  source: ts.SourceFile,
  fileName: string,
  component: string,
  registrations: readonly WebSocketRegistration[],
  envTransitions: import("modality-ts/core").Transition[],
): void {
  for (const registration of registrations) {
    if (
      !registration.registeredEvents.has("message") ||
      registration.registeredEvents.has("open")
    ) {
      continue;
    }
    const implicit = implicitOpenTransition(
      source,
      fileName,
      component,
      registration,
    );
    const messageIndex = envTransitions.findIndex(
      (transition) =>
        transition.cls === "env" &&
        transition.label.kind === "env" &&
        transition.label.key === `${component}.websocket.onmessage` &&
        transition.reads.includes(registration.varId),
    );
    if (messageIndex >= 0) {
      envTransitions.splice(messageIndex, 0, implicit);
    } else {
      envTransitions.push(implicit);
    }
  }
}
