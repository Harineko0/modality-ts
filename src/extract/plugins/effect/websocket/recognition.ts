import type {
  EffectIR,
  SourceAnchor,
  Transition,
  Value,
} from "modality-ts/core";
import * as ts from "typescript";
import {
  isExtractableHandler,
  lineAndColumn,
  literalValue,
} from "../../../engine/ts/ast.js";
import { modelSlackCaveat } from "../../../engine/ts/caveats.js";
import type {
  EnvironmentEventConfig,
  WebSocketEnvironmentConfig,
  WebSocketMessageVariant,
} from "../../../engine/ts/environment-config.js";
import { safeId, uniqueStrings } from "../../../engine/ts/ids.js";
import type {
  BoundExpr,
  EffectSummary,
  ExtractableHandler,
  ExtractionWarning,
  SetterBinding,
} from "../../../engine/ts/types.js";
import { stateNameForVar } from "../../../engine/ts/transition/handlers.js";
import type { StatementSummaryOptions } from "../../../engine/ts/transition/statement-driver.js";
import {
  effectWriteVars,
  simplifyEffect,
  summarizeHandlerStatements,
  summarizeStatements,
} from "../../../engine/ts/transition/statement-driver.js";
import {
  type WebSocketCallbackAssignment,
  type WebSocketConstructorResult,
  type WebSocketRegistration,
  webSocketConnectingAssign,
  webSocketVarId,
} from "../../../engine/ts/transition/environment-callbacks.js";

type WebSocketLifecycleEvent = "open" | "close" | "error" | "message";

const WEBSOCKET_DOMAIN = {
  kind: "enum" as const,
  values: ["idle", "connecting", "open", "closed", "error"],
};

export function isWebSocketConstructor(
  node: ts.Node,
): node is ts.NewExpression {
  return (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "WebSocket"
  );
}

export function bindWebSocketHandle(
  declaration: ts.VariableDeclaration,
  varId: string,
  bindings: Map<string, string>,
): void {
  if (ts.isIdentifier(declaration.name)) {
    bindings.set(declaration.name.text, varId);
  }
}

export function resolveWebSocketVarFromHandle(
  handle: ts.Expression,
  bindings: Map<string, string>,
): string | undefined {
  if (!ts.isIdentifier(handle)) return undefined;
  return bindings.get(handle.text);
}

export function matchWebSocketConfig(
  environment: EnvironmentEventConfig | undefined,
  registrationIndex: number,
  url?: string,
  configId?: string,
): WebSocketEnvironmentConfig | undefined {
  const sockets = environment?.webSockets ?? [];
  if (configId) {
    const byId = sockets.find((entry) => entry.id === configId);
    if (byId) return byId;
  }
  if (url) {
    const byUrl = sockets.find((entry) => entry.url === url);
    if (byUrl) return byUrl;
  }
  return sockets[registrationIndex];
}

function webSocketUrlSuffix(argument: ts.Expression | undefined): string {
  const literal = argument ? literalValue(argument) : undefined;
  if (typeof literal === "string") return safeId(literal);
  return "socket";
}

export function registerWebSocketConstructor(
  _source: ts.SourceFile,
  _fileName: string,
  node: ts.NewExpression,
  component: string,
  context: string,
  registrationIndex: number,
  bindings: Map<string, string>,
  environment?: EnvironmentEventConfig,
): WebSocketConstructorResult | undefined {
  if (!isWebSocketConstructor(node)) return undefined;
  const urlArgument = node.arguments?.[0];
  const urlLiteral = urlArgument ? literalValue(urlArgument) : undefined;
  const url = typeof urlLiteral === "string" ? urlLiteral : undefined;
  const suffix = webSocketUrlSuffix(urlArgument);
  const varId = webSocketVarId(
    component,
    `${context}.${suffix}`,
    registrationIndex,
  );
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent)) {
    bindWebSocketHandle(parent, varId, bindings);
  }
  const config = matchWebSocketConfig(environment, registrationIndex, url);
  const registration: WebSocketRegistration = {
    varId,
    ...(url ? { url } : {}),
    ...(config ? { config } : {}),
    registrationIndex,
    registeredEvents: new Set(),
  };
  return {
    registration,
    connectSummary: {
      effect: webSocketConnectingAssign(varId),
      reads: [],
    },
  };
}

function callbackFromNode(node: ts.Expression): ExtractableHandler | undefined {
  if (isExtractableHandler(node)) return node;
  return undefined;
}

function lifecycleEventFromProperty(
  name: string,
): WebSocketLifecycleEvent | undefined {
  switch (name) {
    case "onopen":
      return "open";
    case "onclose":
      return "close";
    case "onerror":
      return "error";
    case "onmessage":
      return "message";
    default:
      return undefined;
  }
}

