import type { ExtractionReport } from "modality-ts/core";
import {
  formatArtifactLine,
  formatDuration,
  formatMs,
  formatStatusSymbol,
  formatSummaryLabel,
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
  totalDurationMs: number;
  showArtifacts?: boolean;
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

export function renderHumanExtractTargets(
  results: readonly HumanExtractTargetResult[],
  options: HumanExtractRenderOptions,
): string[] {
  const lines: string[] = [];
  for (const target of results) {
    const duration =
      target.durationMs !== undefined ? ` ${formatMs(target.durationMs)}` : "";
    lines.push(
      ` ${formatStatusSymbol("pass", options)} ${target.label}${duration}`,
    );
    lines.push(`  ${renderTargetStats(target)}`);
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
  }
  if (results.length > 0) {
    lines.push("");
    lines.push(
      formatSummaryLabel("Duration", formatDuration(options.totalDurationMs)),
    );
    const artifacts = results.flatMap((target) => [...target.artifacts]);
    if (options.showArtifacts === true && artifacts.length > 0) {
      lines.push(formatSummaryLabel("Artifacts", ""));
      for (const entry of artifacts) {
        lines.push(formatArtifactLine(entry.kind, entry.path, options));
      }
    }
  }
  return lines;
}
