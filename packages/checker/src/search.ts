import { canonicalState, initialValues, validateModel } from "@modality/kernel";
import type { Model, ModelState, Property, StepFacts, Trace, TraceStep, Transition, Value } from "@modality/kernel";
import { applyEffect, guardHolds, readPending } from "./eval.js";
import type { PendingOp } from "./eval.js";

export type PropertyVerdict =
  | { status: "verified-within-bounds"; property: string }
  | { status: "violated"; property: string; trace: Trace }
  | { status: "reachable"; property: string; trace: Trace }
  | { status: "vacuous-warning"; property: string; message: string }
  | { status: "error"; property: string; message: string };

export interface CheckResult {
  verdicts: PropertyVerdict[];
  stats: { states: number; edges: number; depth: number };
}

interface Parent {
  parent: string | null;
  transition: Transition | null;
  pre: ModelState | null;
  post: ModelState;
}

interface Edge {
  preCanon: string;
  postCanon: string;
  pre: ModelState;
  post: ModelState;
  transition: Transition;
  step: StepFacts;
}

export function checkModel(model: Model, properties: readonly Property[]): CheckResult {
  const validation = validateModel(model);
  if (!validation.ok) {
    return {
      verdicts: properties.map((property) => ({ status: "error", property: property.name, message: validation.errors.join("; ") })),
      stats: { states: 0, edges: 0, depth: 0 }
    };
  }

  installEnabledHook(model);
  const parents = new Map<string, Parent>();
  const states = new Map<string, ModelState>();
  const edges: Edge[] = [];
  let frontier = initialStates(model);
  frontier = frontier.flatMap((state) => stabilize(model, state));
  frontier.sort(compareStates(model));
  for (const state of frontier) {
    const canon = canonicalState(model, state);
    if (!parents.has(canon)) {
      parents.set(canon, { parent: null, transition: null, pre: null, post: state });
      states.set(canon, state);
    }
  }

  const verdicts = new Map<string, PropertyVerdict>();
  let depth = 0;
  let edgeCount = 0;
  observeStates(model, properties, frontier, parents, verdicts);

  while (frontier.length > 0 && depth < model.bounds.maxDepth) {
    const next: ModelState[] = [];
    for (const pre of frontier) {
      const preCanon = canonicalState(model, pre);
      for (const transition of enabledTransitions(model, pre)) {
        for (const rawPost of applyEffect(model, pre, transition.effect)) {
          for (const post of stabilize(model, rawPost)) {
            edgeCount += 1;
            const postCanon = canonicalState(model, post);
            const step = facts(pre, post, transition);
            edges.push({ preCanon, postCanon, pre, post, transition, step });
            observeEdge(model, properties, pre, post, transition, step, parents, verdicts);
            if (!parents.has(postCanon)) {
              parents.set(postCanon, { parent: preCanon, transition, pre, post });
              states.set(postCanon, post);
              next.push(post);
            }
          }
        }
      }
    }
    frontier = next.sort(compareStates(model));
    observeStates(model, properties, frontier, parents, verdicts);
    depth += 1;
  }

  finalizeProperties(model, properties, parents, states, edges, verdicts);
  return {
    verdicts: properties.map((property) => verdicts.get(property.name) ?? { status: "verified-within-bounds", property: property.name }),
    stats: { states: parents.size, edges: edgeCount, depth }
  };
}

function initialStates(model: Model): ModelState[] {
  return model.vars.reduce<ModelState[]>((states, decl) => {
    const initials = initialValues(decl.domain, decl.initial);
    return states.flatMap((state) => initials.map((value) => ({ ...state, [decl.id]: value })));
  }, [{}]);
}

