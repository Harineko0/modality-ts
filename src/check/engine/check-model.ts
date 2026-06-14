import { canonicalState, validateModel } from "modality-ts/core";
import type {
  Model,
  ModelState,
  Property,
  StepFacts,
  Transition,
} from "modality-ts/core";
import {
  effectContainsEnqueue,
  recordMaxDepthBoundHits,
} from "../diagnostics/bounds.js";
import { vacuityWarnings } from "../diagnostics/vacuity.js";
import { finalizeProperties } from "../properties/finalize.js";
import { observeEdge, observeStates } from "../properties/observe.js";
import { applyEffect } from "../runtime/effects.js";
import {
  canSliceProperty,
  sliceModelForProperty,
} from "../slicing/slice-model.js";
import { facts } from "../traces/step-facts.js";
import type { TraceContext } from "../traces/trace.js";
import type {
  CheckDiagnostics,
  CheckOptions,
  CheckResult,
  EdgeRecordingMode,
  GraphRecording,
  Parent,
  PropertyVerdict,
  SliceSummary,
  StorageDiagnostics,
} from "../types.js";
import { initialStates } from "./initial-states.js";
import { stabilize } from "./stabilize.js";
import {
  changedVars,
  initialChangedVars,
  sortStatesByCanon,
} from "./state-utils.js";
import {
  buildTransitionIndex,
  enabledTransitions,
  installEnabledHook,
  type TransitionIndex,
} from "./transitions.js";

interface SearchTracker {
  maxFrontier: number;
  finalFrontier: number;
  expandedDepths: number;
  dominantVarValues: Map<string, Set<string>>;
  limitHit: CheckDiagnostics["limits"] | null;
}

export function needsRecordedEdges(properties: readonly Property[]): boolean {
  return properties.some((property) => property.kind === "leadsToWithin");
}

export function needsReverseGraph(properties: readonly Property[]): boolean {
  return properties.some((property) => property.kind === "reachableFrom");
}

export function needsStepMonitoring(properties: readonly Property[]): boolean {
  return properties.some((property) => property.kind === "alwaysStep");
}

function resolveEdgeRecordingMode(
  properties: readonly Property[],
): EdgeRecordingMode {
  if (needsRecordedEdges(properties)) return "compact";
  if (needsReverseGraph(properties)) return "reverse";
  return "none";
}

function createGraphRecording(mode: EdgeRecordingMode): GraphRecording {
  return {
    mode,
    compactEdges: [],
    reverseEdges: [],
    fullEdges: [],
  };
}

function recordExploredEdge(
  graph: GraphRecording,
  properties: readonly Property[],
  preCanon: string,
  postCanon: string,
  pre: ModelState,
  post: ModelState,
  transition: Transition,
  step: StepFacts,
): void {
  switch (graph.mode) {
    case "full":
      graph.fullEdges.push({
        preCanon,
        postCanon,
        pre,
        post,
        transition,
        step,
      });
      break;
    case "compact":
      graph.compactEdges.push({
        preCanon,
        postCanon,
        transitionId: transition.id,
        triggeredProperties: properties
          .filter(
            (
              property,
            ): property is Extract<Property, { kind: "leadsToWithin" }> =>
              property.kind === "leadsToWithin",
          )
          .filter((property) => property.trigger(step))
          .map((property) => property.name),
      });
      break;
    case "reverse":
      graph.reverseEdges.push({ preCanon, postCanon });
      break;
    case "none":
      break;
  }
}

function buildStorageDiagnostics(
  parents: Map<string, Parent>,
  states: Map<string, ModelState>,
  graph: GraphRecording,
): StorageDiagnostics {
  const recordedEdges =
    graph.mode === "none"
      ? 0
      : graph.mode === "reverse"
        ? graph.reverseEdges.length
        : graph.mode === "compact"
          ? graph.compactEdges.length
          : graph.fullEdges.length;
  return {
    recordedEdges,
    storedStates: states.size,
    parentEntries: parents.size,
    edgeRecordingMode: graph.mode,
  };
}

