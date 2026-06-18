import type { Model, Property } from "modality-ts/core";
import { prunedFieldPathsForSlice } from "modality-ts/core";
import { compareModelEconomics } from "./slicing/contributors.js";
import {
  canSliceAllProperties,
  mergeMountScopeDependencies,
  propertySlicingSkipReason,
  sliceModelForCheckProperty,
} from "./slicing/slice-model.js";
import { initialStateReachableVerdict } from "./initial-state-reachable.js";
import { runRustCheck } from "./native.js";
import type {
  CheckDiagnostics,
  CheckOptions,
  CheckResult,
  MountScopeDependency,
  PendingQueueDependency,
  PropertyVerdict,
  SliceSummary,
} from "./types.js";

export function checkModel(
  model: Model,
  properties: readonly Property[],
  options: CheckOptions = {},
): CheckResult {
  const slicingDiagnostics = buildSlicingRequestDiagnostics(
    model,
    properties,
    options.slicing === true,
  );
  if (options.slicing && canSliceAllProperties(model, properties)) {
    return checkModelSliced(model, properties, options);
  }
  const result = runRustCheck(model, properties, options);
  return {
    ...result,
    diagnostics: mergeDiagnostics(result.diagnostics, {
      slicing: slicingDiagnostics,
    }),
  };
}

function buildSlicingRequestDiagnostics(
  model: Model,
  properties: readonly Property[],
  slicingRequested: boolean,
): CheckDiagnostics["slicing"] | undefined {
  if (!slicingRequested) {
    return { enabled: false };
  }
  if (properties.length === 0) {
    return { enabled: false, skipped: true, skipReason: "no properties" };
  }
  const unsliceable = properties
    .map((property) => ({
      name: property.name,
      reason: propertySlicingSkipReason(model, property),
    }))
    .filter((entry): entry is { name: string; reason: string } =>
      Boolean(entry.reason),
    );
  if (unsliceable.length > 0) {
    return {
      enabled: false,
      skipped: true,
      skipReason: `unsupported property dependencies: ${unsliceable
        .map((entry) => `${entry.name}: ${entry.reason}`)
        .join("; ")}`,
    };
  }
  return { enabled: true };
}

