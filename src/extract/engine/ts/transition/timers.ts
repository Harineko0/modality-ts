import * as ts from "typescript";
import { callName, isUseRefCall, lineAndColumn } from "../ast.js";
import { handlerExpression } from "../components.js";
import { safeId, uniqueStrings } from "../ids.js";
import type {
  EffectIR,
  ExprIR,
  Locator,
  StateVarDecl,
  Transition,
} from "modality-ts/core";
import type {
  ExtractableHandler,
  EffectSummary,
  SetterBinding,
} from "../types.js";
import { effectWriteVars, settersWrittenIn, uniqueSetters } from "./effects.js";
import { stateNameForVar } from "./handlers.js";
import { summarizeHandlerStatements } from "./statement-summary.js";
import { labelForEvent } from "./ui.js";

const TIMER_DOMAIN = { kind: "enum" as const, values: ["idle", "scheduled"] };

export interface TimerRegistration {
  varId: string;
  scheduleEffect: EffectIR;
  cancelEffect: EffectIR;
}

export function timerVarId(
  component: string,
  context: string,
  index: number,
): string {
  return `sys:timer:${component}.${context}#${index}`;
}

export function isTimerClearCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const name = callName(node.expression);
  return name === "clearTimeout" || name === "clearInterval";
}

export function isTimerScheduleCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const name = callName(node.expression);
  return name === "setTimeout" || name === "setInterval";
}

export function timerScheduledGuard(varId: string): ExprIR {
  return {
    kind: "eq",
    args: [
      { kind: "read", var: varId },
      { kind: "lit", value: "scheduled" },
    ],
  };
}

export function timerScheduledAssign(varId: string): EffectIR {
  return {
    kind: "assign",
    var: varId,
    expr: { kind: "lit", value: "scheduled" },
  };
}

export function timerIdleAssign(varId: string): EffectIR {
  return {
    kind: "assign",
    var: varId,
    expr: { kind: "lit", value: "idle" },
  };
}

export function bindTimerHandle(
  node: ts.VariableDeclaration,
  timerVarIdValue: string,
  bindings: Map<string, string>,
): void {
  if (ts.isIdentifier(node.name)) {
    bindings.set(node.name.text, timerVarIdValue);
  }
}

export function resolveTimerVarFromClearArg(
  argument: ts.Expression | undefined,
  bindings: Map<string, string>,
): string | undefined {
  if (!argument || !ts.isIdentifier(argument)) return undefined;
  return bindings.get(argument.text);
}

export interface TimerScheduleResult {
  registration: TimerRegistration;
  scheduleSummary: EffectSummary;
  fireTransition: Transition;
}

export function registerTimerFromScheduleCall(
  source: ts.SourceFile,
  fileName: string,
  node: ts.CallExpression,
  setters: Map<string, SetterBinding>,
  component: string,
  context = "handler",
  timerIndex = 0,
  bindings: Map<string, string> = new Map(),
): TimerScheduleResult | undefined {
  if (!isTimerScheduleCall(node)) return undefined;
  const name = callName(node.expression);
  if (name !== "setTimeout" && name !== "setInterval") return undefined;
  const callback = node.arguments[0];
  if (
    !callback ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  ) {
    return undefined;
  }
  const summaries = timerCallbackSummaries(callback, setters);
  if (!summaries || summaries.length === 0) return undefined;
  const effects = summaries.map((summary) => summary.effect);
  const writes = uniqueStrings(effects.flatMap(effectWriteVars));
  const suffix =
    writes.map((id) => stateNameForVar(id, setters) ?? safeId(id)).join("_") ||
    "callback";
  const varId = timerVarId(component, `${context}.${suffix}`, timerIndex);
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent)) {
    bindTimerHandle(parent, varId, bindings);
  }
  const idleEffect = timerIdleAssign(varId);
  const callbackEffects =
    effects.length === 1 ? effects[0] : { kind: "seq" as const, effects };
  const fireEffect: EffectIR =
    name === "setInterval"
      ? { kind: "seq", effects: [callbackEffects] }
      : { kind: "seq", effects: [idleEffect, callbackEffects] };
  const registration: TimerRegistration = {
    varId,
    scheduleEffect: timerScheduledAssign(varId),
    cancelEffect: timerIdleAssign(varId),
  };
  return {
    registration,
    scheduleSummary: {
      effect: registration.scheduleEffect,
      reads: [],
    },
    fireTransition: {
      id: `${component}.${name}.${suffix}`,
      cls: "env",
      label: { kind: "timer", key: `${component}.${name}.${suffix}` },
      source: [{ file: fileName, ...lineAndColumn(source, node) }],
      guard: timerScheduledGuard(varId),
      effect: fireEffect,
      reads: uniqueStrings([varId, ...summaries.flatMap((s) => s.reads)]),
      writes: uniqueStrings([varId, ...writes]),
      confidence: effects.some((effect) => effect.kind === "havoc")
        ? "over-approx"
        : "exact",
    },
  };
}