function isAddEventListenerCall(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  return call.expression.name.text === "addEventListener";
}

export function isWebSocketCallbackAssignment(
  statement: ts.Statement,
  bindings: Map<string, string>,
  registrations: readonly WebSocketRegistration[],
): WebSocketCallbackAssignment | undefined {
  if (ts.isExpressionStatement(statement)) {
    const expression = statement.expression;
    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(expression.left)
    ) {
      const event = lifecycleEventFromProperty(expression.left.name.text);
      const varId = resolveWebSocketVarFromHandle(
        expression.left.expression,
        bindings,
      );
      const callback = callbackFromNode(expression.right);
      const registration = registrations.find((entry) => entry.varId === varId);
      if (event && varId && callback && registration) {
        return { varId, registration, event, callback, node: statement };
      }
    }
    const call = ts.isCallExpression(expression) ? expression : undefined;
    if (call && isAddEventListenerCall(call)) {
      const handle = ts.isPropertyAccessExpression(call.expression)
        ? call.expression.expression
        : undefined;
      const varId = handle
        ? resolveWebSocketVarFromHandle(handle, bindings)
        : undefined;
      const eventLiteral = literalValue(call.arguments[0]);
      const callback = callbackFromNode(call.arguments[1]);
      const registration = registrations.find((entry) => entry.varId === varId);
      const event =
        typeof eventLiteral === "string"
          ? (eventLiteral as WebSocketLifecycleEvent)
          : undefined;
      if (
        event &&
        varId &&
        callback &&
        registration &&
        (event === "open" ||
          event === "close" ||
          event === "error" ||
          event === "message")
      ) {
        return { varId, registration, event, callback, node: statement };
      }
    }
  }
  return undefined;
}

export function webSocketCleanupSummaryFromCall(
  call: ts.CallExpression,
  bindings: Map<string, string>,
): EffectSummary | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  if (call.expression.name.text !== "close") return undefined;
  const varId = resolveWebSocketVarFromHandle(
    call.expression.expression,
    bindings,
  );
  if (!varId) return undefined;
  return {
    effect: { kind: "assign", var: varId, expr: { kind: "lit", value: "closed" } },
    reads: [varId],
  };
}

export function webSocketSetterTaints(
  statement: ts.Statement,
  setters: Map<string, SetterBinding>,
  bindings: Map<string, string>,
  registrations: readonly WebSocketRegistration[],
): boolean {
  const assignment = isWebSocketCallbackAssignment(
    statement,
    bindings,
    registrations,
  );
  if (!assignment) return false;
  if (assignment.event === "message") return false;
  const summaries = callbackSummaries(assignment.callback, setters, {}, new Map());
  return !summaries || summaries.length === 0;
}

function webSocketStateAssign(varId: string, state: string): EffectIR {
  return { kind: "assign", var: varId, expr: { kind: "lit", value: state } };
}

function webSocketStateGuard(
  varId: string,
  states: readonly string[],
): import("modality-ts/core").ExprIR {
  const guards = states.map(
    (state): import("modality-ts/core").ExprIR => ({
      kind: "eq",
      args: [{ kind: "read", var: varId }, { kind: "lit", value: state }],
    }),
  );
  if (guards.length === 1) return guards[0] ?? { kind: "lit", value: true };
  return { kind: "or", args: guards };
}

function lifecycleStateForEvent(event: WebSocketLifecycleEvent): string {
  switch (event) {
    case "open": return "open";
    case "close": return "closed";
    case "error": return "error";
    default: return "open";
  }
}

function lifecycleGuardStates(
  event: WebSocketLifecycleEvent,
): readonly string[] {
  switch (event) {
    case "open": return ["connecting", "closed"];
    case "close":
    case "error": return ["connecting", "open"];
    default: return ["open"];
  }
}

function callbackSummaries(
  callback: ExtractableHandler,
  setters: Map<string, SetterBinding>,
  options: StatementSummaryOptions,
  initialLocals: Map<string, BoundExpr>,
): EffectSummary[] | undefined {
  if (ts.isCallExpression(callback.body)) {
    return summarizeHandlerStatements(callback, setters, { ...options, initialLocals });
  }
  if (!ts.isBlock(callback.body)) return undefined;
  return summarizeStatements(callback.body.statements, setters, { ...options, initialLocals });
}

function transitionConfidence(effects: readonly EffectIR[]): Transition["confidence"] {
  return effects.some((effect) => effect.kind === "havoc") ? "over-approx" : "exact";
}

function sourceAnchor(source: ts.SourceFile, fileName: string, node: ts.Node): SourceAnchor {
  return { file: fileName, ...lineAndColumn(source, node) };
}

