import type {
  EffectIR,
  ExprIR,
  Locator,
  StateVarDecl,
  Transition,
} from "modality-ts/core";
import * as ts from "typescript";
import { lineAndColumn } from "../ast.js";
import type { EffectSummary } from "../types.js";
import { labelForEvent } from "./ui.js";

const TIMER_DOMAIN = { kind: "enum" as const, values: ["idle", "scheduled"] };

export interface TimerRegistration {
  varId: string;
  scheduleEffect: EffectIR;
  cancelEffect: EffectIR;
}

export interface TimerScheduleResult {
  registration: TimerRegistration;
  scheduleSummary: EffectSummary;
  fireTransition: Transition;
}

export function timerVarId(
  component: string,
  context: string,
  index: number,
): string {
  return `sys:timer:${component}.${context}#${index}`;
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