export function timerClearSummaryFromCall(
  node: ts.CallExpression,
  bindings: Map<string, string>,
): EffectSummary | undefined {
  if (!isTimerClearCall(node)) return undefined;
  const varId = resolveTimerVarFromClearArg(node.arguments[0], bindings);
  if (!varId) return undefined;
  return {
    effect: timerIdleAssign(varId),
    reads: [varId],
  };
}

export function transitionsFromTimerCall(
  source: ts.SourceFile,
  fileName: string,
  node: ts.Node,
  setters: Map<string, SetterBinding>,
  component: string,
  context = "handler",
  timerIndex = 0,
  bindings: Map<string, string> = new Map(),
): { transitions: Transition[]; registration: TimerRegistration | undefined } {
  if (!ts.isCallExpression(node) || !isTimerScheduleCall(node)) {
    return { transitions: [], registration: undefined };
  }
  const registered = registerTimerFromScheduleCall(
    source,
    fileName,
    node,
    setters,
    component,
    context,
    timerIndex,
    bindings,
  );
  if (!registered) return { transitions: [], registration: undefined };
  return {
    registration: registered.registration,
    transitions: [registered.fireTransition],
  };
}

export function transitionFromTimerClear(
  source: ts.SourceFile,
  fileName: string,
  node: ts.CallExpression,
  component: string,
  bindings: Map<string, string>,
): Transition | undefined {
  if (!isTimerClearCall(node)) return undefined;
  const varId = resolveTimerVarFromClearArg(node.arguments[0], bindings);
  if (!varId) return undefined;
  const name = callName(node.expression) ?? "clearTimeout";
  return {
    id: `${component}.${name}.${varId.split(":").at(-1)}`,
    cls: "internal",
    label: { kind: "internal", text: `${component}.${name}` },
    source: [{ file: fileName, ...lineAndColumn(source, node) }],
    guard: { kind: "lit", value: true },
    effect: timerIdleAssign(varId),
    reads: [varId],
    writes: [varId],
    confidence: "exact",
  };
}

export function timerStateVarDecl(varId: string): StateVarDecl {
  return {
    id: varId,
    domain: TIMER_DOMAIN,
    origin: "system",
    scope: { kind: "global" },
    initial: "idle",
  };
}

export function timerScheduleTransition(
  source: ts.SourceFile,
  fileName: string,
  attribute: ts.JsxAttribute,
  component: string,
  attr: string,
  registration: TimerRegistration,
  locator: Locator | undefined,
): Transition {
  return {
    id: `${component}.${attr}.schedule.${registration.varId.split(":").at(-1)}`,
    cls: "user",
    label: labelForEvent(attr, locator),
    source: [{ file: fileName, ...lineAndColumn(source, attribute) }],
    guard: { kind: "lit", value: true },
    effect: registration.scheduleEffect,
    reads: [],
    writes: [registration.varId],
    confidence: "exact",
  };
}

export function refSetterTaint(
  node: ts.Node,
  setters: Map<string, SetterBinding>,
): { varId: string; node: ts.Node } | undefined {
  if (
    ts.isVariableDeclaration(node) &&
    node.initializer &&
    isUseRefCall(node.initializer)
  ) {
    const arg = node.initializer.arguments[0];
    if (arg && ts.isIdentifier(arg)) {
      const setter = setters.get(arg.text);
      if (setter) return { varId: setter.varId, node: arg };
    }
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isPropertyAccessExpression(node.left) &&
    node.left.name.text === "current" &&
    ts.isIdentifier(node.right)
  ) {
    const setter = setters.get(node.right.text);
    if (setter) return { varId: setter.varId, node: node.right };
  }
  return undefined;
}

export function timerSetterTaints(
  node: ts.Node,
  setters: Map<string, SetterBinding>,
): { varId: string; node: ts.Node }[] {
  if (!ts.isCallExpression(node)) return [];
  const name = callName(node.expression);
  if (name !== "setTimeout" && name !== "setInterval") return [];
  const callback = node.arguments[0];
  if (
    !callback ||
    (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
  )
    return [];
  if (timerCallbackSummaries(callback, setters)) return [];
  return uniqueSetters(settersWrittenIn(callback.body, setters)).map(
    (setter) => ({ varId: setter.varId, node: callback }),
  );
}

export function timerCallbackSummaries(
  callback: ExtractableHandler,
  setters: Map<string, SetterBinding>,
): EffectSummary[] | undefined {
  return summarizeHandlerStatements(callback, setters);
}

export function handlerSchedulesModeledTimer(
  attribute: ts.JsxAttribute,
  handlers: Map<string, ExtractableHandler>,
  setters: Map<string, SetterBinding>,
): boolean {
  if (!attribute.initializer) return false;
  const expression = ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression
    : undefined;
  const handler = handlerExpression(expression, handlers);
  if (!handler) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression);
      const callback = node.arguments[0];
      if (
        (name === "setTimeout" || name === "setInterval") &&
        callback &&
        (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
        timerCallbackSummaries(callback, setters)
      ) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(handler.body);
  return found;
}