export function checkModel(
  model: Model,
  properties: readonly Property[],
  options: CheckOptions = {},
): CheckResult {
  const slicingDiagnostics = buildSlicingRequestDiagnostics(
    properties,
    options.slicing === true,
  );
  if (
    options.slicing &&
    properties.length > 0 &&
    properties.every((property) => property.reads !== undefined)
  ) {
    const result = checkModelSliced(model, properties, options);
    return {
      ...result,
      diagnostics: mergeDiagnostics(result.diagnostics, {
        slicing: slicingDiagnostics,
      }),
    };
  }
  const result = checkModelCore(model, properties, options);
  return {
    ...result,
    diagnostics: mergeDiagnostics(result.diagnostics, {
      slicing: slicingDiagnostics,
    }),
  };
}

function buildSlicingRequestDiagnostics(
  properties: readonly Property[],
  slicingRequested: boolean,
): CheckDiagnostics["slicing"] | undefined {
  if (!slicingRequested) {
    return { enabled: false };
  }
  if (properties.length === 0) {
    return { enabled: false, skipped: true, skipReason: "no properties" };
  }
  if (!properties.every((property) => property.reads !== undefined)) {
    return {
      enabled: false,
      skipped: true,
      skipReason: "property missing reads",
    };
  }
  return { enabled: true };
}

function checkModelCore(
  model: Model,
  properties: readonly Property[],
  options: CheckOptions = {},
): CheckResult {
  const validation = validateModel(model, { sliced: options.slicedModel });
  if (!validation.ok) return invalidModelResult(properties, validation.errors);

  const startedAt = options.trackElapsed ? Date.now() : undefined;
  installEnabledHook(model);
  const transitionIndex = buildTransitionIndex(model);
  const canonCache = new WeakMap<ModelState, string>();
  const canon = (state: ModelState): string => {
    const cached = canonCache.get(state);
    if (cached !== undefined) return cached;
    const encoded = canonicalState(model, state);
    canonCache.set(state, encoded);
    return encoded;
  };
  const parents = new Map<string, Parent>();
  const states = new Map<string, ModelState>();
  const graph = createGraphRecording(resolveEdgeRecordingMode(properties));
  const traceCtx: TraceContext = { model, parents, states };
  const enabledTransitionIds = new Set<string>();
  const boundHits = new Set<string>();
  const tracker = createSearchTracker(model);
  let frontier = seedFrontier(
    model,
    parents,
    states,
    tracker,
    transitionIndex,
    canon,
  );
  const verdicts = new Map<string, PropertyVerdict>();
  let depth = 0;
  let edgeCount = 0;
  observeStates(model, properties, frontier, traceCtx, verdicts);
  recordDominantVars(model, frontier, tracker);

  while (
    frontier.length > 0 &&
    depth < model.bounds.maxDepth &&
    tracker.limitHit === null
  ) {
    tracker.maxFrontier = Math.max(tracker.maxFrontier, frontier.length);
    tracker.finalFrontier = frontier.length;
    const limit = checkSearchLimits(
      options,
      parents.size,
      edgeCount,
      frontier.length,
      depth,
    );
    if (limit) {
      tracker.limitHit = limit;
      break;
    }

    const result = exploreDepth(
      model,
      properties,
      frontier,
      parents,
      states,
      graph,
      traceCtx,
      verdicts,
      enabledTransitionIds,
      boundHits,
      tracker,
      options,
      edgeCount,
      depth,
      transitionIndex,
      canon,
    );
    frontier = result.next;
    edgeCount += result.edges;
    observeStates(model, properties, frontier, traceCtx, verdicts);
    recordDominantVars(model, frontier, tracker);
    depth += 1;
    tracker.expandedDepths = depth;
    options.onProgress?.({
      depth,
      frontier: frontier.length,
      nextFrontier: frontier.length,
      states: parents.size,
      edges: edgeCount,
    });

    const postLimit = checkSearchLimits(
      options,
      parents.size,
      edgeCount,
      frontier.length,
      depth,
    );
    if (postLimit) {
      tracker.limitHit = postLimit;
      break;
    }
  }

  recordMaxDepthBoundHits(
    model,
    frontier,
    enabledTransitionIds,
    boundHits,
    transitionIndex,
  );
  if (tracker.limitHit) {
    applySearchLimitVerdicts(properties, verdicts, tracker.limitHit);
  } else {
    finalizeProperties(model, properties, traceCtx, graph, verdicts);
  }

  return {
    verdicts: properties.map(
      (property) =>
        verdicts.get(property.name) ?? {
          status: "verified-within-bounds",
          property: property.name,
        },
    ),
    stats: { states: parents.size, edges: edgeCount, depth },
    vacuityWarnings: vacuityWarnings(model, states, enabledTransitionIds),
    boundHits: [...boundHits].sort(),
    diagnostics: buildSearchDiagnostics(
      tracker,
      startedAt,
      buildStorageDiagnostics(parents, states, graph),
      transitionIndex,
    ),
  };
}

