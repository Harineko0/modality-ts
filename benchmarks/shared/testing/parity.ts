import { ledgerOpsEffectApis } from "../app-spec/property-catalog.js";
import { ledgerOpsSeededOutcomes } from "../app-spec/seeded-outcomes.js";
import { ledgerOpsRoutes } from "../app-spec/routes.js";
import { ledgerOpsPages } from "../app-spec/pages.js";
import { assertRouteParity } from "./route-fixtures.js";

export type FrameworkId = "ledgerops-react-router" | "ledgerops-nextjs";

export type BenchmarkManifestBenchmark = {
  id: FrameworkId;
  effectApis: readonly string[];
};

export type BenchmarkManifest = {
  benchmarks: readonly BenchmarkManifestBenchmark[];
};

export function routesMatchPages(): boolean {
  return ledgerOpsRoutes.every((route) =>
    ledgerOpsPages.some((page) => page.route === route),
  );
}

export function manifestIncludesAllEffectApis(
  manifest: BenchmarkManifest,
): boolean {
  return manifest.benchmarks.every((benchmark) =>
    ledgerOpsEffectApis.every((api) => benchmark.effectApis.includes(api)),
  );
}

export function seededOutcomesReferenceProperties(): boolean {
  return ledgerOpsSeededOutcomes.every((outcome) => {
    if (outcome.metadataOnly) {
      return outcome.property === null;
    }
    return outcome.property !== null;
  });
}

export function assertSharedSpecParity(): void {
  assertRouteParity();
  if (!routesMatchPages()) {
    throw new Error("ledgerOpsRoutes and ledgerOpsPages are out of sync");
  }
  if (!seededOutcomesReferenceProperties()) {
    throw new Error(
      "seeded outcomes must reference a property or be metadata-only",
    );
  }
}
