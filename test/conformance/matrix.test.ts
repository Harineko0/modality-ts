import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  parseCanaryRunReportArtifact,
  parseConformanceMatrixReportArtifact,
  parseConformReportArtifact,
} from "modality-ts/core";
import { createBuiltinModalityRegistry } from "../../src/cli/registry/index.js";
import {
  parseConformanceMatrixManifest,
  readConformanceMatrixManifest,
} from "../../tools/conformance/manifest.js";

const matrixPath = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "matrix.json",
);

describe("conformance matrix manifest", () => {
  it("parses the repository matrix with valid references", async () => {
    const manifest = await readConformanceMatrixManifest(matrixPath);
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.features.length).toBeGreaterThan(0);
    expect(manifest.targets.length).toBeGreaterThan(0);
    expect(manifest.fixtures.length).toBeGreaterThan(0);
    expect(manifest.fixtures.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining([
        "state-local-setter-batch",
        "scope-mount-reset",
        "routing-location-assign",
        "tanstack-file-routing",
        "tanstack-code-routing",
        "tanstack-loader-cache",
      ]),
    );
  });

  it("requires supported cells to name at least one fixture", async () => {
    const manifest = await readConformanceMatrixManifest(matrixPath);
    for (const cell of manifest.cells) {
      if (cell.status === "supported") {
        expect(cell.fixtures.length).toBeGreaterThan(0);
      }
    }
  });

  it("keeps supported cells aligned with canonical fixture ids", async () => {
    const manifest = await readConformanceMatrixManifest(matrixPath);
    const fixtureIds = new Set(manifest.fixtures.map((fixture) => fixture.id));
    const supportedFixtureIds = new Set(
      manifest.cells
        .filter((cell) => cell.status === "supported")
        .flatMap((cell) => cell.fixtures),
    );
    for (const fixtureId of supportedFixtureIds) {
      expect(fixtureIds.has(fixtureId)).toBe(true);
    }
    expect([...supportedFixtureIds]).toEqual(
      expect.arrayContaining([
        "state-local-setter-batch",
        "scope-mount-reset",
        "routing-location-assign",
        "tanstack-file-routing",
        "tanstack-code-routing",
      ]),
    );
  });

  it("covers every builtin source adapter and type-library adapter", async () => {
    const manifest = await readConformanceMatrixManifest(matrixPath);
    const registry = createBuiltinModalityRegistry();
    const adapterIds = [
      ...registry.sourcePluginIds,
      ...(registry.routerPluginId ? [registry.routerPluginId] : []),
      ...registry.domainRefinementProviders.map((provider) => provider.id),
    ];
    const coveredAdapterIds = new Set(
      manifest.targets
        .map((target) => target.adapterId)
        .filter((adapterId): adapterId is string => adapterId !== undefined),
    );
    for (const adapterId of adapterIds) {
      expect(coveredAdapterIds.has(adapterId)).toBe(true);
    }
  });

  it("rejects orphan fixture, feature, and target references", () => {
    const base = minimalMatrix();
    expect(() =>
      parseConformanceMatrixManifest(
        JSON.stringify({
          ...base,
          cells: [
            {
              featureId: "missing-feature",
              targetId: "core",
              status: "partial",
              fixtures: [],
            },
          ],
        }),
      ),
    ).toThrow("unknown feature id missing-feature");
    expect(() =>
      parseConformanceMatrixManifest(
        JSON.stringify({
          ...base,
          cells: [
            {
              featureId: "feature.a",
              targetId: "missing-target",
              status: "partial",
              fixtures: [],
            },
          ],
        }),
      ),
    ).toThrow("unknown target id missing-target");
    expect(() =>
      parseConformanceMatrixManifest(
        JSON.stringify({
          ...base,
          fixtures: [
            {
              id: "fixture.a",
              featureIds: ["feature.a"],
              targetIds: ["core"],
            },
          ],
          cells: [
            {
              featureId: "feature.a",
              targetId: "core",
              status: "partial",
              fixtures: ["missing-fixture"],
            },
          ],
        }),
      ),
    ).toThrow("unknown fixture id missing-fixture");
  });

  it("rejects supported cells without fixtures", () => {
    expect(() =>
      parseConformanceMatrixManifest(
        JSON.stringify({
          ...minimalMatrix(),
          cells: [
            {
              featureId: "feature.a",
              targetId: "core",
              status: "supported",
              fixtures: [],
            },
          ],
        }),
      ),
    ).toThrow("supported cell feature.a/core must name at least one fixture");
  });

  it("validates threshold and budget fields on matrix cells", () => {
    expect(() =>
      parseConformanceMatrixManifest(
        JSON.stringify({
          ...minimalMatrix(),
          cells: [
            {
              featureId: "feature.a",
              targetId: "core",
              status: "partial",
              fixtures: [],
              minCoverageExactOrOverlay: 1.5,
            },
          ],
        }),
      ),
    ).toThrow(/minCoverageExactOrOverlay/);
    expect(() =>
      parseConformanceMatrixManifest(
        JSON.stringify({
          ...minimalMatrix(),
          cells: [
            {
              featureId: "feature.a",
              targetId: "core",
              status: "partial",
              fixtures: [],
              maxStates: 0,
            },
          ],
        }),
      ),
    ).toThrow(/maxStates/);
  });
});