function invalidModelResult(
  properties: readonly Property[],
  errors: readonly string[],
): CheckResult {
  return {
    verdicts: properties.map((property) => ({
      status: "error",
      property: property.name,
      message: errors.join("; "),
    })),
    stats: { states: 0, edges: 0, depth: 0 },
    vacuityWarnings: [],
    boundHits: [],
  };
}

function createSearchTracker(model: Model): SearchTracker {
  return {
    maxFrontier: 0,
    finalFrontier: 0,
    expandedDepths: 0,
    dominantVarValues: new Map(model.vars.map((decl) => [decl.id, new Set()])),
    limitHit: null,
  };
}

function recordDominantVars(
  model: Model,
  frontier: readonly ModelState[],
  tracker: SearchTracker,
): void {
  for (const state of frontier) {
    for (const decl of model.vars) {
      const value = JSON.stringify(state[decl.id]);
      tracker.dominantVarValues.get(decl.id)?.add(value);
    }
  }
}

function buildSearchDiagnostics(
  tracker: SearchTracker,
  startedAt: number | undefined,
  storage: StorageDiagnostics,
  transitionIndex: TransitionIndex,
): CheckDiagnostics {
  const dominantVars = [...tracker.dominantVarValues.entries()]
    .map(([varId, values]) => ({ varId, distinctValues: values.size }))
    .filter((entry) => entry.distinctValues > 0)
    .sort((left, right) => right.distinctValues - left.distinctValues)
    .slice(0, 5);
  const search: CheckDiagnostics["search"] = {
    maxFrontier: tracker.maxFrontier,
    finalFrontier: tracker.finalFrontier,
    expandedDepths: tracker.expandedDepths,
  };
  if (startedAt !== undefined) {
    search.elapsedMs = Date.now() - startedAt;
  }
  return {
    search,
    storage,
    hotPath: {
      canonicalCache: true,
      transitionIndex: true,
      internalTransitionIndex: transitionIndex.internalTransitions.length > 0,
    },
    ...(tracker.limitHit ? { limits: tracker.limitHit } : {}),
    ...(dominantVars.length > 0 ? { dominantVars } : {}),
  };
}

function hitSearchLimit(
  tracker: SearchTracker,
  options: CheckOptions,
  states: number,
  edges: number,
  frontier: number,
  depth: number,
): boolean {
  if (tracker.limitHit !== null) return true;
  const limit = checkSearchLimits(options, states, edges, frontier, depth);
  if (!limit) return false;
  tracker.limitHit = limit;
  return true;
}

