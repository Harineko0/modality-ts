import type { ModelState, StepFacts, Transition } from "modality-ts/core";
import type { PendingOp } from "../runtime/effects.js";
import { readPending } from "../runtime/effects.js";

export function facts(
  pre: ModelState,
  post: ModelState,
  transition: Transition,
): StepFacts {
  const before = readPending(pre);
  const after = readPending(post);
  const enqueued = after.find(
    (op) => !before.some((candidate) => sameOp(candidate, op)),
  );
  const dequeued = before.find(
    (op) => !after.some((candidate) => sameOp(candidate, op)),
  );
  return {
    transition,
    enqueued: (op) => Boolean(enqueued && enqueued.opId === op),
    resolved: (op, outcome) =>
      transition.label.kind === "resolve" &&
      transition.label.op === op &&
      (!outcome || transition.label.outcome === outcome),
    navigated: () => pre["sys:route"] !== post["sys:route"],
    navigatedTo: (route) =>
      post["sys:route"] === route && pre["sys:route"] !== route,
    op: enqueued
      ? {
          id: enqueued.opId,
          continuation: enqueued.continuation,
          args: enqueued.args,
        }
      : dequeued
        ? {
            id: dequeued.opId,
            continuation: dequeued.continuation,
            args: dequeued.args,
          }
        : undefined,
  };
}

function sameOp(a: PendingOp, b: PendingOp): boolean {
  return (
    a.opId === b.opId &&
    a.continuation === b.continuation &&
    JSON.stringify(a.args) === JSON.stringify(b.args)
  );
}
