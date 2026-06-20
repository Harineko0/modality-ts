import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runExtractCommand } from "../../src/cli/extract.js";
import { ledgerOpsRoutes } from "../../benchmarks/shared/app-spec/routes.js";
import { ledgerOpsPages } from "../../benchmarks/shared/app-spec/pages.js";
import {
  ledgerOpsArktypeDomains,
  ledgerOpsEffectApis,
  ledgerOpsJotaiStateNames,
  ledgerOpsSwrHooks,
  ledgerOpsZodDomains,
} from "../../benchmarks/shared/app-spec/property-catalog.js";

const repoRoot = join(import.meta.dirname, "..", "..");
const benchmarkRoot = join(repoRoot, "benchmarks", "nextjs");
const packageJsonPath = join(benchmarkRoot, "package.json");

const sourcePaths = [
  "src/app/page.tsx",
  "src/app/login/page.tsx",
  "src/app/dashboard/page.tsx",
  "src/app/management/page.tsx",
  "src/app/management/risk/page.tsx",
  "src/app/management/revenue/page.tsx",
  "src/app/management/operations/page.tsx",
  "src/app/accounts/page.tsx",
  "src/app/accounts/[accountId]/page.tsx",
  "src/app/accounts/[accountId]/subscription/page.tsx",
  "src/app/accounts/[accountId]/billing/page.tsx",
  "src/app/accounts/[accountId]/payment-methods/page.tsx",
  "src/app/accounts/[accountId]/invoices/[invoiceId]/page.tsx",
  "src/app/accounts/[accountId]/support/page.tsx",
  "src/app/approvals/page.tsx",
  "src/app/audit/page.tsx",
  "src/app/settings/page.tsx",
  "src/app/settings/rbac/page.tsx",
].map((path) => join(benchmarkRoot, path));

const propsPaths = ledgerOpsRoutes.map((route) => {
  const page = ledgerOpsPages.find((entry) => entry.route === route);
  expect(page).toBeDefined();
  const segments = route
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith(":") ? `[${segment.slice(1)}]` : segment,
    );
  return join(benchmarkRoot, "src", "app", ...segments, "page.props.ts");
});

function readPackageJson() {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    dependencies: Record<string, string>;
  };
}

