import {
  formatArtifactLine,
  formatDuration,
  formatMs,
  formatStatusSymbol,
  formatSummaryLabel,
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
