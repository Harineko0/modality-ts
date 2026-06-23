import { describe, expect, it } from "vitest";
import {
  VALIDITY_COMMENT_MARKER,
  renderValidityComment,
} from "../../tools/validity/comment.js";
import type { ValidityReport } from "../../tools/validity/types.js";

describe("validity comment renderer", () => {
  it("renders the marker, summary table, details, and actual JSON", () => {
    const markdown = renderValidityComment(sampleReport());

    expect(markdown.startsWith(VALIDITY_COMMENT_MARKER)).toBe(true);
    expect(markdown).toContain(
      "| Experiment | Status | Headline | ledgerops-nextjs | ledgerops-react-router |",
    );
    expect(markdown).toContain("<summary>conformance: skipped</summary>");
    expect(markdown).toContain("<summary>mutation: error</summary>");
    expect(markdown).toContain("<summary>metamorphic: skipped</summary>");
    expect(markdown).toContain("<summary>Actual JSON</summary>");
    expect(markdown).toContain('"kind":"validity-report"');
  });

  it("truncates comments that exceed GitHub's comment size limit", () => {
    const report = sampleReport();
    report.subReports[0].perBenchmark[0].messages = ["x".repeat(70_000)];

    const markdown = renderValidityComment(report);

    expect(markdown.length).toBeLessThanOrEqual(65_536);
    expect(markdown).toContain("Details truncated");
    expect(markdown).toContain("uploaded validity artifact");
  });
});

function sampleReport(): ValidityReport {
  return {
    schemaVersion: 1,
    kind: "validity-report",
    generatedAt: "2026-06-23T00:00:00.000Z",
    manifestId: "ledgerops-benchmarks",
    reportPath: ".modality/validity/report.json",
    subReports: [
      {
        experiment: "conformance",
        status: "skipped",
        headline: "conformance not yet implemented",
        perBenchmark: [
          {
            benchmarkId: "ledgerops-react-router",
            framework: "react-router",
            status: "skipped",
            headline: "conformance not yet implemented",
            metrics: {},
            messages: ["conformance not yet implemented"],
          },
          {
            benchmarkId: "ledgerops-nextjs",
            framework: "nextjs",
            status: "skipped",
            headline: "conformance not yet implemented",
            metrics: {},
            messages: ["conformance not yet implemented"],
          },
        ],
        messages: ["conformance not yet implemented"],
      },
      {
        experiment: "mutation",
        status: "error",
        headline: "synthetic failure",
        perBenchmark: [],
        messages: ["synthetic failure"],
      },
      {
        experiment: "metamorphic",
        status: "skipped",
        headline: "metamorphic not yet implemented",
        perBenchmark: [
          {
            benchmarkId: "ledgerops-react-router",
            framework: "react-router",
            status: "skipped",
            headline: "metamorphic not yet implemented",
            metrics: {},
            messages: ["metamorphic not yet implemented"],
          },
        ],
        messages: ["metamorphic not yet implemented"],
      },
    ],
  };
}
