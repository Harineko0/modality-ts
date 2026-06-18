import {
  effectReadsForModel,
  exprReads,
  mountGuardForScope,
} from "modality-ts/core";
import type { ExprIR, Model, StateVarDecl, Transition } from "modality-ts/core";
import type { MountScopeDependency } from "../types.js";

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
}

export interface StateSliceClosureResult {
  neededVars: Set<string>;
  neededTransitions: Set<string>;
  mountScopeDependencies: readonly MountScopeDependency[];
}

export interface TargetedStepSliceClosureInput {
  stateReads: readonly string[];
  stepFactVars: readonly string[];
  enabledTransitionIds: readonly string[];
  targetTransitionIds: readonly string[];
}

export interface TargetedStepSliceClosureResult {
  executionVars: Set<string>;
  neededTransitions: Set<string>;
  mountScopeDependencies: readonly MountScopeDependency[];
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
  const neededVars = new Set([
    ...input.propertyReads,
    ...enabledTransitionSeedVars(graph, forcedTransitions),
  ]);
  const neededTransitions = new Set<string>();
  const mountAcc = createMountScopeAccumulator();
  const seedVars = new Set(neededVars);

  reachVarsThroughTransitions(graph, neededVars, neededTransitions, mountAcc, {
    seedVars,
  });

  for (const id of forcedTransitions) {
    neededTransitions.add(id);
    addTransitionSemanticVars(graph, neededVars, id);
  }

  return {
    neededVars,
    neededTransitions,
    mountScopeDependencies: finalizeMountScopeDependencies(
      mountAcc,
      neededVars,
    ),
  };
}

export function computeTargetedStepSliceClosure(
  graph: ModelDependencyGraph,
  input: TargetedStepSliceClosureInput,
): TargetedStepSliceClosureResult {
  const targetIdSet = new Set(input.targetTransitionIds);
  const dependencyVars = new Set([...input.stateReads, ...input.stepFactVars]);
  const neededTransitions = new Set<string>();
  const mountAcc = createMountScopeAccumulator();
  const seedVars = new Set(dependencyVars);

  for (const id of input.targetTransitionIds) {
    addTransitionReadVars(graph, dependencyVars, id);
  }

  reachVarsThroughTransitions(
    graph,
    dependencyVars,
    neededTransitions,
    mountAcc,
    { seedVars },
  );

  const executionVars = new Set(dependencyVars);
  for (const varId of input.stepFactVars) {
    executionVars.add(varId);
  }
  for (const id of input.targetTransitionIds) {
    neededTransitions.add(id);
    addTransitionSemanticVars(graph, executionVars, id);
  }
  for (const id of input.enabledTransitionIds) {
    if (!targetIdSet.has(id)) neededTransitions.add(id);
    addTransitionSemanticVars(graph, executionVars, id);
  }

  for (const transition of graph.model.transitions) {
    if (transition.cls !== "internal") continue;
    if (!transition.triggeredBy?.some((varId) => executionVars.has(varId))) {
      continue;
    }
    if (!transition.writes.some((write) => executionVars.has(write))) continue;
    neededTransitions.add(transition.id);
    addTransitionSemanticVars(graph, executionVars, transition.id);
  }

  return {
    executionVars,
    neededTransitions,
    mountScopeDependencies: finalizeMountScopeDependencies(
      mountAcc,
      executionVars,
    ),
  };
}

export function enabledTransitionSeedVars(
  graph: ModelDependencyGraph,
  transitionIds: ReadonlySet<string>,
): string[] {
  const vars = new Set<string>();
  for (const id of transitionIds) {
    const transition = graph.transitionsById.get(id);
    if (!transition) continue;
    for (const read of exprReads(transition.guard)) vars.add(read);
    for (const read of effectReadsForModel(
      graph.model,
      transition.effect,
      transition.id,
    )) {
      vars.add(read);
    }
    for (const read of transition.reads) vars.add(read);
    for (const write of transition.writes) {
      if (graph.pendingQueueVarIds.has(write)) continue;
      vars.add(write);
    }
  }
  expandMountGuardReads(graph, vars);
  expandMountLocalsFromGuardReads(graph, vars);
  return [...vars].sort();
}

function reachVarsThroughTransitions(
  graph: ModelDependencyGraph,
  neededVars: Set<string>,
  neededTransitions: Set<string>,
  mountAcc: MountScopeAccumulator,
  options: { seedVars: ReadonlySet<string> },
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
      if (!transition.writes.some((write) => neededVars.has(write))) continue;
      if (!neededTransitions.has(transition.id)) {
        neededTransitions.add(transition.id);
        changed = true;
      }
      for (const id of transition.reads) {
        if (!neededVars.has(id)) {
          neededVars.add(id);
          changed = true;
        }
      }
      for (const id of transition.writes) {
        if (graph.pendingQueueVarIds.has(id)) continue;
        if (!neededVars.has(id)) {
          neededVars.add(id);
          changed = true;
        }
      }
    }
  }
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
  for (const decl of graph.mountLocalVars) {
    const guard = mountGuardForScope(decl.scope);
    if (!guard) continue;
    for (const read of exprReads(guard)) {
      if (!neededVars.has(read)) continue;
      if (!seedVars.has(read)) continue;
      const mountLocalWasNeeded = neededVars.has(decl.id);
      if (!mountLocalWasNeeded) {
        neededVars.add(decl.id);
        changed = true;
      }
      if (!seedVars.has(decl.id)) {
        recordMountScopeDependency(
          mountAcc,
          decl.id,
          guard,
          `guard-read:${read}`,
        );
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

function expandMountLocalsFromGuardReads(
  graph: ModelDependencyGraph,
  vars: Set<string>,
): void {
  for (const decl of graph.mountLocalVars) {
    const guard = mountGuardForScope(decl.scope);
    if (!guard) continue;
    for (const read of exprReads(guard)) {
      if (vars.has(read)) vars.add(decl.id);
    }
  }
}

function addTransitionReadVars(
  graph: ModelDependencyGraph,
  vars: Set<string>,
  transitionId: string,
): void {
  const transition = graph.transitionsById.get(transitionId);
  if (!transition) return;
  for (const read of transition.reads) vars.add(read);
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
