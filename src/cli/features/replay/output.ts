import type { ReplayReport } from "modality-ts/core";
import {
  formatArtifactLine,
  formatDuration,
  formatMs,
  formatStatusSymbol,
  formatSummaryLabel,
  type OutputOptions,
  type StatusKind,
} from "../../output.js";

export interface HumanReplayRenderInput {
  tracePath: string;
  report: ReplayReport;
  reportPath?: string;
  durationMs: number;
}

function replayStatusKind(report: ReplayReport): StatusKind {
  switch (report.verdict.status) {
    case "reproduced":
      return "pass";
    case "not-reproduced":
      return "fail";
    case "inconclusive":
      return "warn";
  }
}

export function renderHumanReplayResult(
  input: HumanReplayRenderInput,
  options: OutputOptions = {},
): string[] {
  const traceName = input.tracePath.split(/[/\\]/).pop() ?? input.tracePath;
  const kind = replayStatusKind(input.report);
  const lines = [
    ` ${formatStatusSymbol(kind, options)} ${traceName} ${formatMs(input.durationMs)}`,
    `  (mode ${input.report.mode ?? "abstract"}, steps ${input.report.verdict.stepsRun})`,
    `  - ${input.report.verdict.status}`,
  ];
  if (input.report.harnessPath) {
    lines.push(`  - harness ${input.report.harnessPath}`);
  }
  if (input.report.verdict.divergenceStep !== undefined) {
    lines.push(`  - divergenceStep ${input.report.verdict.divergenceStep}`);
  }
  if (input.report.verdict.reason) {
    lines.push(`  - ${input.report.verdict.reason}`);
  }
  lines.push("");
  lines.push(formatSummaryLabel("Duration", formatDuration(input.durationMs)));
  if (input.reportPath) {
    lines.push(formatSummaryLabel("Artifacts", ""));
    lines.push(formatArtifactLine("report", input.reportPath, options));
  }
  return lines;
}
