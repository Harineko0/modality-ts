#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const sharedPropsRoot = join(repoRoot, "benchmarks/shared/app-spec/props");

type RouteKey =
  | "login"
  | "dashboard"
  | "management"
  | "management-risk"
  | "management-revenue"
  | "management-operations"
  | "accounts"
  | "account-detail"
  | "subscription"
  | "billing"
  | "payment-methods"
  | "invoice"
  | "support"
  | "approvals"
  | "audit"
  | "settings"
  | "settings-rbac";

const reactRouterPaths: Record<RouteKey, string> = {
  login: "benchmarks/react-router/src/routes/login/index.props.ts",
  dashboard: "benchmarks/react-router/src/routes/dashboard/index.props.ts",
  management: "benchmarks/react-router/src/routes/management/index.props.ts",
  "management-risk":
    "benchmarks/react-router/src/routes/management/risk/index.props.ts",
  "management-revenue":
    "benchmarks/react-router/src/routes/management/revenue/index.props.ts",
  "management-operations":
    "benchmarks/react-router/src/routes/management/operations/index.props.ts",
  accounts: "benchmarks/react-router/src/routes/accounts/index.props.ts",
  "account-detail":
    "benchmarks/react-router/src/routes/accounts/$accountId/index.props.ts",
  subscription:
    "benchmarks/react-router/src/routes/accounts/$accountId/subscription/index.props.ts",
  billing:
    "benchmarks/react-router/src/routes/accounts/$accountId/billing/index.props.ts",
  "payment-methods":
    "benchmarks/react-router/src/routes/accounts/$accountId/payment-methods/index.props.ts",
  invoice:
    "benchmarks/react-router/src/routes/accounts/$accountId/invoices/$invoiceId/index.props.ts",
  support:
    "benchmarks/react-router/src/routes/accounts/$accountId/support/index.props.ts",
  approvals: "benchmarks/react-router/src/routes/approvals/index.props.ts",
  audit: "benchmarks/react-router/src/routes/audit/index.props.ts",
  settings: "benchmarks/react-router/src/routes/settings/index.props.ts",
  "settings-rbac":
    "benchmarks/react-router/src/routes/settings/rbac/index.props.ts",
};

const nextPaths: Record<RouteKey, string> = {
  login: "benchmarks/nextjs/src/app/login/page.props.ts",
  dashboard: "benchmarks/nextjs/src/app/dashboard/page.props.ts",
  management: "benchmarks/nextjs/src/app/management/page.props.ts",
  "management-risk": "benchmarks/nextjs/src/app/management/risk/page.props.ts",
  "management-revenue":
    "benchmarks/nextjs/src/app/management/revenue/page.props.ts",
  "management-operations":
    "benchmarks/nextjs/src/app/management/operations/page.props.ts",
  accounts: "benchmarks/nextjs/src/app/accounts/page.props.ts",
  "account-detail":
    "benchmarks/nextjs/src/app/accounts/[accountId]/page.props.ts",
  subscription:
    "benchmarks/nextjs/src/app/accounts/[accountId]/subscription/page.props.ts",
  billing:
    "benchmarks/nextjs/src/app/accounts/[accountId]/billing/page.props.ts",
  "payment-methods":
    "benchmarks/nextjs/src/app/accounts/[accountId]/payment-methods/page.props.ts",
  invoice:
    "benchmarks/nextjs/src/app/accounts/[accountId]/invoices/[invoiceId]/page.props.ts",
  support:
    "benchmarks/nextjs/src/app/accounts/[accountId]/support/page.props.ts",
  approvals: "benchmarks/nextjs/src/app/approvals/page.props.ts",
  audit: "benchmarks/nextjs/src/app/audit/page.props.ts",
  settings: "benchmarks/nextjs/src/app/settings/page.props.ts",
  "settings-rbac": "benchmarks/nextjs/src/app/settings/rbac/page.props.ts",
};

async function inlineProps(paths: Record<RouteKey, string>): Promise<void> {
  for (const [route, relativePath] of Object.entries(paths) as [
    RouteKey,
    string,
  ][]) {
    const sharedPath = join(sharedPropsRoot, `${route}.ts`);
    const body = await readFile(sharedPath, "utf8");
    const fullPath = join(repoRoot, relativePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, body, "utf8");
  }
}

await inlineProps(reactRouterPaths);
await inlineProps(nextPaths);
console.log("inlined ledgerops props into both frameworks");