describe("parseConformanceMatrixReportArtifact", () => {
  const validReport = {
    schemaVersion: 1,
    kind: "conformance-matrix-report",
    generatedAt: "2026-06-17T00:00:00.000Z",
    matrixId: "repo-matrix",
    fixtureResults: [
      {
        fixtureId: "state-local-setter-batch",
        status: "pass",
        featureIds: ["state.local.setter-batching"],
        targetIds: ["react-use-state"],
        thresholds: [
          {
            id: "minConformPassRate",
            status: "pass",
            expected: 1,
            actual: 1,
          },
        ],
        budgets: [
          {
            id: "search",
            status: "pass",
            maxStates: 100,
            actualStates: 12,
          },
        ],
      },
    ],
  };

  it("accepts a minimal valid conformance matrix report", () => {
    expect(
      parseConformanceMatrixReportArtifact(JSON.stringify(validReport)),
    ).toMatchObject({
      kind: "conformance-matrix-report",
      matrixId: "repo-matrix",
    });
  });

  it("rejects unsupported schema versions", () => {
    expect(() =>
      parseConformanceMatrixReportArtifact(
        JSON.stringify({ ...validReport, schemaVersion: 2 }),
      ),
    ).toThrow("unsupported conformance matrix report schemaVersion 2");
  });

  it("rejects missing required report fields", () => {
    expect(() =>
      parseConformanceMatrixReportArtifact(
        JSON.stringify({
          schemaVersion: 1,
          kind: "conformance-matrix-report",
          generatedAt: "2026-06-17T00:00:00.000Z",
        }),
      ),
    ).toThrow("conformance matrix report matrixId must be a non-empty string");
    expect(() =>
      parseConformanceMatrixReportArtifact(
        JSON.stringify({
          ...validReport,
          fixtureResults: [
            {
              fixtureId: "",
              status: "pass",
              featureIds: ["feature.a"],
              targetIds: ["core"],
            },
          ],
        }),
      ),
    ).toThrow("fixtureResults[0].fixtureId must be a non-empty string");
  });

  it("rejects malformed pass rates and budget values", () => {
    expect(() =>
      parseConformanceMatrixReportArtifact(
        JSON.stringify({
          ...validReport,
          thresholdResults: [
            { id: "coverage", status: "fail", expected: 1.5, actual: 0.5 },
          ],
        }),
      ),
    ).toThrow("thresholdResults[0].expected must be a number between 0 and 1");
    expect(() =>
      parseConformanceMatrixReportArtifact(
        JSON.stringify({
          ...validReport,
          budgetResults: [{ id: "states", status: "fail", maxStates: 0 }],
        }),
      ),
    ).toThrow("budgetResults[0].maxStates must be a positive integer");
  });
});

describe("parseConformReportArtifact optional metadata", () => {
  it("accepts optional fixture, feature, target, and threshold metadata", () => {
    expect(
      parseConformReportArtifact(
        JSON.stringify({
          schemaVersion: 1,
          kind: "conform-report",
          generatedAt: "2026-06-17T00:00:00.000Z",
          fixtureId: "state-local-setter-batch",
          featureIds: ["state.local.setter-batching"],
          targetIds: ["react-use-state"],
          thresholds: { minPassRate: 1, minTransitionPassRate: 0.9 },
          walks: [],
          metrics: {
            total: 0,
            reproduced: 0,
            notReproduced: 0,
            inconclusive: 0,
            passRate: 1,
          },
          transitionMetrics: [],
        }),
      ),
    ).toMatchObject({
      fixtureId: "state-local-setter-batch",
      featureIds: ["state.local.setter-batching"],
      targetIds: ["react-use-state"],
      thresholds: { minPassRate: 1, minTransitionPassRate: 0.9 },
    });
  });

  it("rejects malformed optional conform metadata", () => {
    expect(() =>
      parseConformReportArtifact(
        JSON.stringify({
          schemaVersion: 1,
          kind: "conform-report",
          generatedAt: "2026-06-17T00:00:00.000Z",
          thresholds: { minPassRate: 2 },
          walks: [],
          metrics: {
            total: 0,
            reproduced: 0,
            notReproduced: 0,
            inconclusive: 0,
            passRate: 1,
          },
          transitionMetrics: [],
        }),
      ),
    ).toThrow("conform report minPassRate must be a number between 0 and 1");
  });
});

function minimalMatrix() {
  return {
    schemaVersion: 1,
    features: [
      {
        id: "feature.a",
        title: "Feature A",
        layer: "core-ir",
        contract: "core-spec",
        requiredFixtures: [],
      },
    ],
    targets: [{ id: "core", title: "Core" }],
    fixtures: [],
    cells: [
      {
        featureId: "feature.a",
        targetId: "core",
        status: "partial",
        fixtures: [],
      },
    ],
  };
}

describe("matrix.json loads from disk", () => {
  it("is valid JSON consumed by the manifest parser", async () => {
    const json = await readFile(matrixPath, "utf8");
    const manifest = parseConformanceMatrixManifest(json);
    expect(manifest.features.some((feature) => feature.id.includes("."))).toBe(
      true,
    );
    expect(
      manifest.targets.some((target) => target.id === "react-use-state"),
    ).toBe(true);
    expect(() => parseCanaryRunReportArtifact(json)).toThrow();
  });
});
