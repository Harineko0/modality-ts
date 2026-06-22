import type {
  ExprIR,
  Model,
  ModelState,
  StateVarDecl,
  Transition,
  Value,
} from "modality-ts/core";
import {
  effectReads,
  effectReadsForModel,
  effectWrites,
  evalStatePredicate,
  exprReads,
  initialValues,
  mountGuardForScope,
  StatePredicateEvalError,
} from "modality-ts/core";
import type { MountScopeDependency } from "../types.js";
import { projectEffectToVars } from "./effect-projection.js";
import {
  analyzeDirectionalPredicate,
  type DirectionalPredicateAnalysis,
  isTransitionDirectionallyRelevant,
} from "./predicate-relevance.js";

export type DependencyEdgeKind =
  | "property-read"
  | "transition-writes-var"
  | "transition-reads-var"
  | "transition-effect-read"
  | "mount-guard-read"
  | "enabled-transition"
  | "targeted-step"
  | "pending-step-fact";

export interface ModelDependencyGraph {
  readonly model: Model;
  readonly varsById: ReadonlyMap<string, StateVarDecl>;
  readonly transitionsById: ReadonlyMap<string, Transition>;
  readonly transitionsByWrittenVar: ReadonlyMap<string, readonly Transition[]>;
  readonly pendingQueueVarIds: ReadonlySet<string>;
  readonly solePendingQueueVarId?: string;
  readonly mountLocalVars: readonly StateVarDecl[];
}

export interface StateSliceClosureInput {
  propertyReads: readonly string[];
  enabledTransitionIds: readonly string[];
  directionalPredicate?: ExprIR;
}

export interface StateSliceClosureResult {
  neededVars: Set<string>;
  neededTransitions: Set<string>;
  observationOnlyTransitions: Set<string>;
  mountScopeDependencies: readonly MountScopeDependency[];
  closureFallback?: string;
}

export interface TargetedStepSliceClosureInput {
  propertyReads: readonly string[];
  preconditionReads: readonly string[];
  postconditionReads: readonly string[];
  postMentionedVars: readonly string[];
  stepFactVars: readonly string[];
  enabledTransitionIds: readonly string[];
  targetTransitionIds: readonly string[];
}

export interface TargetedStepSliceClosureResult {
  executionVars: Set<string>;
  neededTransitions: Set<string>;
  observationOnlyTransitions: Set<string>;
  mountScopeDependencies: readonly MountScopeDependency[];
  closureFallback?: string;
}

interface MountScopeAccumulator {
  entries: Map<
    string,
    { guardReads: readonly string[]; retainedBecause: Set<string> }
  >;
}

export function buildModelDependencyGraph(model: Model): ModelDependencyGraph {
  const varsById = new Map(model.vars.map((decl) => [decl.id, decl]));
  const transitionsById = new Map(
    model.transitions.map((transition) => [transition.id, transition]),
  );
  const transitionsByWrittenVar = new Map<string, Transition[]>();
  for (const transition of model.transitions) {
    for (const write of transition.writes) {
      const bucket = transitionsByWrittenVar.get(write);
      if (bucket) bucket.push(transition);
      else transitionsByWrittenVar.set(write, [transition]);
    }
  }
  const pendingQueueVarIds = new Set(
    model.vars
      .filter((decl) => decl.role?.kind === "pending-queue")
      .map((decl) => decl.id),
  );
  const pendingQueues = [...pendingQueueVarIds];
  const solePendingQueueVarId =
    pendingQueues.length === 1 ? pendingQueues[0] : undefined;
  const mountLocalVars = model.vars.filter(
    (decl) => decl.scope.kind === "mount-local",
  );
  return {
    model,
    varsById,
    transitionsById,
    transitionsByWrittenVar,
    pendingQueueVarIds,
    solePendingQueueVarId,
    mountLocalVars,
  };
}

