import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertConformPassRate,
  assertCoverageThreshold,
  assertSemanticExpectations,
  assertStateSpaceBudget,
} from "../../tools/conformance/assertions.js";
import {
  parseConformanceFixtureManifest,
  readConformanceFixtureManifest,
  validateConformanceFixturePaths,
} from "../../tools/conformance/manifest.js";
import {
  listFixtureRootEntries,
  runConformanceMatrix,
} from "../../tools/conformance/runner.js";
import type { CheckReport, ConformReport, ExtractionReport, Model } from "modality-ts/core";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const matrixPath = join(repoRoot, "test/conformance/matrix.json");

describe("conformance fixture manifest", () => {
  it("loads repository fixture manifests with existing paths", async () => {
    for (const fixtureId of [
      "state-local-setter-batch",
      "scope-mount-reset",
      "routing-location-assign",
    ]) {
      const fixtureRoot = join(
        repoRoot,
        "test/conformance/fixtures",
        fixtureId,
      );
      const manifest = await readConformanceFixtureManifest(
        repoRoot,
        fixtureRoot,
      );
      await validateConformanceFixturePaths(fixtureRoot, manifest);
      expect(manifest.id).toBe(fixtureId);
      expect(manifest.sourcePaths.length).toBeGreaterThan(0);
      expect(manifest.propsPaths.length).toBeGreaterThan(0);
    }
  });

  it("rejects missing fixture paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-fixture-manifest-"));
    const fixtureRoot = join(dir, "broken-fixture");
    await mkdir(join(fixtureRoot, "app"), { recursive: true });
    const manifest = parseConformanceFixtureManifest(
      JSON.stringify({
        id: "broken-fixture",
        featureIds: ["feature.a"],
        targetIds: ["core"],
        root: "broken-fixture",
        sourcePaths: ["app/Missing.tsx"],
        propsPaths: ["app/app.props.ts"],
      }),
      dir,
      fixtureRoot,
    );
    await expect(
      validateConformanceFixturePaths(fixtureRoot, manifest),
    ).rejects.toThrow(/fixture invalid: missing source path/);
  });
});

describe("conformance assertion helpers", () => {
  const extractionReport = {
    coverage: { percentExactOrOverlay: 0.5 },
    globalTaints: [],
    staleReads: [],
    unhandledRejections: [],
    stateContributors: { totalBits: 1, topVars: [], bySource: [] },
  } as ExtractionReport;

  it("fails low coverage thresholds", () => {
    expect(
      assertCoverageThreshold(extractionReport, 1).status,
    ).toBe("fail");
  });

  it("fails conform pass-rate thresholds", () => {
    const report = {
      metrics: { passRate: 0.5 },
      transitionMetrics: [{ passRate: 0.5 }],
    } as ConformReport;
    expect(assertConformPassRate(report, 1).status).toBe("fail");
  });

  it("records state-space budget failures", () => {
    const checkReport = {
      stats: { states: 99, edges: 10, depth: 1 },
      diagnostics: { search: { maxFrontier: 9 } },
    } as CheckReport;
    expect(
      assertStateSpaceBudget(checkReport, { maxStates: 10, maxFrontier: 5 }),
    ).toEqual([
      expect.objectContaining({ id: "maxStates", status: "fail" }),
      expect.objectContaining({ id: "maxFrontier", status: "fail" }),
    ]);
  });

  it("checks semantic transition and var expectations", () => {
    const model = {
      transitions: [{ id: "App.onClick.count", effect: { kind: "assign", var: "local:App.count", expr: { kind: "lit", value: 1 } } }],
      vars: [
        {
          id: "local:App.count",
          scope: { kind: "route-local", route: "/" },
          domain: { kind: "boundedInt", min: 0, max: 1 },
        },
      ],
    } as Model;
    expect(
      assertSemanticExpectations(model, extractionReport, {
        transitionIds: ["App.onClick.missing"],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "transition:App.onClick.missing",
      }),
    ]);
  });
});

