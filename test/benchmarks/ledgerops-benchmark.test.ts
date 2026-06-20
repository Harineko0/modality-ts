import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ledgerOpsPages } from "../../benchmarks/shared/app-spec/pages.js";
import { ledgerOpsProperties } from "../../benchmarks/shared/app-spec/property-catalog.js";
import { ledgerOpsRoutes } from "../../benchmarks/shared/app-spec/routes.js";
import { ledgerOpsSeededOutcomes } from "../../benchmarks/shared/app-spec/seeded-outcomes.js";
import { runBenchmarkSuite } from "../../tools/benchmark/runner.js";

const repoRoot = join(import.meta.dirname, "..", "..");
const manifestPath = join(repoRoot, "benchmarks", "manifest.json");

describe("ledgerops benchmark runner", () => {
  it("runs both frameworks with bounded search and expected classification counts", async () => {
    const reportPath = join(
      repoRoot,
      ".modality",
      "ledgerops-benchmark.test-report.json",
    );
    const result = await runBenchmarkSuite({
      repoRoot,
      manifestPath,
      reportPath,
    });

    expect(result.report.frameworks).toHaveLength(2);
    for (const framework of result.report.frameworks) {
      expect(framework.routeCount).toBeGreaterThanOrEqual(
        ledgerOpsRoutes.length,
      );
      expect(framework.libraryCoverage.jotai).toBe(true);
      expect(framework.libraryCoverage.zustand).toBe(true);
      expect(framework.libraryCoverage.swr).toBe(true);
      expect(framework.libraryCoverage.zod).toBe(true);
      expect(framework.libraryCoverage.arktype).toBe(true);
      expect(framework.classification.truePositiveViolations).toBe(7);
      expect(framework.classification.trueNegativeVerified).toBe(7);
      expect(framework.classification.falsePositiveProbes).toBe(3);
      expect(framework.classification.falseNegativeProbes).toBe(3);
    }

    const rbacProperties = ledgerOpsProperties.filter((name) =>
      name.startsWith("rbac."),
    );
    const managementProperties = ledgerOpsProperties.filter((name) =>
      name.startsWith("management."),
    );
    for (const framework of result.report.frameworks) {
      for (const property of [...rbacProperties, ...managementProperties]) {
        expect(
          framework.propertyVerdicts.some((entry) =>
            entry.property.includes(property),
          ),
          `${framework.benchmarkId} missing ${property}`,
        ).toBe(true);
      }
    }

    for (const outcome of ledgerOpsSeededOutcomes) {
      if (outcome.metadataOnly) continue;
      for (const framework of result.report.frameworks) {
        expect(
          framework.propertyVerdicts.some(
            (entry) => entry.seededOutcomeId === outcome.id,
          ),
        ).toBe(true);
      }
    }

    const zustandPageCount = ledgerOpsPages.filter(
      (page) => page.stateOwner.library === "zustand",
    ).length;
    const jotaiPageCount = ledgerOpsPages.filter(
      (page) => page.stateOwner.library === "jotai",
    ).length;
    expect(zustandPageCount).toBeGreaterThan(0);
    expect(jotaiPageCount).toBeGreaterThan(0);
    expect(zustandPageCount + jotaiPageCount).toBe(ledgerOpsPages.length);

    expect(result.exitCode).toBe(0);
  }, 300_000);
});
