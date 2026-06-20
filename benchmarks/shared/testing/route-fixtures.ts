import { ledgerOpsRoutes, type LedgerOpsRoute } from "../app-spec/routes.js";
import { ledgerOpsPages } from "../app-spec/pages.js";

export type RouteFixture = {
  route: LedgerOpsRoute;
  path: string;
  params: Record<string, string>;
};

export const ledgerOpsRouteFixtures: readonly RouteFixture[] = [
  { route: "/login", path: "/login", params: {} },
  { route: "/dashboard", path: "/dashboard", params: {} },
  { route: "/management", path: "/management", params: {} },
  { route: "/management/risk", path: "/management/risk", params: {} },
  { route: "/management/revenue", path: "/management/revenue", params: {} },
  {
    route: "/management/operations",
    path: "/management/operations",
    params: {},
  },
  { route: "/accounts", path: "/accounts", params: {} },
  {
    route: "/accounts/:accountId",
    path: "/accounts/acct-alpha",
    params: { accountId: "acct-alpha" },
  },
  {
    route: "/accounts/:accountId/subscription",
    path: "/accounts/acct-alpha/subscription",
    params: { accountId: "acct-alpha" },
  },
  {
    route: "/accounts/:accountId/billing",
    path: "/accounts/acct-alpha/billing",
    params: { accountId: "acct-alpha" },
  },
  {
    route: "/accounts/:accountId/payment-methods",
    path: "/accounts/acct-alpha/payment-methods",
    params: { accountId: "acct-alpha" },
  },
  {
    route: "/accounts/:accountId/invoices/:invoiceId",
    path: "/accounts/acct-alpha/invoices/inv-100",
    params: { accountId: "acct-alpha", invoiceId: "inv-100" },
  },
  {
    route: "/accounts/:accountId/support",
    path: "/accounts/acct-alpha/support",
    params: { accountId: "acct-alpha" },
  },
  { route: "/approvals", path: "/approvals", params: {} },
  { route: "/audit", path: "/audit", params: {} },
  { route: "/settings", path: "/settings", params: {} },
  { route: "/settings/rbac", path: "/settings/rbac", params: {} },
] as const;

export function assertRouteParity(): void {
  if (ledgerOpsRouteFixtures.length !== ledgerOpsRoutes.length) {
    throw new Error("route fixtures do not cover every ledger route");
  }
  for (const route of ledgerOpsRoutes) {
    const page = ledgerOpsPages.find((entry) => entry.route === route);
    if (!page) {
      throw new Error(`missing page spec for route ${route}`);
    }
    const fixture = ledgerOpsRouteFixtures.find(
      (entry) => entry.route === route,
    );
    if (!fixture) {
      throw new Error(`missing route fixture for route ${route}`);
    }
  }
}
