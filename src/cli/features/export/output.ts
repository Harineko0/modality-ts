import {
  formatArtifactLine,
  formatDuration,
  formatMs,
  formatStatusSymbol,
  formatSummaryLabel,
  type OutputOptions,
} from "../../output.js";

export interface HumanExportRenderInput {
  outPath: string;
  moduleName: string;
  durationMs: number;
}

export function renderHumanExportResult(
  input: HumanExportRenderInput,
  options: OutputOptions = {},
): string[] {
  const outName = input.outPath.split(/[/\\]/).pop() ?? input.outPath;
  return [
    ` ${formatStatusSymbol("pass", options)} ${outName} ${formatMs(input.durationMs)}`,
    "  - format tla",
    `  - module ${input.moduleName}`,
    "",
    formatSummaryLabel("Duration", formatDuration(input.durationMs)),
    formatSummaryLabel("Artifacts", ""),
    formatArtifactLine("export", input.outPath, options),
  ];
}