describe("conformance runner", () => {
  it("runs the setter batch fixture successfully", async () => {
    const result = await runConformanceMatrix({
      repoRoot,
      matrixPath,
      fixtureId: "state-local-setter-batch",
      now: new Date("2026-06-17T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report.fixtureResults).toEqual([
      expect.objectContaining({
        fixtureId: "state-local-setter-batch",
        status: "pass",
      }),
    ]);
  });

  it("fails on low coverage for a synthetic fixture manifest", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conformance-runner-"));
    const fixtureRoot = join(dir, "tiny-fixture");
    await mkdir(join(fixtureRoot, "app"), { recursive: true });
    await writeFile(
      join(fixtureRoot, "app/App.tsx"),
      `
      export function App() {
        return <button type="button" onClick={() => unknownHandler()}>Go</button>;
      }
      `,
      "utf8",
    );
    await writeFile(
      join(fixtureRoot, "app/app.props.ts"),
      "export const properties = [];",
      "utf8",
    );
    await writeFile(
      join(fixtureRoot, "app/package.json"),
      JSON.stringify({ private: true, dependencies: { react: "^18.0.0" } }),
      "utf8",
    );
    await writeFile(
      join(fixtureRoot, "fixture.json"),
      JSON.stringify({
        id: "tiny-fixture",
        featureIds: ["feature.a"],
        targetIds: ["core"],
        root: "tiny-fixture",
        sourcePaths: ["app/App.tsx"],
        propsPaths: ["app/app.props.ts"],
        extract: { packageJsonPath: "app/package.json" },
        check: { enabled: false },
        conform: { enabled: false },
        thresholds: { minCoverageExactOrOverlay: 1 },
      }),
      "utf8",
    );
    const matrix = {
      schemaVersion: 1,
      features: [
        {
          id: "feature.a",
          title: "Feature",
          layer: "core-ir",
          contract: "core-spec",
          requiredFixtures: [],
        },
      ],
      targets: [{ id: "core", title: "Core" }],
      fixtures: [
        {
          id: "tiny-fixture",
          featureIds: ["feature.a"],
          targetIds: ["core"],
          root: "tiny-fixture",
        },
      ],
      cells: [
        {
          featureId: "feature.a",
          targetId: "core",
          status: "supported",
          fixtures: ["tiny-fixture"],
        },
      ],
    };
    const matrixFile = join(dir, "matrix.json");
    await writeFile(matrixFile, JSON.stringify(matrix), "utf8");

    const result = await runConformanceMatrix({
      repoRoot: dir,
      matrixPath: matrixFile,
      fixtureId: "tiny-fixture",
      now: new Date("2026-06-17T00:00:00.000Z"),
    });
    expect(result.exitCode).toBe(2);
    expect(result.lines.join("\n")).toMatch(/coverage/i);
  });

  it("fails on conform pass-rate threshold", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-conformance-threshold-"));
    const fixtureRoot = join(
      repoRoot,
      "test/conformance/fixtures/state-local-setter-batch",
    );
    const manifest = await readConformanceFixtureManifest(repoRoot, fixtureRoot);
    const overridden = {
      ...manifest,
      thresholds: {
        ...manifest.thresholds,
        minConformPassRate: 2,
      },
    };
    const localFixtureRoot = join(dir, "state-local-setter-batch");
    await mkdir(join(localFixtureRoot, "app"), { recursive: true });
    await writeFile(
      join(localFixtureRoot, "fixture.json"),
      JSON.stringify({
        ...overridden,
        root: "state-local-setter-batch",
      }),
      "utf8",
    );
    for (const relativePath of ["app/App.tsx", "app/app.props.ts", "app/package.json"]) {
      const { copyFile } = await import("node:fs/promises");
      await copyFile(
        join(fixtureRoot, relativePath),
        join(localFixtureRoot, relativePath),
      );
    }
    const matrixFile = join(dir, "matrix.json");
    await writeFile(
      matrixFile,
      JSON.stringify({
        schemaVersion: 1,
        features: [
          {
            id: "feature.a",
            title: "Feature",
            layer: "core-ir",
            contract: "core-spec",
            requiredFixtures: [],
          },
        ],
        targets: [{ id: "core", title: "Core" }],
        fixtures: [
          {
            id: "state-local-setter-batch",
            featureIds: ["feature.a"],
            targetIds: ["core"],
            root: "state-local-setter-batch",
          },
        ],
        cells: [
          {
            featureId: "feature.a",
            targetId: "core",
            status: "supported",
            fixtures: ["state-local-setter-batch"],
          },
        ],
      }),
      "utf8",
    );

    const failed = await runConformanceMatrix({
      repoRoot: dir,
      matrixPath: matrixFile,
      fixtureId: "state-local-setter-batch",
      now: new Date("2026-06-17T00:00:00.000Z"),
    });
    expect(failed.exitCode).toBe(2);
    expect(failed.lines.join("\n")).toMatch(/conform pass rate/i);
  });

  it("keeps generated artifacts outside fixture roots", async () => {
    const fixtureRoot = join(
      repoRoot,
      "test/conformance/fixtures/state-local-setter-batch",
    );
    const before = await listFixtureRootEntries(fixtureRoot);
    await runConformanceMatrix({
      repoRoot,
      matrixPath,
      fixtureId: "state-local-setter-batch",
      now: new Date("2026-06-17T00:00:00.000Z"),
    });
    const after = await listFixtureRootEntries(fixtureRoot);
    expect(after).toEqual(before);
  });
});