describe("ledgerops nextjs benchmark", () => {
  it("declares all five supported libraries in package dependencies", () => {
    const pkg = readPackageJson();
    for (const dep of ["jotai", "zustand", "swr", "zod", "arktype"]) {
      expect(pkg.dependencies[dep], `missing dependency ${dep}`).toBeDefined();
    }
  });

  it("extracts all App Router pages with Jotai, Zustand, SWR, Zod, and ArkType coverage", async () => {
    const reportPath = join(
      repoRoot,
      ".modality",
      "ledgerops-nextjs.extract.json",
    );
    const modelPath = join(
      repoRoot,
      ".modality",
      "ledgerops-nextjs.model.json",
    );

    const result = await runExtractCommand({
      sourcePaths,
      modelPath,
      reportPath,
      packageJsonPath,
      configPath: join(benchmarkRoot, "modality.config.ts"),
      propsPath: join(benchmarkRoot, "src/app/login/page.props.ts"),
      propsPaths,
    });

    expect(result.model.metadata?.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "navigation", id: "next" }),
      ]),
    );

    const routeVar = result.model.vars.find(
      (entry) => entry.id === "sys:route",
    );
    expect(routeVar?.domain).toMatchObject({ kind: "enum" });
    if (routeVar?.domain.kind === "enum") {
      for (const route of ledgerOpsRoutes) {
        expect(routeVar.domain.values, `missing route ${route}`).toContain(
          route,
        );
      }
    }

    expect(
      result.model.vars.some((decl) => decl.id.startsWith("sys:next:slot:")),
    ).toBe(true);

    const varIds = new Set(result.model.vars.map((entry) => entry.id));
    for (const stateName of ledgerOpsJotaiStateNames) {
      if (
        ledgerOpsPages.some(
          (page) =>
            page.stateOwner.library === "jotai" &&
            page.stateOwner.stateNames.includes(stateName),
        )
      ) {
        expect(
          [...varIds].some((id) => id.includes(stateName)),
          `missing jotai var for ${stateName}`,
        ).toBe(true);
      }
    }

    for (const page of ledgerOpsPages) {
      if (page.stateOwner.library !== "zustand") continue;
      for (const stateName of page.stateOwner.stateNames) {
        expect(
          [...varIds].some((id) => id.includes(stateName)),
          `missing zustand var for ${stateName} on ${page.route}`,
        ).toBe(true);
      }
    }

    const transitionIds = result.model.transitions.map((entry) => entry.id);
    const effectSurface = [
      ...(result.report.handlers?.map((entry) => entry.id) ?? []),
      ...transitionIds,
      JSON.stringify(result.model),
      readFileSync(
        join(benchmarkRoot, "src/features/auth/infra/api.ts"),
        "utf8",
      ),
    ].join("\n");

    for (const api of ledgerOpsEffectApis) {
      const op = api.replace("api.", "");
      expect(effectSurface, `missing effect api ${api}`).toContain(op);
    }

    const infraPaths = [
      "src/features/dashboard/infra/dashboard-queries.ts",
      "src/features/accounts/infra/account-queries.ts",
      "src/features/management/infra/management-queries.ts",
      "src/features/subscription/infra/subscription-queries.ts",
      "src/features/billing/infra/billing-queries.ts",
      "src/features/billing/infra/api.ts",
      "src/features/support/infra/support-queries.ts",
      "src/features/audit/infra/audit-queries.ts",
      "src/features/settings/infra/settings-queries.ts",
      "src/features/auth/infra/api.ts",
    ].map((path) => join(benchmarkRoot, path));

    const routeComponentPaths = [
      "src/app/login/_components/LoginForm.tsx",
      "src/app/dashboard/_components/DashboardSummary.tsx",
      "src/app/management/_components/ManagementOverview.tsx",
      "src/app/management/risk/_components/RiskBulkPanel.tsx",
      "src/app/management/revenue/_components/RevenueQueuePanel.tsx",
      "src/app/management/operations/_components/OperationsQueuePanel.tsx",
      "src/app/accounts/_components/AccountList.tsx",
      "src/app/accounts/[accountId]/_components/AccountProfile.tsx",
      "src/app/accounts/[accountId]/subscription/_components/SubscriptionEditor.tsx",
      "src/app/accounts/[accountId]/billing/_components/BillingWorkbench.tsx",
      "src/app/accounts/[accountId]/payment-methods/_components/PaymentMethodEditor.tsx",
      "src/app/accounts/[accountId]/invoices/[invoiceId]/_components/InvoiceActions.tsx",
      "src/app/accounts/[accountId]/support/_components/SupportEscalationForm.tsx",
      "src/app/approvals/_components/ApprovalQueue.tsx",
      "src/app/audit/_components/AuditExportPanel.tsx",
      "src/app/settings/_components/TenantSettingsForm.tsx",
      "src/app/settings/rbac/_components/RoleAssignmentForm.tsx",
    ].map((path) => join(benchmarkRoot, path));

    const sourceSurface = [
      ...sourcePaths,
      ...infraPaths,
      ...routeComponentPaths,
    ]
      .filter((path) => existsSync(path))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    for (const hook of ledgerOpsSwrHooks) {
      expect(sourceSurface, `missing swr hook ${hook}`).toContain(hook);
    }

    expect(sourceSurface).toMatch(
      /session\.schema|billing\.schema|support\.schema|settings\.schema/,
    );
    expect(sourceSurface).toMatch(/\.ark\./);

    const zodPageCount = ledgerOpsPages.filter(
      (page) => page.validationOwner.library === "zod",
    ).length;
    const arkPageCount = ledgerOpsPages.filter(
      (page) => page.validationOwner.library === "arktype",
    ).length;

    expect(zodPageCount).toBeGreaterThanOrEqual(ledgerOpsZodDomains.length);
    expect(arkPageCount).toBeGreaterThanOrEqual(ledgerOpsArktypeDomains.length);
  }, 120_000);
});
