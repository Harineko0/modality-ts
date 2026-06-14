import type {
  EventLabel,
  Model,
  ModelState,
  Trace,
  TraceStep,
  Transition,
} from "modality-ts/core";
import type { Parent, PropertyVerdict } from "../types.js";
import { diff } from "../engine/state-utils.js";

export interface TraceContext {
  model: Model;
  parents: Map<string, Parent>;
  states: Map<string, ModelState>;
}

export function traceTo(ctx: TraceContext, canon: string): Trace {
  const steps: TraceStep[] = [];
  let current: string | null = canon;
  while (current) {
    const parent = ctx.parents.get(current);
    if (!parent) break;
    if (parent.parent && parent.transitionId) {
      const pre = ctx.states.get(parent.parent);
      const post = ctx.states.get(current);
      const transition = ctx.model.transitions.find(
        (candidate) => candidate.id === parent.transitionId,
      );
      if (pre && post && transition) {
        steps.push(makeTraceStep(pre, post, transition));
      }
    }
    current = parent.parent;
  }
  return { steps: steps.reverse() };
}

export function makeTraceStep(
  pre: ModelState,
  post: ModelState,
  transition: Transition,
): TraceStep {
  return {
    transitionId: transition.id,
    label: transition.label,
    pre,
    post,
    diff: diff(pre, post),
  };
}

export function replayCheckedVerdict(
  status: "violated" | "reachable",
  property: string,
  trace: Trace,
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

function requiresLocator(
  label: EventLabel,
): label is Extract<EventLabel, { kind: "click" | "submit" | "input" }> {
  return (
    label.kind === "click" || label.kind === "submit" || label.kind === "input"
  );
}
