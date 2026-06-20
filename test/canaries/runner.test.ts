import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertCoverageThreshold,
  assertSeededBugExpectations,
} from "../../tools/canary/assertions.js";
import {
  classifyCanaryFailure,
  classifyEveryCategoryFixtures,
} from "../../tools/canary/classify.js";
import { parseCanaryManifest } from "../../tools/canary/manifest.js";
import { runCanarySuite } from "../../tools/canary/runner.js";
import type { CheckReport, ExtractionReport } from "modality-ts/core";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = join(repoRoot, "test/canaries/canaries.json");

describe("canary assertion helpers", () => {
  const extractionReport = {
    coverage: { percentExactOrOverlay: 0.5 },
  } as ExtractionReport;

  it("fails low coverage thresholds", () => {
    expect(assertCoverageThreshold(extractionReport, 1).status).toBe("fail");
  });

  it("checks seeded-bug expectations from manifest data", () => {
    const checkReport = {
      verdicts: [
        { property: "noDoubleSubmit", status: "violated" },
        { property: "guestCannotReachAdmin", status: "violated" },
        { property: "guestDoesNotSeeUserCache", status: "violated" },
      ],
    } as CheckReport;
    expect(
      assertSeededBugExpectations({
        checkReport,
        reproducedReplayCount: 2,
        overlayLines: 10,
        ciExitCode: 2,
        ciLines: [
          "violations=3 errors=0",
          "determinism=passed",
          "source-freshness=passed",
        ],
        expectations: {
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
        },
      }),
    ).toEqual([]);
  });
});

describe("canary runner", () => {
  it("runs the demo-app canary successfully from manifest expectations", async () => {
    const result = await runCanarySuite({
      repoRoot,
      manifestPath,
      canaryId: "examples-demo-app",
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.canaryResults).toEqual([
      expect.objectContaining({
        canaryId: "examples-demo-app",
        status: "pass",
        reportPaths: expect.objectContaining({
          extract: expect.stringContaining("extract-report.json"),
          sliceManifest: expect.stringContaining(".slices.json"),
        }),
      }),
    ]);
    const extractReport = JSON.parse(
      await readFile(
        result.report.canaryResults[0]?.reportPaths?.extract ?? "",
        "utf8",
      ),
    ) as ExtractionReport;
    expect(extractReport.diagnostics?.propertySlices).toEqual(
      expect.objectContaining({
        emitted: expect.any(Number),
        entries: expect.any(Array),
      }),
    );
  });

  it("classifies state-space budget failures", () => {
    const classifications = classifyCanaryFailure({
      canaryId: "tiny-canary",
      status: "fail",
      budgetResults: [
        {
          id: "maxStates",
          status: "fail",
          evidence: ["checkReport.stats.states: 120", "budget.maxStates: 50"],
          message: "state count 120 exceeds budget 50",
        },
      ],
    });
    expect(classifications).toEqual([
      expect.objectContaining({
        category: "state-space-budget",
        suggestedPlanFamily: "state-space-economics",
      }),
    ]);
  });

  it("covers every classification category synthetically", () => {
    const categories = classifyEveryCategoryFixtures()
      .map((entry) => entry.category)
      .sort();
    expect(categories).toEqual([
      "environment-or-project-integration",
      "explicit-unsupported-behavior",
      "fixture-or-canary-invalid",
      "incorrect-ir-or-checker",
      "missing-adapter-capability",
      "missing-semantic-abstraction",
      "state-space-budget",
      "syntax-recognition-gap",
    ]);
  });

  it("records accepted and unaccepted caveats", async () => {
    const { evaluateAcceptedCaveats } = await import(
      "../../tools/shared-gates/caveats.js"
    );
    const accepted = evaluateAcceptedCaveats({
      extractionReport: {
        globalTaints: [
          { kind: "global-taint", id: "x", reason: "y", severity: "info" },
        ],
        staleReads: [],
        unhandledRejections: [],
      } as ExtractionReport,
      acceptedCaveats: [{ kind: "global-taint", id: "x" }],
    });
    expect(accepted.status).toBe("pass");
    expect(accepted.acceptedCaveats).toEqual(["global-taint:x"]);

    const rejected = evaluateAcceptedCaveats({
      extractionReport: {
        globalTaints: [
          { kind: "global-taint", id: "y", reason: "z", severity: "info" },
        ],
        staleReads: [],
        unhandledRejections: [],
      } as ExtractionReport,
      acceptedCaveats: [],
    });
    expect(rejected.unacceptedCaveats).toEqual(["global-taint:y"]);
  });

  it("includes classifications for failing canaries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-canary-runner-"));
    const canaryRoot = join(dir, "tiny-canary");
    await mkdir(join(canaryRoot, "app"), { recursive: true });
    await writeFile(
      join(canaryRoot, "app/App.tsx"),
      `
      export function App() {
        return <button type="button" onClick={() => unknownHandler()}>Go</button>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(canaryRoot, "app/app.props.ts"),
      "// no properties registered",
      "utf8",
    );
    await writeFile(
      join(canaryRoot, "app/package.json"),
      JSON.stringify({ private: true, dependencies: { react: "^18.0.0" } }),
      "utf8",
    );
    const manifestFile = join(dir, "canaries.json");
    await writeFile(
      manifestFile,
      JSON.stringify({
        schemaVersion: 1,
        manifestId: "tiny",
        canaries: [
          {
            id: "tiny-canary",
            title: "Tiny",
            status: "active",
            kind: "react-app",
            root: "tiny-canary",
            dependencyFacts: [],
            extract: {
              sourcePaths: ["app/App.tsx"],
              packageJsonPath: "app/package.json",
            },
            check: { propsPaths: ["app/app.props.ts"] },
            thresholds: { minCoverageExactOrOverlay: 1 },
            budgetNotApplicableReason: "Synthetic threshold-only canary.",
            acceptedCaveats: [],
            knownUnsupported: [],
          },
        ],
      }),
      "utf8",
    );

    const result = await runCanarySuite({
      repoRoot: dir,
      manifestPath: manifestFile,
      canaryId: "tiny-canary",
      now: new Date("2026-06-17T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.report.canaryResults[0]?.thresholds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "minCoverageExactOrOverlay",
          status: "fail",
        }),
      ]),
    );
    expect(result.lines.join("\n")).toMatch(/coverage/i);
    expect(result.report.classifications.length).toBeGreaterThan(0);
  });

  it("does not run planned canaries by default", async () => {
    const manifest = parseCanaryManifest(await readFile(manifestPath, "utf8"));
    const result = await runCanarySuite({
      repoRoot,
      manifestPath,
      now: new Date("2026-06-17T00:00:00.000Z"),
    });
    const selectedIds = result.report.canaryResults.map(
      (entry) => entry.canaryId,
    );
    for (const canary of manifest.canaries) {
      if (canary.status === "planned") {
        expect(selectedIds).not.toContain(canary.id);
      }
    }
  }, 120_000);

  it("keeps generated artifacts outside canary app roots", async () => {
    const canaryRoot = join(repoRoot, "examples/demo-app");
    const before = await readdir(canaryRoot);
    await runCanarySuite({
      repoRoot,
      manifestPath,
      canaryId: "examples-demo-app",
      now: new Date("2026-06-12T00:00:00.000Z"),
    });
    const after = await readdir(canaryRoot);
    expect(after).toEqual(before);
    expect(after).not.toContain(".modality");
  });
});
