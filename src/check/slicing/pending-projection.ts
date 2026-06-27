import type {
  EffectIR,
  ExprIR,
  Model,
  StateVarDecl,
  Transition,
} from "modality-ts/core";
import { isEmptyEffect } from "./effect-projection.js";

/**
 * Per-property projection of the pending async queue.
 *
 * After cone-of-influence slicing, a property's slice still retains the whole
 * pending-queue variable with its full inner `opId` domain, plus every async
 * resolution transition — even resolutions of operations the property cannot
 * observe (their continuation writes a variable that was sliced away). Those
 * irrelevant operations still get enqueued and resolved, so the reachable
 * pending queue ranges over all ~25 op kinds and blows up the state space
 * (ordered tuples of up to `maxPending` records).
 *
 * An operation is *relevant* to a slice only if resolving it writes a variable
 * the property observes, or the property's step-facts name it directly. The
 * presence of an *irrelevant* operation in the queue is unobservable: its
 * continuation writes nothing in the slice, and the only side effect of it
 * occupying a queue slot is the model's `maxPending` back-pressure — a modeling
 * bound, not real application behavior. Dropping irrelevant operations from the
 * queue (their enqueues and their resolutions) therefore preserves every
 * observable trajectory while collapsing the queue domain to the handful of
 * operations the property actually depends on.
 */
export function projectPendingQueueForSlice(
  slice: Model,
  options: { propertyOpIds?: readonly string[] } = {},
): Model {
  const pendingVarIds = new Set(
    slice.vars
      .filter((decl) => decl.role?.kind === "pending-queue")
      .map((decl) => decl.id),
  );
  if (pendingVarIds.size === 0) return slice;

  const relevantOps = new Set(options.propertyOpIds ?? []);
  for (const transition of slice.transitions) {
    const resolvedOp = resolutionOpId(transition, pendingVarIds);
    if (resolvedOp === undefined) continue;
    // A resolution that writes a non-pending (observed) variable keeps its op.
    if (transition.writes.some((write) => !pendingVarIds.has(write))) {
      relevantOps.add(resolvedOp);
    }
  }

  // Every op kind that can ever be enqueued in this slice; if all of them are
  // relevant there is nothing to project.
  const enqueuedOps = collectEnqueuedOps(slice.transitions);
  if ([...enqueuedOps].every((op) => relevantOps.has(op))) {
    return slice;
  }

  const transitions: Transition[] = [];
  for (const transition of slice.transitions) {
    const resolvedOp = resolutionOpId(transition, pendingVarIds);
    // Drop resolutions of irrelevant ops outright: with their enqueues removed
    // the op never reaches the queue, so the transition is dead.
    if (resolvedOp !== undefined && !relevantOps.has(resolvedOp)) {
      continue;
    }
    const effect = stripIrrelevantEnqueues(transition.effect, relevantOps);
    const writes = recomputeQueueWrites(transition, effect, pendingVarIds);
    if (writes.length === 0 && isEmptyEffect(effect)) {
      continue;
    }
    transitions.push({ ...transition, effect, writes });
  }

  const vars = slice.vars.map((decl) =>
    pendingVarIds.has(decl.id) ? narrowPendingDomain(decl, relevantOps) : decl,
  );

  return { ...slice, vars, transitions };
}

/**
 * If a transition's guard matches the head op id of a pending queue
 * (`pending[0].opId == X`), return X — it is an async resolution of op X.
 */
function resolutionOpId(
  transition: Transition,
  pendingVarIds: ReadonlySet<string>,
): string | undefined {
  return guardHeadOpId(transition.guard, pendingVarIds);
}

