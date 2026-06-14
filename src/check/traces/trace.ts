import type { EventLabel, ModelState, Trace, TraceStep, Transition } from "modality-ts/core";
import type { Parent, PropertyVerdict } from "../types.js";
import { diff } from "../engine/state-utils.js";

export function traceTo(parents: Map<string, Parent>, canon: string): Trace {
  const steps: TraceStep[] = [];
  let current: string | null = canon;
  while (current) {
    const parent = parents.get(current);
    if (!parent) break;
    if (parent.parent && parent.transition && parent.pre) {
      steps.push(makeTraceStep(parent.pre, parent.post, parent.transition));
    }
    current = parent.parent;
  }
  return { steps: steps.reverse() };
}

export function makeTraceStep(pre: ModelState, post: ModelState, transition: Transition): TraceStep {
  return { transitionId: transition.id, label: transition.label, pre, post, diff: diff(pre, post) };
}

export function replayCheckedVerdict(
  status: "violated" | "reachable",
  property: string,
  trace: Trace
): Extract<PropertyVerdict, { status: "violated" | "reachable" }> {
  const replayBlockedReason = replayBlockedReasonForTrace(trace);
  if (!replayBlockedReason) return { status, property, trace };
  return { status, property, trace, replayable: false, replayBlockedReason };
}

function replayBlockedReasonForTrace(trace: Trace): string | undefined {
  const blocked = trace.steps
    .filter((step) => requiresLocator(step.label) && !step.label.locator)
    .map((step) => `${step.transitionId}:${step.label.kind}`);
  if (blocked.length === 0) return undefined;
  return `trace contains locatorless replay steps: ${blocked.join(", ")}`;
}

function requiresLocator(label: EventLabel): label is Extract<EventLabel, { kind: "click" | "submit" | "input" }> {
  return label.kind === "click" || label.kind === "submit" || label.kind === "input";
}
