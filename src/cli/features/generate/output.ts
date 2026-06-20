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

export interface GenerateArtifactEntry {
  kind: "componentVars";
  path: string;
}

export interface HumanGenerateTargetResult {
  label: string;
  moduleCount: number;
  varCount: number;
  transitionCount: number;
  pluginLabels: readonly string[];
  artifacts: readonly GenerateArtifactEntry[];
  durationMs?: number;
}

export interface HumanGenerateRenderOptions extends OutputOptions {
  startedAt?: Date;
  totalDurationMs: number;
  showArtifacts?: boolean;
}

export function renderHumanGenerateTarget(
  target: HumanGenerateTargetResult,
  options: OutputOptions,
): string[] {
  const duration =
    target.durationMs !== undefined ? ` ${formatMs(target.durationMs)}` : "";
  return [
    ` ${formatStatusSymbol("pass", options)} ${target.label} (${target.moduleCount} modules)${duration}`,
  ];
}

export function renderGenerateSummary(
  results: readonly HumanGenerateTargetResult[],
  options: HumanGenerateRenderOptions,
): string[] {
  if (results.length === 0) return [];
  const lines: string[] = [];
  lines.push("");

  const targetCount = results.length;
  lines.push(
    formatSummaryRow(
      "Generate Files",
      formatCountValue({ passed: targetCount }, targetCount, options),
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

export function renderHumanGenerateTargets(
  results: readonly HumanGenerateTargetResult[],
  options: HumanGenerateRenderOptions,
): string[] {
  return results
    .flatMap((target) => renderHumanGenerateTarget(target, options))
    .concat(renderGenerateSummary(results, options));
}
