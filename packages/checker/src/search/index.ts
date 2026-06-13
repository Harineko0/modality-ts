import { canonicalState, initialValues, validateModel } from "@modality/kernel";
import type { EventLabel, Model, ModelState, Property, StepFacts, Trace, TraceStep, Transition, Value } from "@modality/kernel";
import { applyEffect, guardHolds, normalizeInitialRouteLocals, readPending } from "./eval.js";
import type { PendingOp } from "./eval.js";

export type PropertyVerdict =
  | { status: "verified-within-bounds"; property: string }
  | { status: "violated"; property: string; trace: Trace; replayable?: boolean; replayBlockedReason?: string }
  | { status: "reachable"; property: string; trace: Trace; replayable?: boolean; replayBlockedReason?: string }
  | { status: "vacuous-warning"; property: string; message: string }
  | { status: "error"; property: string; message: string };

export interface CheckResult {
  verdicts: PropertyVerdict[];
  stats: { states: number; edges: number; depth: number };
  vacuityWarnings: string[];
  boundHits: string[];
}

export interface CheckOptions {
  slicing?: boolean;
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

export function checkModel(model: Model, properties: readonly Property[], options: CheckOptions = {}): CheckResult {
  if (options.slicing && properties.length > 0 && properties.every((property) => property.reads !== undefined)) {
    return checkModelSliced(model, properties);
  }
  return checkModelCore(model, properties);
}

function checkModelCore(model: Model, properties: readonly Property[]): CheckResult {
  const validation = validateModel(model);
  if (!validation.ok) {
    return {
      verdicts: properties.map((property) => ({ status: "error", property: property.name, message: validation.errors.join("; ") })),
      stats: { states: 0, edges: 0, depth: 0 },
      vacuityWarnings: [],
      boundHits: []
    };
  }

  installEnabledHook(model);
  const parents = new Map<string, Parent>();
  const states = new Map<string, ModelState>();
  const edges: Edge[] = [];
  const enabledTransitionIds = new Set<string>();
  const boundHits = new Set<string>();
  let frontier = initialStates(model);
  frontier = frontier.flatMap((state) => stabilize(model, state, initialChangedVars(model)));
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
      const enabled = enabledTransitions(model, pre);
      for (const transition of enabled) {
        enabledTransitionIds.add(transition.id);
        const rawPosts = applyEffect(model, pre, transition.effect, { onBoundHit: () => boundHits.add(`token cap exhausted at ${transition.id}`) });
        if (rawPosts.length === 0 && effectContainsEnqueue(transition.effect)) {
          boundHits.add(`pending cap saturated at ${transition.id}`);
        }
        for (const rawPost of rawPosts) {
          for (const post of stabilize(model, rawPost, changedVars(pre, rawPost))) {
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

  recordMaxDepthBoundHits(model, frontier, enabledTransitionIds, boundHits);
  finalizeProperties(model, properties, parents, states, edges, verdicts);
  return {
    verdicts: properties.map((property) => verdicts.get(property.name) ?? { status: "verified-within-bounds", property: property.name }),
    stats: { states: parents.size, edges: edgeCount, depth },
    vacuityWarnings: vacuityWarnings(model, states, enabledTransitionIds),
    boundHits: [...boundHits].sort()
  };
}

function recordMaxDepthBoundHits(
  model: Model,
  frontier: readonly ModelState[],
  enabledTransitionIds: Set<string>,
  boundHits: Set<string>
): void {
  if (frontier.length === 0) return;
  const blockedTransitions = new Set<string>();
  for (const state of frontier) {
    for (const transition of enabledTransitions(model, state)) {
      enabledTransitionIds.add(transition.id);
      blockedTransitions.add(transition.id);
    }
  }
  for (const id of [...blockedTransitions].sort()) {
    boundHits.add(`maxDepth reached before ${id}`);
  }
}

function checkModelSliced(model: Model, properties: readonly Property[]): CheckResult {
  const groups = new Map<string, { model: Model; properties: Property[] }>();
  for (const property of properties) {
    const slice = sliceModelForProperty(model, property);
    const key = slice.vars.map((decl) => decl.id).join("\0");
    const group = groups.get(key);
    if (group) group.properties.push(property);
    else groups.set(key, { model: slice, properties: [property] });
  }
  const verdicts = new Map<string, PropertyVerdict>();
  let states = 0;
  let edges = 0;
  let depth = 0;
  const vacuity = new Set<string>();
  const boundHits = new Set<string>();
  for (const group of groups.values()) {
    const result = checkModelCore(group.model, group.properties);
    for (const verdict of result.verdicts) verdicts.set(verdict.property, verdict);
    for (const warning of result.vacuityWarnings) vacuity.add(warning);
    for (const hit of result.boundHits) boundHits.add(hit);
    states += result.stats.states;
    edges += result.stats.edges;
    depth = Math.max(depth, result.stats.depth);
  }
  return {
    verdicts: properties.map((property) => verdicts.get(property.name) ?? { status: "error", property: property.name, message: "missing sliced verdict" }),
    stats: { states, edges, depth },
    vacuityWarnings: [...vacuity].sort(),
    boundHits: [...boundHits].sort()
  };
}

export function sliceModel(model: Model, propertyReads: readonly string[]): Model {
  return sliceModelForProperty(model, { reads: propertyReads });
}

function sliceModelForProperty(model: Model, property: Pick<Property, "reads" | "enabledTransitions">): Model {
  const systemVars = new Set(model.vars.filter((decl) => decl.id.startsWith("sys:")).map((decl) => decl.id));
  const forcedTransitions = new Set(property.enabledTransitions ?? []);
  const needed = new Set([...systemVars, ...(property.reads ?? []), ...enabledTransitionVars(model, forcedTransitions)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const transition of model.transitions) {
      if (!transition.writes.some((write) => needed.has(write))) continue;
      for (const id of [...transition.reads, ...transition.writes]) {
        if (!needed.has(id)) {
          needed.add(id);
          changed = true;
        }
      }
    }
  }
  const vars = model.vars.filter((decl) => needed.has(decl.id));
  const transitions = model.transitions.filter((transition) => forcedTransitions.has(transition.id) || transition.writes.some((write) => needed.has(write)) || transition.reads.some((read) => needed.has(read)));
  return { ...model, vars, transitions };
}

function enabledTransitionVars(model: Model, transitionIds: Set<string>): string[] {
  const vars = new Set<string>();
  for (const id of transitionIds) {
    const transition = model.transitions.find((candidate) => candidate.id === id);
    if (!transition) continue;
    vars.add("sys:route");
    for (const read of transition.reads) vars.add(read);
    for (const write of transition.writes) vars.add(write);
  }
  return [...vars].sort();
}

export function modelInitialStates(model: Model): ModelState[] {
  return initialStates(model).flatMap((state) => stabilize(model, state, initialChangedVars(model))).sort(compareStates(model));
}

export function modelSuccessors(model: Model, pre: ModelState): TraceStep[] {
  return enabledTransitions(model, pre).flatMap((transition) =>
    applyEffect(model, pre, transition.effect).flatMap((rawPost) =>
      stabilize(model, rawPost, changedVars(pre, rawPost)).map((post) => makeTraceStep(pre, post, transition))
    )
  );
}

function initialStates(model: Model): ModelState[] {
  return model.vars.reduce<ModelState[]>((states, decl) => {
    const initials = initialValues(decl.domain, decl.initial);
    return states.flatMap((state) => initials.map((value) => ({ ...state, [decl.id]: value })));
  }, [{}]).flatMap((state) => normalizeInitialRouteLocals(model, state));
}

function enabledTransitions(model: Model, state: ModelState): Transition[] {
  return [...model.transitions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .filter((transition) => transition.cls !== "internal" && routeLocalMounted(model, transition, state) && guardHolds(model, transition, state));
}

interface StabilizingState {
  state: ModelState;
  changed: ReadonlySet<string>;
}

function stabilize(model: Model, state: ModelState, changed: ReadonlySet<string>): ModelState[] {
  let states: StabilizingState[] = [{ state, changed }];
  for (let i = 0; i < model.bounds.maxInternalSteps; i += 1) {
    const next: StabilizingState[] = [];
    let changed = false;
    for (const candidate of states) {
      const internal = model.transitions
        .filter((transition) => transition.cls === "internal" && routeLocalMounted(model, transition, candidate.state) && internalTriggered(transition, candidate.changed) && guardHolds(model, transition, candidate.state))
        .sort((a, b) => a.id.localeCompare(b.id));
      if (internal.length === 0) {
        next.push(candidate);
      } else {
        changed = true;
        for (const sequence of stabilizingSequences(internal)) {
          next.push(...applyInternalSequence(model, candidate.state, sequence));
        }
      }
    }
    states = uniqueStabilizingStates(model, next);
    if (!changed) return states.map((candidate) => candidate.state);
  }
  throw new Error(`Internal transitions did not stabilize within ${model.bounds.maxInternalSteps} steps`);
}

function internalTriggered(transition: Transition, changed: ReadonlySet<string>): boolean {
  if (!transition.triggeredBy || transition.triggeredBy.length === 0) return true;
  return transition.triggeredBy.some((id) => changed.has(id));
}

function stabilizingSequences(internal: readonly Transition[]): readonly Transition[][] {
  if (!hasWriteConflict(internal)) return [internal.slice()];
  return permutations(internal);
}

function applyInternalSequence(model: Model, state: ModelState, sequence: readonly Transition[]): StabilizingState[] {
  return sequence.reduce<StabilizingState[]>(
    (states, transition) =>
      states.flatMap((candidate) => {
        if (!routeLocalMounted(model, transition, candidate.state) || !guardHolds(model, transition, candidate.state)) {
          return [candidate];
        }
        return applyEffect(model, candidate.state, transition.effect).map((post) => ({
          state: post,
          changed: changedVars(state, post)
        }));
      }),
    [{ state, changed: new Set<string>() }]
  );
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length <= 1) return [values.slice()];
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const head = values[index]!;
    const tail = values.filter((_, candidateIndex) => candidateIndex !== index);
    for (const rest of permutations(tail)) out.push([head, ...rest]);
  }
  return out;
}

function hasWriteConflict(transitions: readonly Transition[]): boolean {
  for (let i = 0; i < transitions.length; i += 1) {
    for (let j = i + 1; j < transitions.length; j += 1) {
      if (intersects(transitions[i]!.writes, transitions[j]!.writes)) return true;
    }
  }
  return false;
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  const seen = new Set(left);
  return right.some((item) => seen.has(item));
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
        if (property.kind === "always" && !property.predicate(checkedState(model, property, state, "state predicate"))) {
          verdicts.set(property.name, replayCheckedVerdict("violated", property.name, traceTo(parents, canon)));
        }
        if (property.kind === "reachable" && property.predicate(checkedState(model, property, state, "state predicate"))) {
          verdicts.set(property.name, replayCheckedVerdict("reachable", property.name, traceTo(parents, canon)));
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
      if (!property.predicate(checkedState(model, property, pre, "step pre-state"), step, checkedState(model, property, post, "step post-state"))) {
        const preCanon = canonicalState(model, pre);
        verdicts.set(property.name, replayCheckedVerdict("violated", property.name, { steps: [...traceTo(parents, preCanon).steps, makeTraceStep(pre, post, transition)] }));
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
    try {
      if (property.kind === "reachable") {
        verdicts.set(property.name, { status: "vacuous-warning", property: property.name, message: "No reachable witness within bounds" });
      }
      if (property.kind === "reachableFrom") {
        const goalCanons = [...states].filter(([, state]) => property.goal(checkedState(model, property, state, "reachableFrom goal"))).map(([canon]) => canon);
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
        const witness = [...states].find(([canon, state]) => property.when(checkedState(model, property, state, "reachableFrom when")) && !backward.has(canon));
        if (witness) {
          verdicts.set(property.name, {
            status: "violated",
            property: property.name,
            trace: traceTo(parents, witness[0]),
            replayable: false,
            replayBlockedReason: "reachableFrom counterexamples assert absence of a path and are not replayable"
          });
        }
      }
      if (property.kind === "leadsToWithin") {
        const triggerEdges = edges.filter((edge) => property.trigger(edge.step));
        if (triggerEdges.length === 0) {
          verdicts.set(property.name, { status: "vacuous-warning", property: property.name, message: "Trigger never fired within bounds" });
          continue;
        }
        const failure = triggerEdges.map((edge) => ({ edge, suffix: failingSuffixWithin(model, property, edge.post, edges) })).find((candidate) => candidate.suffix);
        if (failure) {
          verdicts.set(property.name, replayCheckedVerdict("violated", property.name, {
            steps: [
              ...traceTo(parents, failure.edge.preCanon).steps,
              makeTraceStep(failure.edge.pre, failure.edge.post, failure.edge.transition),
              ...failure.suffix!.map((edge) => makeTraceStep(edge.pre, edge.post, edge.transition))
            ]
          }));
        }
      }
    } catch (error) {
      verdicts.set(property.name, { status: "error", property: property.name, message: (error as Error).message });
    }
  }
}

function failingSuffixWithin(
  model: Model,
  property: Extract<Property, { kind: "leadsToWithin" }>,
  start: ModelState,
  graphEdges: readonly Edge[]
): Edge[] | undefined {
  const maxSteps = property.budget.steps ?? property.budget.environment ?? 0;
  const memo = new Map<string, Edge[] | null>();
  const visit = (state: ModelState, depth: number): Edge[] | undefined => {
    if (property.goal(checkedState(model, property, state, "leadsToWithin goal"))) return undefined;
    const canon = canonicalState(model, state);
    const key = `${canon}:${depth}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached ?? undefined;
    const successors = graphEdges.filter((edge) => edge.preCanon === canon && schedulerAllows(property, edge.transition));
    if (successors.length === 0) {
      memo.set(key, []);
      return [];
    }
    if (depth >= maxSteps) {
      memo.set(key, [successors[0]!]);
      return [successors[0]!];
    }
    for (const edge of successors) {
      const suffix = visit(edge.post, depth + 1);
      if (suffix) {
        const failure = [edge, ...suffix];
        memo.set(key, failure);
        return failure;
      }
    }
    memo.set(key, null);
    return undefined;
  };
  return visit(start, 0);
}

function schedulerAllows(property: Extract<Property, { kind: "leadsToWithin" }>, transition: Transition): boolean {
  if (transition.cls === "env" || transition.cls === "library" || transition.cls === "internal") return true;
  return property.allowUserEvents === true && (transition.cls === "user" || transition.cls === "nav");
}

function checkedState(model: Model, property: Property, state: ModelState, context: string): ModelState {
  if (property.reads === undefined) return state;
  const allowed = allowedPropertyReads(model, property);
  return new Proxy(state, {
    get(target, key, receiver) {
      if (typeof key === "string" && !allowed.has(key)) {
        throw new Error(`${property.name}: ${context} read undeclared var ${key}`);
      }
      return Reflect.get(target, key, receiver) as unknown;
    }
  });
}

function allowedPropertyReads(model: Model, property: Pick<Property, "reads" | "enabledTransitions">): Set<string> {
  return new Set([...(property.reads ?? []), ...enabledTransitionVars(model, new Set(property.enabledTransitions ?? []))]);
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

function replayCheckedVerdict(
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

function uniqueStabilizingStates(model: Model, states: readonly StabilizingState[]): StabilizingState[] {
  const out: StabilizingState[] = [];
  const seen = new Set<string>();
  for (const candidate of states) {
    const canon = canonicalState(model, candidate.state);
    if (!seen.has(canon)) {
      seen.add(canon);
      out.push(candidate);
    }
  }
  return out;
}

function changedVars(pre: ModelState, post: ModelState): ReadonlySet<string> {
  const ids = new Set([...Object.keys(pre), ...Object.keys(post)]);
  return new Set([...ids].filter((id) => JSON.stringify(pre[id]) !== JSON.stringify(post[id])));
}

function initialChangedVars(model: Model): ReadonlySet<string> {
  return new Set(model.vars.map((decl) => decl.id));
}

function compareStates(model: Model): (a: ModelState, b: ModelState) => number {
  return (a, b) => canonicalState(model, a).localeCompare(canonicalState(model, b));
}

function installEnabledHook(model: Model): void {
  (globalThis as unknown as { __modalityEvalGuard: (transition: Transition, state: ModelState) => boolean }).__modalityEvalGuard = (transition, state) =>
    model.transitions.includes(transition) && routeLocalMounted(model, transition, state) && guardHolds(model, transition, state);
}

function vacuityWarnings(model: Model, states: Map<string, ModelState>, enabledTransitionIds: Set<string>): string[] {
  const warnings: string[] = [];
  for (const transition of model.transitions) {
    if (transition.cls !== "internal" && !enabledTransitionIds.has(transition.id)) {
      warnings.push(`transition never enabled: ${transition.id}`);
    }
  }
  for (const decl of model.vars) {
    if (decl.domain.kind !== "enum") continue;
    const inhabited = new Set([...states.values()].map((state) => state[decl.id]).filter((value): value is string => typeof value === "string"));
    for (const value of decl.domain.values) {
      if (!inhabited.has(value)) warnings.push(`enum value never inhabited: ${decl.id}=${value}`);
    }
  }
  return warnings.sort();
}

function effectContainsEnqueue(effect: Transition["effect"]): boolean {
  if (effect.kind === "enqueue") return true;
  if (effect.kind === "seq") return effect.effects.some(effectContainsEnqueue);
  if (effect.kind === "if") return effectContainsEnqueue(effect.then) || effectContainsEnqueue(effect.else);
  return false;
}

function routeLocalMounted(model: Model, transition: Transition, state: ModelState): boolean {
  const currentRoute = state["sys:route"];
  const touched = new Set([...transition.reads, ...transition.writes]);
  for (const decl of model.vars) {
    if (decl.scope.kind === "route-local" && touched.has(decl.id) && decl.scope.route !== currentRoute) {
      return false;
    }
  }
  return true;
}
