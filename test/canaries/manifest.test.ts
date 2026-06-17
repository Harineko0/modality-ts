import { describe, expect, it } from "vitest";
import { parseCanaryRunReportArtifact } from "modality-ts/core";

describe("parseCanaryRunReportArtifact", () => {
  const validReport = {
    schemaVersion: 1,
    kind: "canary-run-report",
    generatedAt: "2026-06-17T00:00:00.000Z",
    manifestId: "repo-canaries",
    canaryResults: [
      {
        canaryId: "examples-checkout",
        status: "fail",
        thresholds: [
          {
            id: "minExactOrOverlay",
            status: "fail",
            expected: 0.9,
            actual: 0.5,
          },
        ],
        budgets: [
          {
            id: "search",
            status: "fail",
            maxStates: 50,
            actualStates: 120,
          },
        ],
        unacceptedCaveats: ["stale-read:auth"],
      },
    ],
    classifications: [
      {
        canaryId: "examples-checkout",
        fixtureId: "checkout",
        category: "state-space-budget",
        severity: "action-required",
        evidence: ["check.stats.states exceeded maxStates"],
        suggestedPlanFamily: "G",
      },
    ],
  };

  it("accepts a minimal valid canary run report", () => {
    expect(parseCanaryRunReportArtifact(JSON.stringify(validReport))).toEqual(
      validReport,
    );
  });

  it("rejects unsupported schema versions", () => {
    expect(() =>
      parseCanaryRunReportArtifact(
        JSON.stringify({ ...validReport, schemaVersion: 2 }),
      ),
    ).toThrow("unsupported canary run report schemaVersion 2");
  });

  it("rejects missing required report fields", () => {
    expect(() =>
      parseCanaryRunReportArtifact(
        JSON.stringify({
          schemaVersion: 1,
          kind: "canary-run-report",
          generatedAt: "2026-06-17T00:00:00.000Z",
        }),
      ),
    ).toThrow("canary run report manifestId must be a non-empty string");
    expect(() =>
      parseCanaryRunReportArtifact(
        JSON.stringify({
          schemaVersion: 1,
          kind: "canary-run-report",
          generatedAt: "2026-06-17T00:00:00.000Z",
          manifestId: "repo-canaries",
          canaryResults: [],
        }),
      ),
    ).toThrow("canary run report artifact missing classifications");
  });

  it("rejects malformed classification, threshold, and budget entries", () => {
    expect(() =>
      parseCanaryRunReportArtifact(
        JSON.stringify({
          ...validReport,
          classifications: [
            {
              canaryId: "examples-checkout",
              category: "not-a-category",
              severity: "blocker",
              evidence: ["x"],
              suggestedPlanFamily: "G",
            },
          ],
        }),
      ),
    ).toThrow("classifications[0].category is unsupported");
    expect(() =>
      parseCanaryRunReportArtifact(
        JSON.stringify({
          ...validReport,
          canaryResults: [
            {
              canaryId: "examples-checkout",
              status: "fail",
              thresholds: [
                { id: "rate", status: "fail", expected: -0.1, actual: 0 },
              ],
            },
          ],
        }),
      ),
    ).toThrow("canaryResults[0].thresholds[0].expected must be a number between 0 and 1");
    expect(() =>
      parseCanaryRunReportArtifact(
        JSON.stringify({
          ...validReport,
          canaryResults: [
            {
              canaryId: "",
              status: "fail",
            },
          ],
        }),
      ),
    ).toThrow("canaryResults[0].canaryId must be a non-empty string");
    expect(() =>
      parseCanaryRunReportArtifact(
        JSON.stringify({
          ...validReport,
          budgetResults: [{ id: "edges", status: "fail", maxEdges: -1 }],
        }),
      ),
    ).toThrow("budgetResults[0].maxEdges must be a positive integer");
  });
});