function checkSearchLimits(
  options: CheckOptions,
  states: number,
  edges: number,
  frontier: number,
  depth: number,
): CheckDiagnostics["limits"] | null {
  if (options.maxStates !== undefined && states >= options.maxStates) {
    return {
      reason: `search limit exceeded: maxStates=${options.maxStates}`,
      maxStates: options.maxStates,
    };
  }
  if (options.maxEdges !== undefined && edges >= options.maxEdges) {
    return {
      reason: `search limit exceeded: maxEdges=${options.maxEdges}`,
      maxEdges: options.maxEdges,
    };
  }
  if (options.maxFrontier !== undefined && frontier >= options.maxFrontier) {
    return {
      reason: `search limit exceeded: maxFrontier=${options.maxFrontier}`,
      maxFrontier: options.maxFrontier,
    };
  }
  const maxHeap = options.memoryGuard?.maxHeapUsedBytes;
  if (maxHeap !== undefined && process.memoryUsage().heapUsed >= maxHeap) {
    return {
      reason: `search limit exceeded: memoryGuard=${maxHeap}`,
      memoryGuardBytes: maxHeap,
    };
  }
  void depth;
  return null;
}

function applySearchLimitVerdicts(
  properties: readonly Property[],
  verdicts: Map<string, PropertyVerdict>,
  limit: NonNullable<CheckDiagnostics["limits"]>,
): void {
  for (const property of properties) {
    const verdict = verdicts.get(property.name);
    if (
      verdict &&
      (verdict.status === "violated" ||
        verdict.status === "reachable" ||
        verdict.status === "vacuous-warning" ||
        verdict.status === "error")
    ) {
      continue;
    }
    verdicts.set(property.name, {
      status: "error",
      property: property.name,
      message: limit.reason,
    });
  }
}

function seedFrontier(
  model: Model,
  parents: Map<string, Parent>,
  states: Map<string, ModelState>,
  tracker: SearchTracker,
  index: TransitionIndex,
  canon: (state: ModelState) => string,
): ModelState[] {
  const frontier = sortStatesByCanon(
    initialStates(model).flatMap((state) =>
      stabilize(model, state, initialChangedVars(model), index, canon),
    ),
    canon,
  );
  tracker.maxFrontier = Math.max(tracker.maxFrontier, frontier.length);
  tracker.finalFrontier = frontier.length;
  for (const state of frontier) {
    const key = canon(state);
    if (!parents.has(key)) {
      parents.set(key, { parent: null, transitionId: null });
      states.set(key, state);
    }
  }
  return frontier;
}

function exploreDepth(
  model: Model,
  properties: readonly Property[],
  frontier: readonly ModelState[],
  parents: Map<string, Parent>,
  states: Map<string, ModelState>,
  graph: GraphRecording,
  traceCtx: TraceContext,
  verdicts: Map<string, PropertyVerdict>,
  enabledTransitionIds: Set<string>,
  boundHits: Set<string>,
  tracker: SearchTracker,
  options: CheckOptions,
  startingEdgeCount: number,
  depth: number,
  index: TransitionIndex,
  canon: (state: ModelState) => string,
): { next: ModelState[]; edges: number } {
  const next: ModelState[] = [];
  let edgeCount = 0;
  for (const pre of frontier) {
    if (tracker.limitHit !== null) break;
    const preCanon = canon(pre);
    for (const transition of enabledTransitions(model, pre, index)) {
      enabledTransitionIds.add(transition.id);
      const rawPosts = applyEffect(model, pre, transition.effect, {
        onBoundHit: (hit) => {
          boundHits.add(
            hit.startsWith("token cap exhausted")
              ? `token cap exhausted at ${transition.id}`
              : `${hit} at ${transition.id}`,
          );
        },
      });
      if (rawPosts.length === 0 && effectContainsEnqueue(transition.effect)) {
        boundHits.add(`pending cap saturated at ${transition.id}`);
      }
      for (const rawPost of rawPosts) {
        for (const post of stabilize(
          model,
          rawPost,
          changedVars(pre, rawPost, model),
          index,
          canon,
        )) {
          edgeCount += 1;
          const postCanon = canon(post);
          const step = facts(pre, post, transition);
          recordExploredEdge(
            graph,
            properties,
            preCanon,
            postCanon,
            pre,
            post,
            transition,
            step,
          );
          observeEdge(
            model,
            properties,
            pre,
            post,
            transition,
            step,
            traceCtx,
            verdicts,
          );
          if (
            hitSearchLimit(
              tracker,
              options,
              parents.size,
              startingEdgeCount + edgeCount,
              next.length,
              depth,
            )
          ) {
            break;
          }
          if (!parents.has(postCanon)) {
            parents.set(postCanon, {
              parent: preCanon,
              transitionId: transition.id,
            });
            states.set(postCanon, post);
            next.push(post);
            tracker.maxFrontier = Math.max(tracker.maxFrontier, next.length);
            if (
              hitSearchLimit(
                tracker,
                options,
                parents.size,
                startingEdgeCount + edgeCount,
                next.length,
                depth,
              )
            ) {
              break;
            }
          }
        }
        if (tracker.limitHit !== null) break;
      }
      if (tracker.limitHit !== null) break;
    }
    if (tracker.limitHit !== null) break;
  }
  return { next: sortStatesByCanon(next, canon), edges: edgeCount };
}