export function computeStateSliceClosure(
  graph: ModelDependencyGraph,
  input: StateSliceClosureInput,
): StateSliceClosureResult {
  const forcedTransitions = new Set(input.enabledTransitionIds);
  const observationOnlyTransitions = new Set(input.enabledTransitionIds);
  const neededVars = new Set([
    ...input.propertyReads,
    ...enabledTransitionSeedVars(graph, forcedTransitions),
  ]);
  const neededTransitions = new Set<string>();
  const mountAcc = createMountScopeAccumulator();
  const goalVars = new Set(neededVars);
  const seedVars = new Set(neededVars);
  const directionalAnalysis = input.directionalPredicate
    ? analyzeDirectionalPredicate(input.directionalPredicate)
    : undefined;
  const closureFallback =
    input.directionalPredicate && directionalAnalysis === undefined
      ? "directional predicate shape unsupported"
      : undefined;

  reachVarsThroughTransitions(graph, neededVars, neededTransitions, mountAcc, {
    seedVars,
    goalVars,
    directionalAnalysis,
    observationOnlyTransitions,
  });

  for (const id of forcedTransitions) {
    neededTransitions.add(id);
    addEnabledObservationGuardVars(graph, neededVars, id);
  }

  return {
    neededVars,
    neededTransitions,
    observationOnlyTransitions,
    mountScopeDependencies: finalizeMountScopeDependencies(
      mountAcc,
      neededVars,
    ),
    ...(closureFallback ? { closureFallback } : {}),
  };
}

export function computeTargetedStepSliceClosure(
  graph: ModelDependencyGraph,
  input: TargetedStepSliceClosureInput,
): TargetedStepSliceClosureResult {
  const targetIdSet = new Set(input.targetTransitionIds);
  const stepFactVarSet = new Set(input.stepFactVars);
  const postMentionedVarSet = new Set(input.postMentionedVars);
  const executionVars = new Set([
    ...input.propertyReads,
    ...input.preconditionReads,
    ...input.postconditionReads,
    ...input.stepFactVars,
    ...input.postMentionedVars,
  ]);
  const neededTransitions = new Set<string>();
  const observationOnlyTransitions = new Set<string>();
  const mountAcc = createMountScopeAccumulator();
  const goalVars = new Set(executionVars);
  const seedVars = new Set(executionVars);
  const targetEffectReads = new Set<string>();

  for (const id of input.targetTransitionIds) {
    neededTransitions.add(id);
    seedTargetTransitionVars(
      graph,
      executionVars,
      targetEffectReads,
      id,
      postMentionedVarSet,
      stepFactVarSet,
    );
  }

  for (const id of input.targetTransitionIds) {
    const transition = graph.transitionsById.get(id);
    if (!transition || targetGuardEnabledAtInitial(graph, transition)) {
      continue;
    }
    const guardAnalysis = analyzeDirectionalPredicate(transition.guard);
    if (!guardAnalysis) continue;
    reachVarsThroughTransitions(
      graph,
      executionVars,
      neededTransitions,
      mountAcc,
      {
        seedVars,
        goalVars,
        directionalAnalysis: guardAnalysis,
        directionalWriteVars: new Set(
          guardAnalysis.clauses.map((clause) => clause.var),
        ),
        observationOnlyTransitions,
      },
    );
  }

  let changed = true;
  while (changed) {
    changed = expandMountGuardDependencies(
      graph,
      executionVars,
      mountAcc,
      seedVars,
    );
  }

  for (const id of input.enabledTransitionIds) {
    if (targetIdSet.has(id)) continue;
    neededTransitions.add(id);
    observationOnlyTransitions.add(id);
    addEnabledObservationGuardVars(graph, executionVars, id);
  }

  const internalWriteObsVars = new Set([
    ...input.propertyReads,
    ...input.preconditionReads,
    ...input.postconditionReads,
    ...targetEffectReads,
  ]);

  for (const transition of graph.model.transitions) {
    if (transition.cls !== "internal") continue;
    if (!transition.triggeredBy?.some((varId) => executionVars.has(varId))) {
      continue;
    }
    if (!transition.writes.some((write) => internalWriteObsVars.has(write))) {
      continue;
    }
    neededTransitions.add(transition.id);
    addTransitionSemanticVars(graph, executionVars, transition.id);
  }

  return {
    executionVars,
    neededTransitions,
    observationOnlyTransitions,
    mountScopeDependencies: finalizeMountScopeDependencies(
      mountAcc,
      executionVars,
    ),
  };
}

