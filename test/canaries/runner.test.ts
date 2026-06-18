import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertCoverageThreshold,
  assertSeededBugExpectations,
} from "../../tools/canary/assertions.js";
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
      }),
    ]);
  });

  it("fails and records a threshold result for a synthetic canary manifest", async () => {
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
      "export const properties = [];",
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
  });
});
