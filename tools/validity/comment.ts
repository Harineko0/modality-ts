import { canonicalJson } from "modality-ts/core";
import type {
  ValidityBenchmarkSlice,
  ValidityReport,
  ValiditySubReport,
} from "./types.js";

export const VALIDITY_COMMENT_MARKER = "Extract-validity report:";

const GITHUB_COMMENT_LIMIT = 65_536;
const TRUNCATION_NOTICE =
  "\n\n_Details truncated because this report exceeds GitHub's comment size limit. See the uploaded validity artifact for the full report._\n";

export function renderValidityComment(report: ValidityReport): string {
  const sections = [
    `${VALIDITY_COMMENT_MARKER} ${report.generatedAt}`,
    "",
    renderSummaryTable(report),
    "",
    ...report.subReports.map(renderExperimentDetails),
    renderActualJson(report),
  ];
  return limitComment(sections.join("\n"));
}

function renderSummaryTable(report: ValidityReport): string {
  const benchmarks = [
    ...new Set(
      report.subReports.flatMap((subReport) =>
        subReport.perBenchmark.map((slice) => slice.benchmarkId),
      ),
    ),
  ].sort();
  const benchmarkColumns = benchmarks.length > 0 ? benchmarks : ["benchmarks"];
  const header = ["Experiment", "Status", "Headline", ...benchmarkColumns];
  const separator = header.map(() => "---");
  const rows = report.subReports.map((subReport) => [
    subReport.experiment,
    renderStatus(subReport),
    subReport.headline,
    ...benchmarkColumns.map((benchmarkId) =>
      renderBenchmarkSummary(subReport, benchmarkId),
    ),
  ]);
  return [header, separator, ...rows].map(renderTableRow).join("\n");
}

function renderBenchmarkSummary(
  subReport: ValiditySubReport,
  benchmarkId: string,
): string {
  const slice = subReport.perBenchmark.find(
    (entry) => entry.benchmarkId === benchmarkId,
  );
  if (!slice) return "n/a";
  return `${renderStatus(slice)}: ${slice.headline}`;
}

function renderExperimentDetails(subReport: ValiditySubReport): string {
  const lines = [
    "<details>",
    `<summary>${escapeHtml(subReport.experiment)}: ${escapeHtml(
      renderStatus(subReport),
    )}</summary>`,
    "",
    subReport.headline,
    "",
    ...renderMessages(subReport.messages),
    ...subReport.perBenchmark.flatMap(renderBenchmarkDetails),
    "</details>",
    "",
  ];
  return lines.join("\n");
}

function renderBenchmarkDetails(slice: ValidityBenchmarkSlice): string[] {
  return [
    `### ${slice.benchmarkId}`,
    "",
    `- Framework: ${slice.framework}`,
    `- Status: ${renderStatus(slice)}`,
    `- Headline: ${slice.headline}`,
    `- Metrics: \`${canonicalJson(slice.metrics)}\``,
    ...renderMessages(slice.messages),
    "",
  ];
}

function renderStatus(
  report: Pick<
    ValidityBenchmarkSlice | ValiditySubReport,
    "status" | "headline" | "messages"
  >,
): string {
  if (report.status === "fail" && isBlocked(report)) return "fail (blocked)";
  return report.status;
}

function isBlocked(
  report: Pick<
    ValidityBenchmarkSlice | ValiditySubReport,
    "headline" | "messages"
  >,
): boolean {
  return (
    report.headline.startsWith("blocked:") ||
    report.messages.some((message) => message.startsWith("blocked:"))
  );
}

function renderMessages(messages: readonly string[]): string[] {
  if (messages.length === 0) return [];
  return ["Messages:", "", ...messages.map((message) => `- ${message}`), ""];
}

function renderActualJson(report: ValidityReport): string {
  return [
    "<details>",
    "<summary>Actual JSON</summary>",
    "",
    "```json",
    canonicalJson(report),
    "```",
    "",
    "</details>",
    "",
  ].join("\n");
}

function renderTableRow(cells: readonly string[]): string {
  return `| ${cells.map(escapeTableCell).join(" | ")} |`;
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function limitComment(comment: string): string {
  if (comment.length <= GITHUB_COMMENT_LIMIT) return comment;
  const budget = GITHUB_COMMENT_LIMIT - TRUNCATION_NOTICE.length;
  return `${comment.slice(0, Math.max(0, budget))}${TRUNCATION_NOTICE}`;
}
