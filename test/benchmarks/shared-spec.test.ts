import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ledgerOpsPages } from "../../benchmarks/shared/app-spec/pages.js";
import {
  ledgerOpsEffectApis,
  ledgerOpsProperties,
} from "../../benchmarks/shared/app-spec/property-catalog.js";
import { ledgerOpsRoutes } from "../../benchmarks/shared/app-spec/routes.js";
import { ledgerOpsSeededOutcomes } from "../../benchmarks/shared/app-spec/seeded-outcomes.js";
import { permissionsByRole } from "../../benchmarks/shared/features/auth/domain/rbac.js";
import {
  allPermissions,
  type Permission,
} from "../../benchmarks/shared/features/fixtures/domain/fixtures.js";
import {
  assertSharedSpecParity,
  type BenchmarkManifest,
  manifestIncludesAllEffectApis,
} from "../../benchmarks/shared/testing/parity.js";

const repoRoot = join(import.meta.dirname, "..", "..");
const manifestPath = join(repoRoot, "benchmarks", "manifest.json");

function readManifestIfPresent(): BenchmarkManifest | null {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, "utf8")) as BenchmarkManifest;
}

describe("ledgerops shared benchmark spec", () => {
  it("checks every route has a page matrix entry", () => {
    for (const route of ledgerOpsRoutes) {
      expect(
        ledgerOpsPages.some((page) => page.route === route),
        `missing page matrix entry for ${route}`,
      ).toBe(true);
    }
    expect(ledgerOpsPages).toHaveLength(ledgerOpsRoutes.length);
  });

  it("checks every effect API appears in both app manifests after plan 07/08 land", () => {
    const manifest = readManifestIfPresent();
    if (!manifest) return;
    expect(manifestIncludesAllEffectApis(manifest)).toBe(true);
    for (const api of ledgerOpsEffectApis) {
      for (const benchmark of manifest.benchmarks) {
        expect(benchmark.effectApis).toContain(api);
      }
    }
  });

  it("checks every seeded outcome references a property or is marked metadata-only FN", () => {
    for (const outcome of ledgerOpsSeededOutcomes) {
      if (outcome.metadataOnly) {
        expect(outcome.property).toBeNull();
        expect(outcome.class).toBe("FN probe");
        continue;
      }
      expect(outcome.property).not.toBeNull();
      expect(ledgerOpsProperties).toContain(outcome.property);
    }
  });

  it("checks RBAC matrix grants admin all permissions and guest no authenticated permissions", () => {
    const adminPermissions = permissionsByRole.admin;
    const guestPermissions = permissionsByRole.guest;

    expect(guestPermissions).toHaveLength(0);
    expect(adminPermissions).toHaveLength(allPermissions.length);
    for (const permission of allPermissions) {
      expect(adminPermissions).toContain(permission);
    }
    for (const role of ["analyst", "manager", "admin"] as const) {
      for (const permission of permissionsByRole[role]) {
        expect(allPermissions).toContain(permission as Permission);
      }
    }
  });

  it("keeps shared route, page, and seeded-outcome exports aligned", () => {
    expect(() => assertSharedSpecParity()).not.toThrow();
  });
});
