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
const benchmarkRoot = join(repoRoot, "benchmarks", "react-router");
const packageJsonPath = join(benchmarkRoot, "package.json");

const sourcePaths = [
  "src/App.tsx",
  "src/app/router.tsx",
  "src/routes/login/index.tsx",
  "src/routes/dashboard/index.tsx",
  "src/routes/management/index.tsx",
  "src/routes/management/risk/index.tsx",
  "src/routes/management/revenue/index.tsx",
  "src/routes/management/operations/index.tsx",
  "src/routes/accounts/index.tsx",
  "src/routes/accounts/$accountId/index.tsx",
  "src/routes/accounts/$accountId/subscription/index.tsx",
  "src/routes/accounts/$accountId/billing/index.tsx",
  "src/routes/accounts/$accountId/payment-methods/index.tsx",
  "src/routes/accounts/$accountId/invoices/$invoiceId/index.tsx",
  "src/routes/accounts/$accountId/support/index.tsx",
  "src/routes/approvals/index.tsx",
  "src/routes/audit/index.tsx",
  "src/routes/settings/index.tsx",
  "src/routes/settings/rbac/index.tsx",
].map((path) => join(benchmarkRoot, path));

const propsPaths = ledgerOpsRoutes.map((route) => {
  const page = ledgerOpsPages.find((entry) => entry.route === route);
  expect(page).toBeDefined();
  const segments = route
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      segment.startsWith(":") ? `$${segment.slice(1)}` : segment,
    );
  return join(benchmarkRoot, "src", "routes", ...segments, "index.props.ts");
});

function readPackageJson() {
  return JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    dependencies: Record<string, string>;
  };
}

describe("ledgerops react-router benchmark", () => {
  it("declares all five supported libraries in package dependencies", () => {
    const pkg = readPackageJson();
    for (const dep of ["jotai", "zustand", "swr", "zod", "arktype"]) {
      expect(pkg.dependencies[dep], `missing dependency ${dep}`).toBeDefined();
    }
  });

  it("extracts all routes with Jotai, Zustand, SWR, Zod, and ArkType coverage", async () => {
    const reportPath = join(
      repoRoot,
      ".modality",
      "ledgerops-react-router.extract.json",
    );
    const modelPath = join(
      repoRoot,
      ".modality",
      "ledgerops-react-router.model.json",
    );

    const result = await runExtractCommand({
      sourcePaths,
      modelPath,
      reportPath,
      packageJsonPath,
      configPath: join(benchmarkRoot, "modality.config.ts"),
      propsPath: join(benchmarkRoot, "src/routes/login/index.props.ts"),
      propsPaths,
    });

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
      "src/routes/login/_components/LoginForm.tsx",
      "src/routes/dashboard/_components/DashboardSummary.tsx",
      "src/routes/management/_components/ManagementOverview.tsx",
      "src/routes/management/risk/_components/RiskBulkPanel.tsx",
      "src/routes/management/revenue/_components/RevenueQueuePanel.tsx",
      "src/routes/management/operations/_components/OperationsQueuePanel.tsx",
      "src/routes/accounts/_components/AccountList.tsx",
      "src/routes/accounts/$accountId/_components/AccountProfile.tsx",
      "src/routes/accounts/$accountId/subscription/_components/SubscriptionEditor.tsx",
      "src/routes/accounts/$accountId/billing/_components/BillingWorkbench.tsx",
      "src/routes/accounts/$accountId/payment-methods/_components/PaymentMethodEditor.tsx",
      "src/routes/accounts/$accountId/invoices/$invoiceId/_components/InvoiceActions.tsx",
      "src/routes/accounts/$accountId/support/_components/SupportEscalationForm.tsx",
      "src/routes/approvals/_components/ApprovalQueue.tsx",
      "src/routes/audit/_components/AuditExportPanel.tsx",
      "src/routes/settings/_components/TenantSettingsForm.tsx",
      "src/routes/settings/rbac/_components/RoleAssignmentForm.tsx",
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