function checkModelSliced(
  model: Model,
  properties: readonly Property[],
  options: CheckOptions = {},
): CheckResult {
  const groups = new Map<
    string,
    { model: Model; properties: Property[]; index: number }
  >();
  const sliceSummaries: SliceSummary[] = [];
  let sliceIndex = 0;
  for (const property of properties) {
    const slice = canSliceProperty(property)
      ? sliceModelForProperty(model, property)
      : model;
    const key = slice.vars.map((decl) => decl.id).join("\0");
    const group = groups.get(key);
    if (group) {
      group.properties.push(property);
    } else {
      groups.set(key, {
        model: slice,
        properties: [property],
        index: sliceIndex,
      });
      sliceIndex += 1;
    }
  }

  const results = [...groups.values()].map((group) => {
    const result = checkModelCore(group.model, group.properties, {
      ...options,
      slicedModel: true,
    });
    sliceSummaries.push({
      index: group.index,
      properties: group.properties.map((property) => property.name),
      vars: group.model.vars.length,
      transitions: group.model.transitions.length,
      states: result.stats.states,
      edges: result.stats.edges,
      depth: result.stats.depth,
    });
    return result;
  });

  sliceSummaries.sort((left, right) => left.index - right.index);
  const combined = combineSlicedResults(properties, results);
  return {
    ...combined,
    diagnostics: mergeDiagnostics(combined.diagnostics, {
      slicing: {
        enabled: true,
        slices: sliceSummaries.length,
        sliceSummaries,
      },
      search: combined.diagnostics?.search,
      limits: combined.diagnostics?.limits,
      dominantVars: combined.diagnostics?.dominantVars,
    }),
  };
}

function combineSlicedResults(
  properties: readonly Property[],
  results: readonly CheckResult[],
): CheckResult {
  const verdicts = new Map<string, PropertyVerdict>();
  let states = 0;
  let edges = 0;
  let depth = 0;
  const vacuity = new Set<string>();
  const boundHits = new Set<string>();
  let diagnostics: CheckDiagnostics | undefined;
  for (const result of results) {
    for (const verdict of result.verdicts)
      verdicts.set(verdict.property, verdict);
    for (const warning of result.vacuityWarnings) vacuity.add(warning);
    for (const hit of result.boundHits) boundHits.add(hit);
    states += result.stats.states;
    edges += result.stats.edges;
    depth = Math.max(depth, result.stats.depth);
    diagnostics = mergeSearchDiagnostics(diagnostics, result.diagnostics);
  }
  return {
    verdicts: properties.map(
      (property) =>
        verdicts.get(property.name) ?? {
          status: "error",
          property: property.name,
          message: "missing sliced verdict",
        },
    ),
    stats: { states, edges, depth },
    vacuityWarnings: [...vacuity].sort(),
    boundHits: [...boundHits].sort(),
    diagnostics,
  };
}

