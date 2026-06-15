import type { ConformReport } from "modality-ts/core";
import {
  formatArtifactLine,
  formatDuration,
  formatMs,
  formatStatusSymbol,
  formatSummaryLabel,
  type OutputOptions,
  type StatusKind,
} from "../../output.js";

export interface HumanConformRenderInput {
  report: ConformReport;
  reportPath?: string;
  durationMs: number;
}

function conformStatusKind(report: ConformReport): StatusKind {
  if (report.metrics.notReproduced > 0) return "fail";
  if (report.metrics.inconclusive > 0) return "warn";
  return "pass";
}

export function renderHumanConformResult(
  input: HumanConformRenderInput,
  options: OutputOptions = {},
): string[] {
  const { metrics } = input.report;
  const kind = conformStatusKind(input.report);
  const lines = [
    ` ${formatStatusSymbol(kind, options)} conformance ${formatMs(input.durationMs)}`,
    `  (${metrics.total} walks, ${metrics.reproduced} reproduced, ${metrics.notReproduced} not-reproduced, ${metrics.inconclusive} inconclusive, passRate ${metrics.passRate})`,
    `  - mode ${input.report.mode ?? "abstract"}`,
  ];
  if (input.report.harnessPath) {
    lines.push(`  - harness ${input.report.harnessPath}`);
  }
  lines.push("");
  lines.push(formatSummaryLabel("Duration", formatDuration(input.durationMs)));
  if (input.reportPath) {
    lines.push(formatSummaryLabel("Artifacts", ""));
    lines.push(formatArtifactLine("report", input.reportPath, options));
  }
  return lines;
}
