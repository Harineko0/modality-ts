export const ledgerOpsRoutes = [
  "/login",
  "/dashboard",
  "/management",
  "/management/risk",
  "/management/revenue",
  "/management/operations",
  "/accounts",
  "/accounts/:accountId",
  "/accounts/:accountId/subscription",
  "/accounts/:accountId/billing",
  "/accounts/:accountId/payment-methods",
  "/accounts/:accountId/invoices/:invoiceId",
  "/accounts/:accountId/support",
  "/approvals",
  "/audit",
  "/settings",
  "/settings/rbac",
] as const;

export type LedgerOpsRoute = (typeof ledgerOpsRoutes)[number];