function lifecycleTransition(
  source: ts.SourceFile,
  fileName: string,
  component: string,
  assignment: WebSocketCallbackAssignment,
  setters: Map<string, SetterBinding>,
  options: StatementSummaryOptions,
): Transition | undefined {
  const summaries = callbackSummaries(assignment.callback, setters, options, new Map());
  if (!summaries || summaries.length === 0) return undefined;
  const effects = summaries.map((s) => s.effect);
  const writes = uniqueStrings(effects.flatMap(effectWriteVars));
  const suffix =
    writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_") || "callback";
  const nextState = lifecycleStateForEvent(assignment.event);
  const callbackEffects: EffectIR =
    effects.length === 1 ? effects[0] : { kind: "seq", effects };
  const fireEffect: EffectIR = {
    kind: "seq",
    effects: [webSocketStateAssign(assignment.varId, nextState), callbackEffects],
  };
  const eventKey = assignment.event === "message" ? "onmessage" : `on${assignment.event}`;
  return {
    id: `${component}.websocket.${eventKey}.${suffix}`,
    cls: "env",
    label: { kind: "env", key: `${component}.websocket.${eventKey}` },
    source: [{ file: fileName, ...lineAndColumn(source, assignment.node) }],
    guard: webSocketStateGuard(assignment.varId, lifecycleGuardStates(assignment.event)),
    effect: fireEffect,
    reads: uniqueStrings([assignment.varId, ...summaries.flatMap((s) => s.reads)]),
    writes: uniqueStrings([assignment.varId, ...writes]),
    confidence: transitionConfidence(effects),
  };
}

function messageRecordForVariant(variant: WebSocketMessageVariant): Record<string, Value> {
  return { type: variant.type, ...(variant.bind ?? {}) };
}

function callbackEventParamName(callback: ExtractableHandler): string | undefined {
  const firstParam = callback.parameters[0];
  if (!firstParam || !ts.isIdentifier(firstParam.name)) return undefined;
  return firstParam.name.text;
}

function isJsonParseExpression(expression: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "JSON" &&
    expression.name.text === "parse"
  );
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression)) return unwrapExpression(expression.expression);
  return expression;
}

function isEventDataAccess(expression: ts.Expression, eventParamName: string): boolean {
  const unwrapped = unwrapExpression(expression);
  if (
    ts.isPropertyAccessExpression(unwrapped) &&
    unwrapped.name.text === "data" &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === eventParamName
  )
    return true;
  if (
    ts.isCallExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === "String" &&
    unwrapped.arguments[0]
  )
    return isEventDataAccess(unwrapped.arguments[0], eventParamName);
  return false;
}

function isAnyEventDataAccess(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (
    ts.isPropertyAccessExpression(unwrapped) &&
    unwrapped.name.text === "data" &&
    ts.isIdentifier(unwrapped.expression)
  )
    return true;
  if (
    ts.isCallExpression(unwrapped) &&
    ts.isIdentifier(unwrapped.expression) &&
    unwrapped.expression.text === "String" &&
    unwrapped.arguments[0]
  )
    return isAnyEventDataAccess(unwrapped.arguments[0]);
  return false;
}

function bindJsonParseEventData(initializer: ts.Expression, eventParamName: string): boolean {
  const unwrapped = unwrapExpression(initializer);
  if (!ts.isCallExpression(unwrapped)) return false;
  if (!isJsonParseExpression(unwrapped.expression)) return false;
  const argument = unwrapExpression(unwrapped.arguments[0]);
  if (!argument) return false;
  return isEventDataAccess(argument, eventParamName);
}

function isJsonParseOfDataAccess(initializer: ts.Expression): boolean {
  const unwrapped = unwrapExpression(initializer);
  if (!ts.isCallExpression(unwrapped)) return false;
  if (!isJsonParseExpression(unwrapped.expression)) return false;
  const argument = unwrapExpression(unwrapped.arguments[0]);
  if (!argument) return false;
  return isAnyEventDataAccess(argument);
}

function hasUnsupportedJsonParseBinding(callback: ExtractableHandler): boolean {
  const eventParamName = callbackEventParamName(callback);
  if (!ts.isBlock(callback.body)) return false;
  return callback.body.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some((declaration) => {
        if (!declaration.initializer) return false;
        return (
          isJsonParseOfDataAccess(declaration.initializer) &&
          (!eventParamName || !bindJsonParseEventData(declaration.initializer, eventParamName))
        );
      }),
  );
}