export function enabledTransitionGuardVars(
  graph: ModelDependencyGraph,
  transitionIds: ReadonlySet<string>,
): string[] {
  const vars = new Set<string>();
  for (const id of transitionIds) {
    const transition = graph.transitionsById.get(id);
    if (!transition) continue;
    for (const read of exprReads(transition.guard)) vars.add(read);
  }
  expandMountGuardReads(graph, vars);
  return [...vars].sort();
}

export function enabledTransitionSeedVars(
  graph: ModelDependencyGraph,
  transitionIds: ReadonlySet<string>,
): string[] {
  return enabledTransitionGuardVars(graph, transitionIds);
}

function reachVarsThroughTransitions(
  graph: ModelDependencyGraph,
  neededVars: Set<string>,
  neededTransitions: Set<string>,
  mountAcc: MountScopeAccumulator,
  options: {
    seedVars: ReadonlySet<string>;
    goalVars: ReadonlySet<string>;
    directionalAnalysis?: DirectionalPredicateAnalysis;
    directionalWriteVars?: ReadonlySet<string>;
    observationOnlyTransitions?: ReadonlySet<string>;
  },
): void {
  let changed = true;
  while (changed) {
    changed = false;
    if (
      expandMountGuardDependencies(
        graph,
        neededVars,
        mountAcc,
        options.seedVars,
      )
    ) {
      changed = true;
    }
    for (const transition of graph.model.transitions) {
      const neededWrites = transition.writes.filter((write) => {
        if (!neededVars.has(write)) return false;
        if (
          options.directionalWriteVars &&
          !options.directionalWriteVars.has(write)
        ) {
          return false;
        }
        return true;
      });
      if (neededWrites.length === 0) continue;
      if (
        shouldSkipUnrelatedHavocTransition(
          transition,
          neededWrites,
          options.goalVars,
          options.observationOnlyTransitions,
        )
      ) {
        continue;
      }
      if (options.directionalAnalysis) {
        const relevant = isTransitionDirectionallyRelevant(
          transition,
          neededWrites,
          options.directionalAnalysis,
        );
        if (!relevant) continue;
      }
      if (!neededTransitions.has(transition.id)) {
        neededTransitions.add(transition.id);
        changed = true;
      }
      if (addRetainedTransitionInputs(graph, neededVars, transition)) {
        changed = true;
      }
    }
  }
}

/**
 * Add the variables that genuinely influence a retained transition's effect on
 * the property: guard reads, the reads of effect statements that survive
 * cone-of-influence projection onto the current needed set, any co-written
 * variables of atomic multi-writes kept by projection, and trigger variables.
 *
 * Crucially it does NOT add separable co-writes (e.g. a `useEffect` that also
 * assigns an unrelated wide payload). Those are projected out of the slice, so
 * retaining a transition for one needed write no longer drags its whole write
 * set — and the wide domains it produced — into the model.
 */