function checkModelSliced(
  model: Model,
  properties: readonly Property[],
  options: CheckOptions = {},
): CheckResult {
  const groups = new Map<
    string,
    {
      model: Model;
      properties: Property[];
      index: number;
      mode: SliceSummary["mode"];
      pendingQueueDependencies: PendingQueueDependency[];
      mountScopeDependencies: MountScopeDependency[];
    }
  >();
  const sliceSummaries: SliceSummary[] = [];
  let sliceIndex = 0;
  for (const property of properties) {
    const {
      model: slice,
      mode,
      diagnostics,
    } = sliceModelForCheckProperty(model, property);
    const key = [
      slice.vars
        .map((decl) => decl.id)
        .sort()
        .join("\0"),
      slice.transitions
        .map((transition) => transition.id)
        .sort()
        .join("\0"),
      mode,
    ].join("\x01");
    const group = groups.get(key);
    if (group) {
      group.properties.push(property);
      group.pendingQueueDependencies = mergePendingQueueDependencies(
        group.pendingQueueDependencies,
        diagnostics?.pendingQueueDependencies,
      );
      group.mountScopeDependencies = [
        ...mergeMountScopeDependencies(
          group.mountScopeDependencies,
          diagnostics?.mountScopeDependencies,
        ),
      ];
    } else {
      groups.set(key, {
        model: slice,
        properties: [property],
        index: sliceIndex,
        mode,
        pendingQueueDependencies: [
          ...mergePendingQueueDependencies(
            diagnostics?.pendingQueueDependencies,
          ),
        ],
        mountScopeDependencies: [
          ...mergeMountScopeDependencies(diagnostics?.mountScopeDependencies),
        ],
      });
      sliceIndex += 1;
    }
  }

  const mergedVerdicts: CheckResult["verdicts"] = [];
  const mergedVacuity: string[] = [];
  const mergedBoundHits = new Set<string>();
  let totalStates = 0;
  let totalEdges = 0;
  let maxDepth = 0;
  let mergedDiagnostics: CheckDiagnostics | undefined;

  for (const group of [...groups.values()].sort(
    (left, right) => left.index - right.index,
  )) {
    const shortCircuited: PropertyVerdict[] = [];
    const rustProperties: Property[] = [];
    for (const property of group.properties) {
      const verdict = initialStateReachableVerdict(group.model, property);
      if (verdict) shortCircuited.push(verdict);
      else rustProperties.push(property);
    }

    let result: CheckResult = {
      verdicts: shortCircuited,
      stats: { states: 0, edges: 0, depth: 0 },
      vacuityWarnings: [],
      boundHits: [],
    };
    if (rustProperties.length > 0) {
      result = runRustCheck(group.model, rustProperties, {
        ...options,
        slicing: false,
        slicedModel: true,
      });
      result = {
        ...result,
        verdicts: [...shortCircuited, ...result.verdicts],
      };
    }

    for (const property of group.properties) {
      const verdict = result.verdicts.find(
        (candidate) => candidate.property === property.name,
      );
      if (verdict) mergedVerdicts.push(verdict);
    }
    mergedVacuity.push(...result.vacuityWarnings);
    for (const hit of result.boundHits) mergedBoundHits.add(hit);
    totalStates += result.stats.states;
    totalEdges += result.stats.edges;
    maxDepth = Math.max(maxDepth, result.stats.depth);
    mergedDiagnostics = mergeSearchDiagnostics(
      mergedDiagnostics,
      result.diagnostics,
    );
    sliceSummaries.push({
      index: group.index,
      properties: group.properties.map((property) => property.name),
      vars: group.model.vars.length,
      transitions: group.model.transitions.length,
      states: result.stats.states,
      edges: result.stats.edges,
      depth: result.stats.depth,
      mode: group.mode,
      ...(group.pendingQueueDependencies.length > 0
        ? { pendingQueueDependencies: group.pendingQueueDependencies }
        : {}),
      ...compareModelEconomics(
        model,
        group.model,
        20,
        prunedFieldPathsForSlice(model, group.model, group.properties),
      ),
      ...(group.mountScopeDependencies.length > 0
        ? { mountScopeDependencies: group.mountScopeDependencies }
        : {}),
    });
  }

  return {
    verdicts: properties.map(
      (property) =>
        mergedVerdicts.find(
          (verdict) => verdict.property === property.name,
        ) ?? {
          status: "verified-within-bounds",
          property: property.name,
        },
    ),
    stats: { states: totalStates, edges: totalEdges, depth: maxDepth },
    vacuityWarnings: [...new Set(mergedVacuity)].sort(),
    boundHits: [...mergedBoundHits].sort(),
    diagnostics: {
      ...mergedDiagnostics,
      slicing: {
        enabled: true,
        slices: groups.size,
        sliceSummaries,
      },
    },
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

function mergeDiagnostics(
  existing: CheckDiagnostics | undefined,
  patch: CheckDiagnostics,
): CheckDiagnostics {
  return { ...existing, ...patch };
}

function mergePendingQueueDependencies(
  ...groups: readonly (readonly PendingQueueDependency[] | undefined)[]
): PendingQueueDependency[] {
  const merged = new Map<string, PendingQueueDependency>();
  for (const dependencies of groups) {
    if (!dependencies) continue;
    for (const entry of dependencies) {
      const existing = merged.get(entry.varId);
      if (!existing) {
        merged.set(entry.varId, entry);
        continue;
      }
      merged.set(entry.varId, {
        varId: entry.varId,
        reasons: [...new Set([...existing.reasons, ...entry.reasons])].sort(),
        opIds:
          existing.opIds || entry.opIds
            ? [
                ...new Set([...(existing.opIds ?? []), ...(entry.opIds ?? [])]),
              ].sort()
            : undefined,
        continuations:
          existing.continuations || entry.continuations
            ? [
                ...new Set([
                  ...(existing.continuations ?? []),
                  ...(entry.continuations ?? []),
                ]),
              ].sort()
            : undefined,
      });
    }
  }
  return [...merged.values()].sort((a, b) => a.varId.localeCompare(b.varId));
}
