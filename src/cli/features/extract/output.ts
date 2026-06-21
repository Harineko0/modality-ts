import type { ExtractionReport } from "modality-ts/core";
import {
  formatArtifactLine,
  formatCountValue,
  formatDuration,
  formatDurationValue,
  formatMs,
  formatStatusSymbol,
  formatSummaryRow,
  formatTime,
  formatTimeValue,
  type OutputOptions,
} from "../../output.js";

export interface ExtractArtifactEntry {
  kind:
    | "model"
    | "appModel"
    | "componentVars"
    | "report"
    | "sliceManifest"
    | "sliceModel";
  path: string;
}

export interface ExtractPropsError {
  propsPath: string;
  message: string;
}

export interface HumanExtractTargetResult {
  label: string;
  varCount: number;
  transitionCount: number;
  report: ExtractionReport;
  pluginLabels: readonly string[];
  stateSpaceLine?: string;
  coarseDomainsLine?: string;
  sliceStatsLine?: string;
  sliceEconomicsLine?: string;
  artifacts: readonly ExtractArtifactEntry[];
  durationMs?: number;
  propsErrors?: readonly ExtractPropsError[];
}

export interface HumanExtractRenderOptions extends OutputOptions {
  startedAt?: Date;
  totalDurationMs: number;
  showArtifacts?: boolean;
  totalTargets?: number;
}

function formatRouteStats(report: ExtractionReport): string | undefined {
  const coverage = report.routeCoverage;
  if (!coverage || coverage.configured === 0) return undefined;
  const omitted = coverage.configured - coverage.modeled;
  return `routes configured ${coverage.configured}, modeled ${coverage.modeled}, omitted ${omitted}`;
}

function renderTargetStats(target: HumanExtractTargetResult): string {
  const parts = [
    `vars ${target.varCount}`,
    `transitions ${target.transitionCount}`,
  ];
  const routeStats = formatRouteStats(target.report);
  if (routeStats) parts.push(routeStats);
  return `(${parts.join(", ")})`;
}

export function renderHumanExtractTarget(
  target: HumanExtractTargetResult,
  options: OutputOptions,
): string[] {
  const lines: string[] = [];
  const duration =
    target.durationMs !== undefined ? ` ${formatMs(target.durationMs)}` : "";
  lines.push(
    ` ${formatStatusSymbol("pass", options)} ${target.label}${duration} ${renderTargetStats(target)}`,
  );
  for (const plugin of target.pluginLabels) {
    lines.push(`  - plugin ${plugin}`);
  }
  if (target.stateSpaceLine) {
    lines.push(`  - ${target.stateSpaceLine}`);
  }
  if (target.coarseDomainsLine) {
    lines.push(`  - ${target.coarseDomainsLine}`);
  }
  if (target.sliceStatsLine) {
    lines.push(`  - ${target.sliceStatsLine}`);
  }
  if (target.sliceEconomicsLine) {
    lines.push(`  - ${target.sliceEconomicsLine}`);
  }
  if (target.propsErrors && target.propsErrors.length > 0) {
    for (const propsError of target.propsErrors) {
      lines.push(
        ` ${formatStatusSymbol("warn", options)} ${propsError.propsPath}`,
      );
      lines.push(`    ${propsError.message}`);
    }
  }
  return lines;
}

export function renderExtractSummary(
  results: readonly HumanExtractTargetResult[],
  options: HumanExtractRenderOptions,
): string[] {
  if (results.length === 0) return [];
  const lines: string[] = [];
  lines.push("");

  const totalTargets = options.totalTargets ?? results.length;
  const propsErroredCount = results.filter(
    (target) => (target.propsErrors?.length ?? 0) > 0,
  ).length;
  const succeededCount = totalTargets - propsErroredCount;
  lines.push(
    formatSummaryRow(
      "Extract Files",
      formatCountValue(
        { passed: succeededCount, failed: propsErroredCount },
        totalTargets,
        { ...options, leadFailed: true },
      ),
      options,
    ),
  );
  lines.push(
    formatSummaryRow(
      "Start at",
      formatTimeValue(formatTime(options.startedAt ?? new Date(0)), options),
      options,
    ),
  );
  lines.push(
    formatSummaryRow(
      "Duration",
      formatDurationValue(
        formatDuration(options.totalDurationMs),
        undefined,
        options,
      ),
      options,
    ),
  );
  const artifacts = results.flatMap((target) => [...target.artifacts]);
  if (options.showArtifacts === true && artifacts.length > 0) {
    lines.push(formatSummaryRow("Artifacts", "", options));
    for (const entry of artifacts) {
      lines.push(formatArtifactLine(entry.kind, entry.path, options));
    }
  }
  return lines;
}

export function renderHumanExtractTargets(
  results: readonly HumanExtractTargetResult[],
  options: HumanExtractRenderOptions,
): string[] {
  return results
    .flatMap((target) => renderHumanExtractTarget(target, options))
    .concat(renderExtractSummary(results, options));
}