function guardHeadOpId(
  expr: ExprIR,
  pendingVarIds: ReadonlySet<string>,
): string | undefined {
  switch (expr.kind) {
    case "eq": {
      const [left, right] = expr.args;
      const op = headOpIdLiteral(left, right) ?? headOpIdLiteral(right, left);
      if (op && readsPendingHeadOpId(op.read, pendingVarIds)) {
        return op.value;
      }
      return undefined;
    }
    case "and":
    case "or": {
      for (const arg of expr.args) {
        const found = guardHeadOpId(arg, pendingVarIds);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    case "not":
      return guardHeadOpId(expr.args[0], pendingVarIds);
    default:
      return undefined;
  }
}

function headOpIdLiteral(
  read: ExprIR,
  lit: ExprIR,
): { read: ExprIR; value: string } | undefined {
  if (
    read.kind === "read" &&
    lit.kind === "lit" &&
    typeof lit.value === "string"
  ) {
    return { read, value: lit.value };
  }
  return undefined;
}

function readsPendingHeadOpId(
  read: ExprIR,
  pendingVarIds: ReadonlySet<string>,
): boolean {
  return (
    read.kind === "read" &&
    pendingVarIds.has(read.var) &&
    Array.isArray(read.path) &&
    read.path.length === 2 &&
    read.path[1] === "opId"
  );
}

function collectEnqueuedOps(transitions: readonly Transition[]): Set<string> {
  const ops = new Set<string>();
  for (const transition of transitions) {
    walkEffect(transition.effect, (node) => {
      if (node.kind === "enqueue") ops.add(node.op);
    });
  }
  return ops;
}

function stripIrrelevantEnqueues(
  effect: EffectIR,
  relevantOps: ReadonlySet<string>,
): EffectIR {
  switch (effect.kind) {
    case "enqueue":
      return relevantOps.has(effect.op) ? effect : { kind: "seq", effects: [] };
    case "seq": {
      const effects = effect.effects
        .map((child) => stripIrrelevantEnqueues(child, relevantOps))
        .filter(
          (child) => !(child.kind === "seq" && child.effects.length === 0),
        );
      if (effects.length === 0) return { kind: "seq", effects: [] };
      if (effects.length === 1) return effects[0]!;
      return { kind: "seq", effects };
    }
    case "if":
      return {
        kind: "if",
        cond: effect.cond,
        // biome-ignore lint/suspicious/noThenProperty: Effect IR uses a "then" field.
        then: stripIrrelevantEnqueues(effect.then, relevantOps),
        else: stripIrrelevantEnqueues(effect.else, relevantOps),
      };
    default:
      return effect;
  }
}

function recomputeQueueWrites(
  transition: Transition,
  effect: EffectIR,
  pendingVarIds: ReadonlySet<string>,
): string[] {
  let touchesQueue = false;
  walkEffect(effect, (node) => {
    if (node.kind === "enqueue" || node.kind === "dequeue") touchesQueue = true;
  });
  const writes = transition.writes.filter((write) => !pendingVarIds.has(write));
  if (touchesQueue) {
    for (const write of transition.writes) {
      if (pendingVarIds.has(write)) writes.push(write);
    }
  }
  return [...new Set(writes)].sort();
}

function narrowPendingDomain(
  decl: StateVarDecl,
  relevantOps: ReadonlySet<string>,
): StateVarDecl {
  if (decl.domain.kind !== "boundedList") return decl;
  const inner = decl.domain.inner;
  if (inner.kind !== "record" || !inner.fields.opId) return decl;
  const opIdDomain = inner.fields.opId;
  if (opIdDomain.kind !== "enum") return decl;
  const narrowed = opIdDomain.values.filter((value) => relevantOps.has(value));
  // Never narrow to an empty enum: with no relevant ops the queue is already
  // unreachable beyond empty (no enqueues survive), so the declared domain is
  // harmless, and an empty enum would trip pending-queue domain validation.
  if (narrowed.length === 0 || narrowed.length === opIdDomain.values.length) {
    return decl;
  }
  return {
    ...decl,
    domain: {
      ...decl.domain,
      inner: {
        ...inner,
        fields: {
          ...inner.fields,
          opId: { kind: "enum", values: narrowed },
        },
      },
    },
  };
}

function walkEffect(effect: EffectIR, visit: (node: EffectIR) => void): void {
  visit(effect);
  switch (effect.kind) {
    case "seq":
      for (const child of effect.effects) walkEffect(child, visit);
      return;
    case "if":
      walkEffect(effect.then, visit);
      walkEffect(effect.else, visit);
      return;
    default:
      return;
  }
}
