import {
  formatArtifactLine,
  formatDuration,
  formatMs,
  formatStatusSymbol,
  formatSummaryLabel,
  type OutputOptions,
  type StatusKind,
} from "../../output.js";

export interface HumanCiRenderInput {
  exitCode: number;
  violationCount: number;
  errorCount: number;
  determinismPassed: boolean;
  determinismFailures: readonly string[];
  trustRegressions: readonly string[];
  sourceFreshnessPassed?: boolean;
  sourceStaleFailures: readonly string[];
  conformPassRate?: number;
  conformMinPassRate?: number;
  transitionConformFailures: readonly string[];
  reportPath: string;
  tracesDir: string;
  durationMs: number;
}

function ciStatusKind(input: HumanCiRenderInput): StatusKind {
  return input.exitCode === 0 ? "pass" : "fail";
}

export function renderHumanCiResult(
  input: HumanCiRenderInput,
  options: OutputOptions = {},
): string[] {
  const kind = ciStatusKind(input);
  const lines = [
    ` ${formatStatusSymbol(kind, options)} ci ${formatMs(input.durationMs)}`,
    `  - check ${input.violationCount} violations, ${input.errorCount} errors`,
    `  - determinism ${input.determinismPassed ? "passed" : "failed"}`,
  ];
  for (const failure of input.determinismFailures) {
    lines.push(`    ${failure}`);
  }
  if (input.trustRegressions.length > 0) {
    lines.push(`  - trust-regressions ${input.trustRegressions.length}`);
    for (const regression of input.trustRegressions) {
      lines.push(`    ${regression}`);
    }
  }
  if (input.sourceFreshnessPassed !== undefined) {
    lines.push(
      `  - source-freshness ${input.sourceFreshnessPassed ? "passed" : "failed"}`,
    );
    for (const failure of input.sourceStaleFailures) {
      lines.push(`    ${failure}`);
    }
  }
  if (input.conformPassRate !== undefined) {
    lines.push(
      `  - conform passRate ${input.conformPassRate} min ${input.conformMinPassRate ?? 1}`,
    );
    for (const failure of input.transitionConformFailures) {
      lines.push(`    ${failure}`);
    }
  }
  lines.push("");
  lines.push(formatSummaryLabel("Duration", formatDuration(input.durationMs)));
  lines.push(formatSummaryLabel("Artifacts", ""));
  lines.push(formatArtifactLine("report", input.reportPath, options));
  lines.push(formatArtifactLine("traces", input.tracesDir, options));
  return lines;
}