function addRetainedTransitionInputs(
  graph: ModelDependencyGraph,
  neededVars: Set<string>,
  transition: Transition,
): boolean {
  let changed = false;
  const addRead = (id: string): void => {
    if (!neededVars.has(id)) {
      neededVars.add(id);
      changed = true;
    }
  };
  // Co-writes are skipped for pending queues (matching the historical write
  // closure): a transition writing a queue does not force the queue into the
  // slice. Reads do — if a retained guard or effect reads a queue, it must be
  // retained so the transition's guard/effect stays evaluable.
  const addCoWrite = (id: string): void => {
    if (graph.pendingQueueVarIds.has(id)) return;
    addRead(id);
  };
  const projected = projectEffectToVars(transition.effect, neededVars);
  for (const id of effectReads(projected)) addRead(id);
  for (const id of exprReads(transition.guard)) addRead(id);
  for (const id of transition.triggeredBy ?? []) addRead(id);
  for (const id of effectWrites(projected)) addCoWrite(id);
  return changed;
}

function expandMountGuardDependencies(
  graph: ModelDependencyGraph,
  neededVars: Set<string>,
  mountAcc: MountScopeAccumulator,
  seedVars: ReadonlySet<string>,
): boolean {
  let changed = false;
  for (const decl of graph.model.vars) {
    if (!neededVars.has(decl.id)) continue;
    if (decl.scope.kind === "mount-local") {
      const guard = mountGuardForScope(decl.scope);
      if (!guard) continue;
      if (seedVars.has(decl.id)) {
        recordMountScopeDependency(mountAcc, decl.id, guard, "property-read");
      }
      for (const read of exprReads(guard)) {
        if (!neededVars.has(read)) {
          neededVars.add(read);
          changed = true;
        }
      }
    }
  }
  return changed;
}

function expandMountGuardReads(
  graph: ModelDependencyGraph,
  vars: Set<string>,
): void {
  for (const decl of graph.model.vars) {
    if (!vars.has(decl.id)) continue;
    if (decl.scope.kind !== "mount-local") continue;
    const guard = mountGuardForScope(decl.scope);
    if (!guard) continue;
    for (const read of exprReads(guard)) vars.add(read);
  }
}

function addEnabledObservationGuardVars(
  graph: ModelDependencyGraph,
  vars: Set<string>,
  transitionId: string,
): void {
  const transition = graph.transitionsById.get(transitionId);
  if (!transition) return;
  for (const read of exprReads(transition.guard)) vars.add(read);
  expandMountGuardReads(graph, vars);
}

function shouldSkipUnrelatedHavocTransition(
  transition: Transition,
  neededWrites: readonly string[],
  goalVars: ReadonlySet<string>,
  observationOnlyTransitions?: ReadonlySet<string>,
): boolean {
  if (observationOnlyTransitions?.has(transition.id)) return false;
  if (neededWrites.some((write) => goalVars.has(write))) return false;
  if (
    !neededWrites.every((write) =>
      effectOnlyHavocsVar(transition.effect, write),
    )
  ) {
    return false;
  }
  return !transition.reads.some((read) => goalVars.has(read));
}

function effectOnlyHavocsVar(
  effect: Transition["effect"],
  varId: string,
): boolean {
  let sawHavoc = false;
  let unsupported = false;
  walkEffect(effect, (node) => {
    switch (node.kind) {
      case "havoc":
        if (node.var === varId) sawHavoc = true;
        else unsupported = true;
        return;
      case "assign":
      case "opaque":
      case "choose":
      case "enqueue":
      case "dequeue":
      case "if":
        unsupported = true;
        return;
      default:
        return;
    }
  });
  return sawHavoc && !unsupported;
}

