import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { dirname } from "node:path";
import {
  canonicalJson,
  parseModelArtifact,
  sliceContributorFieldPaths,
  type ExtractionPropertySliceDiagnostics,
  type ExtractionPropertySliceDiagnosticsEntry,
  type ExtractionReport,
  type Model,
  type Property,
  type PropertySliceManifest,
  type PropertySliceManifestEntry,
} from "modality-ts/core";
import type { Bounds } from "modality-ts/core";
import type {
  DomainRefinementProvider,
  NavigationAdapter,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";
import { emitAppModel } from "../../codegen/model.js";
import { compareModelEconomics } from "../../../check/slicing/contributors.js";
import {
  propertySlicingSkipReason,
  sliceModelForCheckProperty,
} from "../../../check/slicing/slice-model.js";
import {
  sliceArtifactsDirForModel,
  sliceManifestPathForModel,
  sliceModelPathForProperty,
} from "../../defaults.js";
import { loadProperties } from "../../properties/load-properties.js";
import type { ExtractArtifactEntry, ExtractPropsError } from "./output.js";
import {
  buildExtractionModel,
  createExtractDiagnosticsClock,
  type ExtractionModelBuild,
  type ModalityConfig,
} from "../../extraction/build-model.js";

export type { ModalityConfig, ExtractionModelBuild };
export { buildExtractionModel, createExtractDiagnosticsClock };
export type { ExtractDiagnosticsClock } from "../../extraction/build-model.js";

export interface ExtractCommandOptions {
  sourcePath?: string;
  sourcePaths?: readonly string[];
  modelPath: string;
  appModelPath?: string;
  reportPath?: string;
  route?: string;
  effectApis?: readonly string[];
  overlayPath?: string;
  expectModelPath?: string;
  packageJsonPath?: string;
  configPath?: string;
  disabledPlugins?: readonly string[];
  sourcePlugins?: readonly StateSourcePlugin[];
  domainRefinements?: readonly DomainRefinementProvider[];
  routerPlugin?: NavigationAdapter | false;
  bounds?: Partial<Bounds>;
  propsPath?: string;
  propsPaths?: readonly string[];
  sliceManifestPath?: string;
  explainDrift?: boolean;
  now?: Date;
}

export interface ExtractCommandResult {
  model: Model;
  report: ExtractionReport;
  lines: string[];
  targetLabel: string;
  appModelPath: string;
  varCount: number;
  transitionCount: number;
  pluginLabels: readonly string[];
  stateSpaceLine?: string;
  coarseDomainsLine?: string;
  sliceStatsLine?: string;
  sliceEconomicsLine?: string;
  artifacts: readonly ExtractArtifactEntry[];
  propsErrors: readonly ExtractPropsError[];
}

export async function runExtractCommand(
  options: ExtractCommandOptions,
): Promise<ExtractCommandResult> {
  const diagnosticsClock = createExtractDiagnosticsClock();
  const build = await buildExtractionModel(options, diagnosticsClock);
  const {
    model,
    report,
    appModelPath,
    route,
    varCount,
    transitionCount,
    pluginLabels,
    stateSpaceLine,
    coarseDomainsLine,
    routeCoverageLine,
    driftLines,
    extractionDiagnosticsBase,
    targetLabel,
  } = build;
  const propsPaths = [
    ...(options.propsPaths ?? []),
    ...(options.propsPath ? [options.propsPath] : []),
  ];
  const propsErrors: ExtractPropsError[] = [];
  const loadedProperties: Property[] = [];
  for (const propsPath of propsPaths) {
    try {
      const properties = await loadProperties(model, [propsPath]);
      loadedProperties.push(...properties);
    } catch (error) {
      propsErrors.push({
        propsPath,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const sliceManifestPath =
    loadedProperties.length > 0
      ? (options.sliceManifestPath ??
        sliceManifestPathForModel(options.modelPath))
      : undefined;
  const propertySlicePlan =
    loadedProperties.length > 0 && sliceManifestPath !== undefined
      ? buildPropertySlicePlan(
          model,
          loadedProperties,
          options.modelPath,
          sliceManifestPath,
          options.now ?? new Date(),
        )
      : undefined;
  let reportWithDiagnostics: ExtractionReport = report;
  const sliceArtifacts: ExtractArtifactEntry[] = [];
  await diagnosticsClock.measureAsync(
    "write-artifacts",
    "Write extraction artifacts",
    async () => {
      await mkdir(dirname(options.modelPath), { recursive: true });
      await writeFile(options.modelPath, `${canonicalJson(model)}\n`, "utf8");
      await mkdir(dirname(appModelPath), { recursive: true });
      await writeFile(appModelPath, emitAppModel(model), "utf8");
      if (propertySlicePlan) {
        await mkdir(sliceArtifactsDirForModel(options.modelPath), {
          recursive: true,
        });
        for (const emitted of propertySlicePlan.emittedWrites) {
          await writeFile(
            emitted.path,
            `${canonicalJson(emitted.slice)}\n`,
            "utf8",
          );
          sliceArtifacts.push({ kind: "sliceModel", path: emitted.path });
        }
        await writeFile(
          propertySlicePlan.manifestPath,
          `${canonicalJson(propertySlicePlan.manifest)}\n`,
          "utf8",
        );
        sliceArtifacts.push({
          kind: "sliceManifest",
          path: propertySlicePlan.manifestPath,
        });
      }
      if (options.expectModelPath) {
        await assertMatchesExpectedModel(model, options.expectModelPath);
      }
    },
  );
  reportWithDiagnostics = {
    ...report,
    diagnostics: {
      phaseTimings: diagnosticsClock.finish(),
      ...extractionDiagnosticsBase,
      ...(propertySlicePlan
        ? { propertySlices: propertySlicePlan.diagnosticsSummary }
        : {}),
    },
  };
  if (options.reportPath) {
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(
      options.reportPath,
      `${canonicalJson(reportWithDiagnostics)}\n`,
      "utf8",
    );
  }
  const artifacts: ExtractArtifactEntry[] = [
    { kind: "model", path: options.modelPath },
    { kind: "appModel", path: appModelPath },
    ...sliceArtifacts,
  ];
  if (options.reportPath) {
    artifacts.push({ kind: "report", path: options.reportPath });
  }
  const sliceStatsLine = propertySlicePlan
    ? `slices=properties:${propertySlicePlan.diagnosticsSummary.properties} emitted:${propertySlicePlan.diagnosticsSummary.emitted} skipped:${propertySlicePlan.diagnosticsSummary.skipped} groups:${propertySlicePlan.diagnosticsSummary.slices} manifest=${propertySlicePlan.manifestPath}`
    : undefined;
  const sliceEconomicsLine = propertySlicePlan
    ? formatSliceEconomicsLine(propertySlicePlan.diagnosticsSummary)
    : undefined;
  return {
    model,
    report: reportWithDiagnostics,
    targetLabel,
    appModelPath,
    varCount,
    transitionCount,
    pluginLabels,
    stateSpaceLine,
    coarseDomainsLine,
    sliceStatsLine,
    sliceEconomicsLine,
    artifacts,
    propsErrors,
    lines: [
      `extracted vars=${varCount} transitions=${transitionCount}`,
      `route=${route}`,
      ...(stateSpaceLine ? [stateSpaceLine] : []),
      ...(routeCoverageLine ? [routeCoverageLine] : []),
      ...(coarseDomainsLine ? [coarseDomainsLine] : []),
      ...(sliceStatsLine ? [sliceStatsLine] : []),
      ...(sliceEconomicsLine ? [sliceEconomicsLine] : []),
      `plugins=${pluginLabels.join(",") || "none"}`,
      `model=${options.modelPath}`,
      `appModel=${appModelPath}`,
      ...(options.overlayPath ? [`overlay=${options.overlayPath}`] : []),
      ...(options.explainDrift
        ? driftLines.length > 0
          ? driftLines
          : ["overlay-drift=none"]
        : []),
      ...(options.configPath ? [`config=${options.configPath}`] : []),
      ...(options.expectModelPath
        ? [`expectedModel=${options.expectModelPath}`]
        : []),
      ...(options.reportPath ? [`report=${options.reportPath}`] : []),
    ],
  };
}

async function assertMatchesExpectedModel(
  model: Model,
  expectedModelPath: string,
): Promise<void> {
  const expected = parseModelArtifact(
    await readFile(expectedModelPath, "utf8"),
  );
  const actualText = canonicalJson(model);
  const expectedText = canonicalJson(expected);
  if (actualText !== expectedText) {
    throw new Error(
      `Extracted model differs from expected snapshot ${expectedModelPath}`,
    );
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface PropertySliceWrite {
  path: string;
  slice: Model;
}

interface PropertySlicePlan {
  manifestPath: string;
  manifest: PropertySliceManifest;
  emittedWrites: readonly PropertySliceWrite[];
  diagnosticsSummary: ExtractionPropertySliceDiagnostics;
}

function computeSliceKey(
  slice: Model,
  mode: "state" | "targetedStep" | "full",
): string {
  return [
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
}

export function buildPropertySlicePlan(
  model: Model,
  properties: readonly Property[],
  modelPath: string,
  manifestPath: string,
  now: Date,
): PropertySlicePlan {
  const fullVars = model.vars.length;
  const fullTransitions = model.transitions.length;
  const indexedProperties = properties.map((property, index) => ({
    property,
    index,
  }));
  const propertyDescriptors = indexedProperties.map(({ property, index }) => ({
    name: property.name,
    index,
  }));
  const entries: PropertySliceManifestEntry[] = [];
  const emittedWrites: PropertySliceWrite[] = [];
  const diagnosticsEntries: ExtractionPropertySliceDiagnosticsEntry[] = [];
  const sliceKeys = new Set<string>();
  let emitted = 0;
  let skipped = 0;

  for (const { property, index } of [...indexedProperties].sort(
    (left, right) =>
      left.property.name.localeCompare(right.property.name) ||
      left.index - right.index,
  )) {
    const propertyStartedAt = performance.now();
    const skipReason = propertySlicingSkipReason(model, property);
    if (skipReason) {
      skipped += 1;
      const elapsedMs = performance.now() - propertyStartedAt;
      entries.push({
        property: property.name,
        propertyIndex: index,
        status: "skipped",
        reason: skipReason,
      });
      diagnosticsEntries.push({
        property: property.name,
        propertyIndex: index,
        status: "skipped",
        reason: skipReason,
        elapsedMs,
      });
      continue;
    }

    const {
      model: slice,
      mode,
      diagnostics,
    } = sliceModelForCheckProperty(model, property);
    const economics = compareModelEconomics(
      model,
      slice,
      20,
      sliceContributorFieldPaths(model, slice, [property]),
    );
    const elapsedMs = performance.now() - propertyStartedAt;
    const sliceKey = computeSliceKey(slice, mode);
    sliceKeys.add(sliceKey);
    const slicePath = sliceModelPathForProperty(
      modelPath,
      property.name,
      index,
      propertyDescriptors,
    );
    emitted += 1;
    emittedWrites.push({ path: slicePath, slice });
    entries.push({
      property: property.name,
      propertyIndex: index,
      status: "emitted",
      mode,
      path: slicePath,
      fullVars,
      fullTransitions,
      vars: slice.vars.length,
      transitions: slice.transitions.length,
      varIds: slice.vars.map((decl) => decl.id).sort(),
      transitionIds: slice.transitions
        .map((transition) => transition.id)
        .sort(),
      retainedBits: economics.retainedBits,
      prunedBits: economics.prunedBits,
      topRetainedContributors: economics.topContributors,
      topPrunedContributors: economics.prunedTopContributors,
      retainedSystemVars: economics.retainedSystemVars,
      prunedSystemVars: economics.prunedSystemVars,
      ...(diagnostics?.pendingQueueDependencies &&
      diagnostics.pendingQueueDependencies.length > 0
        ? {
            pendingQueueDependencies: diagnostics.pendingQueueDependencies.map(
              (entry) => ({
                varId: entry.varId,
                reasons: [...entry.reasons].sort(),
                ...(entry.opIds ? { opIds: [...entry.opIds].sort() } : {}),
                ...(entry.continuations
                  ? { continuations: [...entry.continuations].sort() }
                  : {}),
              }),
            ),
          }
        : {}),
      ...(diagnostics?.mountScopeDependencies &&
      diagnostics.mountScopeDependencies.length > 0
        ? {
            mountScopeDependencies: diagnostics.mountScopeDependencies.map(
              (entry) => ({
                varId: entry.varId,
                guardReads: [...entry.guardReads].sort(),
                retainedBecause: [...entry.retainedBecause].sort(),
              }),
            ),
          }
        : {}),
      ...(diagnostics?.closureFallback
        ? { closureFallback: diagnostics.closureFallback }
        : {}),
      sliceKey,
    });
    diagnosticsEntries.push({
      property: property.name,
      propertyIndex: index,
      status: "emitted",
      mode,
      path: slicePath,
      fullVars,
      fullTransitions,
      vars: slice.vars.length,
      transitions: slice.transitions.length,
      retainedBits: economics.retainedBits,
      prunedBits: economics.prunedBits,
      topRetainedContributors: economics.topContributors,
      topPrunedContributors: economics.prunedTopContributors,
      sliceKey,
      elapsedMs,
    });
  }

  const diagnosticsSummary = summarizePropertySliceDiagnostics(
    manifestPath,
    properties.length,
    emitted,
    skipped,
    sliceKeys.size,
    diagnosticsEntries,
  );

  const manifest: PropertySliceManifest = {
    schemaVersion: 1,
    kind: "property-slice-manifest",
    modelId: model.id,
    sourceModelPath: modelPath,
    sourceModelHash: sha256(canonicalJson(model)),
    generatedAt: now.toISOString(),
    properties: entries,
  };

  return {
    manifestPath,
    manifest,
    emittedWrites,
    diagnosticsSummary,
  };
}

function summarizePropertySliceDiagnostics(
  manifestPath: string,
  properties: number,
  emitted: number,
  skipped: number,
  slices: number,
  entries: readonly ExtractionPropertySliceDiagnosticsEntry[],
): ExtractionPropertySliceDiagnostics {
  const totalElapsedMs = roundElapsedMs(
    entries.reduce((sum, entry) => sum + (entry.elapsedMs ?? 0), 0),
  );
  const emittedEntries = entries.filter((entry) => entry.status === "emitted");
  const largestRetained = emittedEntries.reduce<
    ExtractionPropertySliceDiagnosticsEntry | undefined
  >((current, entry) => {
    if (entry.retainedBits === undefined) return current;
    if (
      current === undefined ||
      entry.retainedBits > (current.retainedBits ?? 0)
    ) {
      return entry;
    }
    return current;
  }, undefined);
  const largestPrunedBits = emittedEntries.reduce((max, entry) => {
    if (entry.prunedBits === undefined) return max;
    return Math.max(max, entry.prunedBits);
  }, 0);
  return {
    manifestPath,
    properties,
    emitted,
    skipped,
    slices,
    totalElapsedMs,
    ...(largestRetained
      ? {
          largestRetainedProperty: largestRetained.property,
          largestRetainedBits: largestRetained.retainedBits,
        }
      : {}),
    ...(largestPrunedBits > 0 ? { largestPrunedBits } : {}),
    entries,
  };
}

function roundElapsedMs(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatSliceEconomicsLine(
  diagnostics: ExtractionPropertySliceDiagnostics,
): string | undefined {
  if (
    !diagnostics.largestRetainedProperty ||
    diagnostics.entries === undefined
  ) {
    return undefined;
  }
  const entry = diagnostics.entries.find(
    (candidate) =>
      candidate.status === "emitted" &&
      candidate.property === diagnostics.largestRetainedProperty,
  );
  if (
    !entry ||
    entry.retainedBits === undefined ||
    entry.prunedBits === undefined
  ) {
    return undefined;
  }
  const topRetained = entry.topRetainedContributors?.[0];
  const topPruned = entry.topPrunedContributors?.[0];
  const topRetainedLabel = topRetained
    ? `topRetained:${topRetained.varId}(${topRetained.bits.toFixed(1)})`
    : "topRetained:none";
  const topPrunedLabel = topPruned
    ? `topPruned:${topPruned.varId}(${topPruned.bits.toFixed(1)})`
    : "topPruned:none";
  return [
    `slice-economics=largest:${entry.property}`,
    `retained:${entry.retainedBits.toFixed(1)}bits`,
    `pruned:${entry.prunedBits.toFixed(1)}bits`,
    topRetainedLabel,
    topPrunedLabel,
  ].join(" ");
}
