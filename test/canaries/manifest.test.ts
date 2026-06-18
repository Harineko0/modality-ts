
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCanaryRunReportArtifact } from "modality-ts/core";
import {
  parseCanaryManifest,
  readCanaryManifest,
  selectActiveCanaries,
  validateActiveCanaryPaths,
} from "../../tools/canary/manifest.js";

const manifestPath = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "canaries.json",
);

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

describe("canary manifest", () => {
  it("parses the repository manifest with active and planned canaries", async () => {
    const manifest = await readCanaryManifest(manifestPath);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.manifestId).toBe("repo-canaries");
    expect(manifest.canaries.map((canary) => canary.id)).toEqual(
      expect.arrayContaining([
        "examples-demo-app",
        "examples-todo-app",
        "examples-checkout-app",
        "planned-react-router-app",
      ]),
    );
  });

  it("validates active canary roots and paths", async () => {
    const manifest = await readCanaryManifest(manifestPath);
    const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
    await validateActiveCanaryPaths(repoRoot, manifest);
  });

  it("rejects missing roots for active canaries", async () => {
    const manifest = await readCanaryManifest(manifestPath);
    const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
    const broken = {
      ...manifest,
      canaries: manifest.canaries.map((canary) =>
        canary.id === "examples-todo-app"
          ? { ...canary, root: "examples/missing-todo-app" }
          : canary,
      ),
    };
    await expect(validateActiveCanaryPaths(repoRoot, broken)).rejects.toThrow(
      /missing active canary examples-todo-app root/,
    );
  });

  it("rejects free-form accepted caveat matching", () => {
    expect(() =>
      parseCanaryManifest(
        JSON.stringify({
          schemaVersion: 1,
          manifestId: "broken",
          canaries: [
            {
              id: "broken-canary",
              title: "Broken",
              status: "active",
              kind: "react-app",
              root: "examples/demo-app",
              dependencyFacts: [],
              extract: { sourcePaths: ["App.tsx"] },
              check: { propsPaths: ["app.props.ts"] },
              thresholds: { minCoverageExactOrOverlay: 1 },
              acceptedCaveats: [
                { id: "stale-read", kind: "stale-read", message: "ignore me" },
              ],
              knownUnsupported: [],
            },
          ],
        }),
      ),
    ).toThrow(/stable kind and id/);
  });

  it("excludes planned canaries from default selection", async () => {
    const manifest = await readCanaryManifest(manifestPath);
    const selected = selectActiveCanaries(manifest);
    expect(selected.map((canary) => canary.id)).toEqual([
      "examples-demo-app",
      "examples-todo-app",
      "examples-checkout-app",
    ]);
    expect(selected.every((canary) => canary.status === "active")).toBe(true);
  });

  it("represents demo seeded-bug expectations in manifest data", async () => {
    const manifest = await readCanaryManifest(manifestPath);
    const demo = manifest.canaries.find((canary) => canary.id === "examples-demo-app");
    expect(demo?.expectations).toEqual({
      violatedPropertyCount: 3,
      violatedPropertyNames: [
        "noDoubleSubmit",
        "guestCannotReachAdmin",
        "guestDoesNotSeeUserCache",
      ],
      minReproducedReplayCount: 2,
      maxOverlayLines: 100,
      expectedCiExitCode: 2,
      ciOutputMustInclude: [
        "violations=3 errors=0",
        "determinism=passed",
        "source-freshness=passed",
      ],
    });
  });
});