function walkEffect(
  effect: Transition["effect"],
  visit: (node: Transition["effect"]) => void,
): void {
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

const MAX_DECLARED_INITIAL_GUARD_STATES = 1024;

function targetGuardEnabledAtInitial(
  graph: ModelDependencyGraph,
  transition: Transition,
): boolean {
  const guardReads = [...exprReads(transition.guard)];
  const alternatives: Value[][] = [];
  for (const varId of guardReads) {
    const decl = graph.varsById.get(varId);
    if (!decl) return false;
    alternatives.push([...initialValues(decl.domain, decl.initial)]);
  }
  const productSize = alternatives.reduce(
    (size, values) => size * values.length,
    1,
  );
  if (productSize > MAX_DECLARED_INITIAL_GUARD_STATES) return false;
  if (guardReads.length === 0) {
    return evalGuardAtDeclaredInitialState(transition.guard, {});
  }
  const indices = new Array<number>(guardReads.length).fill(0);
  let hasMore = true;
  while (hasMore) {
    const state: ModelState = {};
    for (let index = 0; index < guardReads.length; index++) {
      state[guardReads[index]!] = alternatives[index]![indices[index]!]!;
    }
    if (evalGuardAtDeclaredInitialState(transition.guard, state)) {
      return true;
    }
    let carry = guardReads.length - 1;
    while (carry >= 0) {
      indices[carry]! += 1;
      if (indices[carry]! < alternatives[carry]!.length) break;
      indices[carry] = 0;
      carry -= 1;
    }
    hasMore = carry >= 0;
  }
  return false;
}

function evalGuardAtDeclaredInitialState(
  guard: ExprIR,
  state: ModelState,
): boolean {
  try {
    return evalStatePredicate(guard, state);
  } catch (error) {
    if (error instanceof StatePredicateEvalError) return false;
    throw error;
  }
}

function addTransitionGuardReads(
  graph: ModelDependencyGraph,
  vars: Set<string>,
  transitionId: string,
): void {
  const transition = graph.transitionsById.get(transitionId);
  if (!transition) return;
  for (const read of exprReads(transition.guard)) vars.add(read);
}

function seedTargetTransitionVars(
  graph: ModelDependencyGraph,
  executionVars: Set<string>,
  targetEffectReads: Set<string>,
  transitionId: string,
  postMentionedVars: ReadonlySet<string>,
  stepFactVars: ReadonlySet<string>,
): void {
  const transition = graph.transitionsById.get(transitionId);
  if (!transition) return;
  addTransitionGuardReads(graph, executionVars, transitionId);
  for (const read of transition.reads) executionVars.add(read);
  for (const varId of effectReadsForModel(
    graph.model,
    transition.effect,
    transition.id,
  )) {
    executionVars.add(varId);
    targetEffectReads.add(varId);
  }
  for (const write of transition.writes) {
    if (graph.pendingQueueVarIds.has(write)) continue;
    if (postMentionedVars.has(write) || stepFactVars.has(write)) {
      executionVars.add(write);
    }
  }
}

function addTransitionSemanticVars(
  graph: ModelDependencyGraph,
  vars: Set<string>,
  transitionId: string,
): void {
  const transition = graph.transitionsById.get(transitionId);
  if (!transition) return;
  for (const varId of transition.reads) {
    vars.add(varId);
  }
  for (const varId of transition.writes) {
    if (graph.pendingQueueVarIds.has(varId)) continue;
    vars.add(varId);
  }
  for (const varId of effectReadsForModel(
    graph.model,
    transition.effect,
    transition.id,
  )) {
    vars.add(varId);
  }
}

function createMountScopeAccumulator(): MountScopeAccumulator {
  return { entries: new Map() };
}

function recordMountScopeDependency(
  acc: MountScopeAccumulator,
  varId: string,
  guard: ExprIR,
  reason: string,
): void {
  const guardReads = [...exprReads(guard)].sort();
  let entry = acc.entries.get(varId);
  if (!entry) {
    entry = { guardReads, retainedBecause: new Set() };
    acc.entries.set(varId, entry);
  }
  entry.retainedBecause.add(reason);
}

function finalizeMountScopeDependencies(
  acc: MountScopeAccumulator,
  retainedVars: Set<string>,
): readonly MountScopeDependency[] {
  const results: MountScopeDependency[] = [];
  for (const [varId, entry] of acc.entries) {
    if (!retainedVars.has(varId)) continue;
    results.push({
      varId,
      guardReads: entry.guardReads,
      retainedBecause: [...entry.retainedBecause].sort(),
    });
  }
  return results.sort((left, right) => left.varId.localeCompare(right.varId));
}
