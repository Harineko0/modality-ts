import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ledgerOpsPages } from "../../benchmarks/shared/app-spec/pages.js";
import {
  ledgerOpsArktypeDomains,
  ledgerOpsEffectApis,
  ledgerOpsJotaiPrimaryRoutes,
  ledgerOpsProperties,
  ledgerOpsZodDomains,
  ledgerOpsZustandPrimaryRoutes,
} from "../../benchmarks/shared/app-spec/property-catalog.js";
import { ledgerOpsRoutes } from "../../benchmarks/shared/app-spec/routes.js";
import { ledgerOpsSeededOutcomes } from "../../benchmarks/shared/app-spec/seeded-outcomes.js";
import { readBenchmarkManifest } from "../../tools/benchmark/manifest.js";

const repoRoot = join(import.meta.dirname, "..", "..");
const manifestPath = join(repoRoot, "benchmarks", "manifest.json");

describe("ledgerops benchmark manifest", () => {
  it("validates ids, paths, effect APIs, and expected counts", async () => {
    const manifest = await readBenchmarkManifest(manifestPath);
    expect(manifest.benchmarks).toHaveLength(2);
    expect(manifest.benchmarks.map((entry) => entry.id)).toEqual([
      "ledgerops-react-router",
      "ledgerops-nextjs",
    ]);

    for (const benchmark of manifest.benchmarks) {
      expect(benchmark.propsPaths).toHaveLength(ledgerOpsRoutes.length);
      expect(benchmark.sourcePaths.length).toBeGreaterThanOrEqual(
        ledgerOpsRoutes.length,
      );
      for (const api of ledgerOpsEffectApis) {
        expect(benchmark.effectApis).toContain(api);
      }
      expect(benchmark.expected).toEqual({
        truePositiveViolations: 7,
        trueNegativeVerified: 7,
        falsePositiveProbes: 3,
        falseNegativeProbes: 3,
      });
    }
  });

  it("requires mixed library allocation across planned pages", () => {
    const jotaiRoutes = new Set(ledgerOpsJotaiPrimaryRoutes);
    const zustandRoutes = new Set(ledgerOpsZustandPrimaryRoutes);
    let jotaiPages = 0;
    let zustandPages = 0;
    let zodPages = 0;
    let arktypePages = 0;

    for (const page of ledgerOpsPages) {
      if (page.stateOwner.library === "jotai") {
        expect(jotaiRoutes.has(page.route)).toBe(true);
        jotaiPages += 1;
      }
      if (page.stateOwner.library === "zustand") {
        expect(zustandRoutes.has(page.route)).toBe(true);
        zustandPages += 1;
      }
      if (page.validationOwner.library === "zod") {
        zodPages += 1;
      }
      if (page.validationOwner.library === "arktype") {
        arktypePages += 1;
      }
    }

    expect(jotaiPages).toBeGreaterThan(0);
    expect(zustandPages).toBeGreaterThan(0);
    expect(zodPages).toBeGreaterThanOrEqual(ledgerOpsZodDomains.length);
    expect(arktypePages).toBeGreaterThanOrEqual(ledgerOpsArktypeDomains.length);
    expect(jotaiPages + zustandPages).toBe(ledgerOpsPages.length);
  });

  it("references seeded outcomes and core properties", () => {
    for (const outcome of ledgerOpsSeededOutcomes) {
      if (outcome.metadataOnly) continue;
      expect(ledgerOpsProperties).toContain(outcome.property);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      benchmarks: { effectApis: string[] }[];
    };
    const uniqueApis = new Set(
      manifest.benchmarks.flatMap((entry) => entry.effectApis),
    );
    expect(uniqueApis.size).toBe(ledgerOpsEffectApis.length);
  });
});