function enabledTransitions(model: Model, state: ModelState): Transition[] {
  return [...model.transitions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((transition) => transition.cls !== "internal" && guardHolds(model, transition, state));
}

function stabilize(model: Model, state: ModelState): ModelState[] {
  let states = [state];
  for (let i = 0; i < model.bounds.maxInternalSteps; i += 1) {
    const next: ModelState[] = [];
    let changed = false;
    for (const candidate of states) {
      const internal = model.transitions
        .filter((transition) => transition.cls === "internal" && guardHolds(model, transition, candidate))
        .sort((a, b) => a.id.localeCompare(b.id));
      if (internal.length === 0) {
        next.push(candidate);
      } else {
        changed = true;
        next.push(...applyEffect(model, candidate, internal[0].effect));
      }
    }
    states = uniqueStates(model, next);
    if (!changed) return states;
  }
  throw new Error(`Internal transitions did not stabilize within ${model.bounds.maxInternalSteps} steps`);
}

function observeStates(
  model: Model,
  properties: readonly Property[],
  candidates: readonly ModelState[],
  parents: Map<string, Parent>,
  verdicts: Map<string, PropertyVerdict>
): void {
  for (const state of candidates) {
    const canon = canonicalState(model, state);
    for (const property of properties) {
      if (verdicts.has(property.name)) continue;
      try {
        if (property.kind === "always" && !property.predicate(state)) {
          verdicts.set(property.name, { status: "violated", property: property.name, trace: traceTo(parents, canon) });
        }
        if (property.kind === "reachable" && property.predicate(state)) {
          verdicts.set(property.name, { status: "reachable", property: property.name, trace: traceTo(parents, canon) });
        }
      } catch (error) {
        verdicts.set(property.name, { status: "error", property: property.name, message: (error as Error).message });
      }
    }
  }
}

function observeEdge(
  model: Model,
  properties: readonly Property[],
  pre: ModelState,
  post: ModelState,
  transition: Transition,
  step: StepFacts,
  parents: Map<string, Parent>,
  verdicts: Map<string, PropertyVerdict>
): void {
  for (const property of properties) {
    if (verdicts.has(property.name)) continue;
    if (property.kind !== "alwaysStep") continue;
    try {
      if (!property.predicate(pre, step, post)) {
        const preCanon = canonicalState(model, pre);
        verdicts.set(property.name, {
          status: "violated",
          property: property.name,
          trace: { steps: [...traceTo(parents, preCanon).steps, makeTraceStep(pre, post, transition)] }
        });
      }
    } catch (error) {
      verdicts.set(property.name, { status: "error", property: property.name, message: (error as Error).message });
    }
  }
}

function finalizeProperties(
  model: Model,
  properties: readonly Property[],
  parents: Map<string, Parent>,
  states: Map<string, ModelState>,
  edges: readonly Edge[],
  verdicts: Map<string, PropertyVerdict>
): void {
  for (const property of properties) {
    if (verdicts.has(property.name)) continue;
    if (property.kind === "reachable") {
      verdicts.set(property.name, { status: "vacuous-warning", property: property.name, message: "No reachable witness within bounds" });
    }
    if (property.kind === "reachableFrom") {
      const goalCanons = [...states].filter(([, state]) => property.goal(state)).map(([canon]) => canon);
      const backward = new Set(goalCanons);
      let changed = true;
      while (changed) {
        changed = false;
        for (const edge of edges) {
          if (backward.has(edge.postCanon) && !backward.has(edge.preCanon)) {
            backward.add(edge.preCanon);
            changed = true;
          }
        }
      }
      const witness = [...states].find(([canon, state]) => property.when(state) && !backward.has(canon));
      if (witness) {
        verdicts.set(property.name, { status: "violated", property: property.name, trace: traceTo(parents, witness[0]) });
      }
    }
    if (property.kind === "leadsToWithin") {
      const triggerEdges = edges.filter((edge) => property.trigger(edge.step));
      const failure = triggerEdges.find((edge) => !goalWithin(model, property, edge.post, edges));
      if (failure) {
        verdicts.set(property.name, {
          status: "violated",
          property: property.name,
          trace: { steps: [...traceTo(parents, failure.preCanon).steps, makeTraceStep(failure.pre, failure.post, failure.transition)] }
        });
      }
    }
  }
}

function goalWithin(model: Model, property: Extract<Property, { kind: "leadsToWithin" }>, start: ModelState, graphEdges: readonly Edge[]): boolean {
  const maxSteps = property.budget.steps ?? property.budget.environment ?? 0;
  const queue: Array<{ state: ModelState; depth: number }> = [{ state: start, depth: 0 }];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    const canon = canonicalState(model, current.state);
    if (property.goal(current.state)) return true;
    if (current.depth >= maxSteps) return false;
    if (seen.has(`${canon}:${current.depth}`)) continue;
    seen.add(`${canon}:${current.depth}`);
    const successors = graphEdges.filter((edge) => edge.preCanon === canon && (property.allowUserEvents || edge.transition.cls === "env" || edge.transition.cls === "library"));
    if (successors.length === 0) return false;
    for (const edge of successors) queue.push({ state: edge.post, depth: current.depth + 1 });
  }
  return false;
}

function traceTo(parents: Map<string, Parent>, canon: string): Trace {
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

function makeTraceStep(pre: ModelState, post: ModelState, transition: Transition): TraceStep {
  return { transitionId: transition.id, label: transition.label, pre, post, diff: diff(pre, post) };
}

function facts(pre: ModelState, post: ModelState, transition: Transition): StepFacts {
  const before = readPending(pre);
  const after = readPending(post);
  const enqueued = after.find((op) => !before.some((candidate) => sameOp(candidate, op)));
  const dequeued = before.find((op) => !after.some((candidate) => sameOp(candidate, op)));
  return {
    transition,
    enqueued: (op) => Boolean(enqueued && enqueued.opId === op),
    resolved: (op, outcome) => transition.label.kind === "resolve" && transition.label.op === op && (!outcome || transition.label.outcome === outcome),
    navigatedTo: (route) => post["sys:route"] === route && pre["sys:route"] !== route,
    op: enqueued ? { id: enqueued.opId, continuation: enqueued.continuation, args: enqueued.args } : dequeued ? { id: dequeued.opId, continuation: dequeued.continuation, args: dequeued.args } : undefined
  };
}

function sameOp(a: PendingOp, b: PendingOp): boolean {
  return a.opId === b.opId && a.continuation === b.continuation && JSON.stringify(a.args) === JSON.stringify(b.args);
}

function diff(pre: ModelState, post: ModelState): Record<string, { before: Value | undefined; after: Value | undefined }> {
  const ids = new Set([...Object.keys(pre), ...Object.keys(post)]);
  return Object.fromEntries(
    [...ids]
      .filter((id) => JSON.stringify(pre[id]) !== JSON.stringify(post[id]))
      .map((id) => [id, { before: pre[id], after: post[id] }])
  );
}

function uniqueStates(model: Model, states: readonly ModelState[]): ModelState[] {
  const out: ModelState[] = [];
  const seen = new Set<string>();
  for (const state of states) {
    const canon = canonicalState(model, state);
    if (!seen.has(canon)) {
      seen.add(canon);
      out.push(state);
    }
  }
  return out;
}

function compareStates(model: Model): (a: ModelState, b: ModelState) => number {
  return (a, b) => canonicalState(model, a).localeCompare(canonicalState(model, b));
}

function installEnabledHook(model: Model): void {
  (globalThis as unknown as { __modalityEvalGuard: (transition: Transition, state: ModelState) => boolean }).__modalityEvalGuard = (transition, state) =>
    model.transitions.includes(transition) && guardHolds(model, transition, state);
}