function bindMessageLocalsForVariant(
  callback: ExtractableHandler,
  variant: WebSocketMessageVariant,
): Map<string, BoundExpr> {
  const locals = new Map<string, BoundExpr>();
  const eventParamName = callbackEventParamName(callback);
  if (!eventParamName) return locals;
  const messageRecord = messageRecordForVariant(variant);
  const messageBinding: BoundExpr = { expr: { kind: "lit", value: messageRecord }, reads: [] };
  if (!ts.isBlock(callback.body)) return locals;
  for (const statement of callback.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      if (bindJsonParseEventData(declaration.initializer, eventParamName)) {
        locals.set(declaration.name.text, messageBinding);
      }
    }
  }
  return locals;
}

function messageVariantTransition(
  source: ts.SourceFile,
  fileName: string,
  component: string,
  assignment: WebSocketCallbackAssignment,
  variant: WebSocketMessageVariant,
  setters: Map<string, SetterBinding>,
  options: StatementSummaryOptions,
): Transition | undefined {
  const initialLocals = bindMessageLocalsForVariant(assignment.callback, variant);
  if (!initialLocals.size && hasUnsupportedJsonParseBinding(assignment.callback)) {
    return undefined;
  }
  const summaries = callbackSummaries(assignment.callback, setters, options, initialLocals);
  if (!summaries || summaries.length === 0) return undefined;
  const effects = summaries.map((s) => s.effect);
  const writes = uniqueStrings(effects.flatMap(effectWriteVars));
  const suffix =
    writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_") || variant.type;
  const rawCallbackEffects: EffectIR =
    effects.length === 1 ? effects[0] : { kind: "seq", effects };
  const callbackEffects = simplifyEffect(rawCallbackEffects);
  return {
    id: `${component}.websocket.onmessage.${variant.type}.${suffix}`,
    cls: "env",
    label: { kind: "env", key: `${component}.websocket.onmessage`, outcome: variant.type },
    source: [{ file: fileName, ...lineAndColumn(source, assignment.node) }],
    guard: webSocketStateGuard(assignment.varId, ["open"]),
    effect: callbackEffects,
    reads: uniqueStrings([assignment.varId, ...summaries.flatMap((s) => s.reads)]),
    writes: uniqueStrings(writes),
    confidence: transitionConfidence(effects),
  };
}

export function registerWebSocketCallbackAssignment(
  source: ts.SourceFile,
  fileName: string,
  assignment: WebSocketCallbackAssignment,
  setters: Map<string, SetterBinding>,
  component: string,
  options: StatementSummaryOptions,
  environment?: EnvironmentEventConfig,
): { transitions: Transition[]; warnings: ExtractionWarning[] } {
  const warnings: ExtractionWarning[] = [];
  const anchor = sourceAnchor(source, fileName, assignment.node);
  assignment.registration.registeredEvents.add(assignment.event);
  if (assignment.event === "message") {
    assignment.registration.messageCallbackNode = assignment.node;
    const config =
      assignment.registration.config ??
      matchWebSocketConfig(
        environment,
        assignment.registration.registrationIndex,
        assignment.registration.url,
      );
    const variants = config?.messages ?? [];
    if (variants.length === 0) {
      const summaries = callbackSummaries(assignment.callback, setters, options, new Map());
      const writes = uniqueStrings(
        (summaries ?? []).flatMap((s) => effectWriteVars(s.effect)),
      );
      if (writes.length > 0) {
        warnings.push({
          message: `WebSocket onmessage handler ${component} has no configured message variants`,
          ...lineAndColumn(source, assignment.node),
          caveat: modelSlackCaveat(
            `${component}.websocket.onmessage`,
            `WebSocket onmessage handler has no configured message variants`,
            anchor,
          ),
        });
      }
      return { transitions: [], warnings };
    }
    const transitions = variants
      .map((variant) =>
        messageVariantTransition(source, fileName, component, assignment, variant, setters, options),
      )
      .filter((t): t is Transition => Boolean(t));
    if (transitions.length === 0 && variants.length > 0) {
      warnings.push({
        message: `Unsupported WebSocket onmessage payload binding ${component}`,
        ...lineAndColumn(source, assignment.node),
        caveat: modelSlackCaveat(
          `${component}.websocket.onmessage`,
          "Unsupported WebSocket onmessage payload binding",
          anchor,
        ),
      });
    }
    return { transitions, warnings };
  }
  const transition = lifecycleTransition(source, fileName, component, assignment, setters, options);
  if (!transition) {
    warnings.push({
      message: `Unsupported WebSocket ${assignment.event} callback ${component}`,
      ...lineAndColumn(source, assignment.node),
      caveat: modelSlackCaveat(
        `${component}.websocket.on${assignment.event}`,
        `Unsupported WebSocket ${assignment.event} callback body`,
        anchor,
      ),
    });
    return { transitions: [], warnings };
  }
  return { transitions: [transition], warnings };
}

export { WEBSOCKET_DOMAIN };