function mergeDiagnostics(
  base: CheckDiagnostics | undefined,
  overlay: CheckDiagnostics | undefined,
): CheckDiagnostics | undefined {
  if (!base && !overlay) return undefined;
  return {
    ...base,
    ...overlay,
    slicing:
      base?.slicing || overlay?.slicing
        ? {
            enabled:
              overlay?.slicing?.enabled ?? base?.slicing?.enabled ?? false,
            slices: overlay?.slicing?.slices ?? base?.slicing?.slices,
            skipped: overlay?.slicing?.skipped ?? base?.slicing?.skipped,
            skipReason:
              overlay?.slicing?.skipReason ?? base?.slicing?.skipReason,
            sliceSummaries:
              overlay?.slicing?.sliceSummaries ?? base?.slicing?.sliceSummaries,
          }
        : undefined,
    search: overlay?.search ?? base?.search,
    limits: overlay?.limits ?? base?.limits,
    dominantVars: overlay?.dominantVars ?? base?.dominantVars,
    storage: overlay?.storage ?? base?.storage,
    hotPath: overlay?.hotPath ?? base?.hotPath,
  };
}

function mergeSearchDiagnostics(
  left: CheckDiagnostics | undefined,
  right: CheckDiagnostics | undefined,
): CheckDiagnostics | undefined {
  if (!left) return right;
  if (!right) return left;
  const dominant = mergeDominantVars(left.dominantVars, right.dominantVars);
  return {
    slicing: left.slicing ?? right.slicing,
    search: {
      maxFrontier: Math.max(
        left.search?.maxFrontier ?? 0,
        right.search?.maxFrontier ?? 0,
      ),
      finalFrontier: Math.max(
        left.search?.finalFrontier ?? 0,
        right.search?.finalFrontier ?? 0,
      ),
      expandedDepths: Math.max(
        left.search?.expandedDepths ?? 0,
        right.search?.expandedDepths ?? 0,
      ),
      elapsedMs:
        left.search?.elapsedMs !== undefined ||
        right.search?.elapsedMs !== undefined
          ? (left.search?.elapsedMs ?? 0) + (right.search?.elapsedMs ?? 0)
          : undefined,
    },
    limits: left.limits ?? right.limits,
    dominantVars: dominant,
    storage: mergeStorageDiagnostics(left.storage, right.storage),
    hotPath: left.hotPath ?? right.hotPath,
  };
}

function mergeStorageDiagnostics(
  left: CheckDiagnostics["storage"],
  right: CheckDiagnostics["storage"],
): CheckDiagnostics["storage"] {
  if (!left) return right;
  if (!right) return left;
  return {
    recordedEdges: left.recordedEdges + right.recordedEdges,
    storedStates: left.storedStates + right.storedStates,
    parentEntries: left.parentEntries + right.parentEntries,
    edgeRecordingMode:
      left.edgeRecordingMode === right.edgeRecordingMode
        ? left.edgeRecordingMode
        : "property-specific",
  };
}

function mergeDominantVars(
  left: CheckDiagnostics["dominantVars"],
  right: CheckDiagnostics["dominantVars"],
): CheckDiagnostics["dominantVars"] {
  const counts = new Map<string, number>();
  for (const entry of [...(left ?? []), ...(right ?? [])]) {
    counts.set(
      entry.varId,
      Math.max(counts.get(entry.varId) ?? 0, entry.distinctValues),
    );
  }
  return [...counts.entries()]
    .map(([varId, distinctValues]) => ({ varId, distinctValues }))
    .sort((a, b) => b.distinctValues - a.distinctValues)
    .slice(0, 5);
}
