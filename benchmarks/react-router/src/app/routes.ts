import { route } from "@react-router/dev/routes";

export default [
  route("login", "../routes/login/index.tsx"),
  route("dashboard", "../routes/dashboard/index.tsx"),
  route("management", "../routes/management/index.tsx"),
  route("management/risk", "../routes/management/risk/index.tsx"),
  route("management/revenue", "../routes/management/revenue/index.tsx"),
  route("management/operations", "../routes/management/operations/index.tsx"),
  route("accounts", "../routes/accounts/index.tsx"),
  route("accounts/$accountId", "../routes/accounts/$accountId/index.tsx"),
  route(
    "accounts/$accountId/subscription",
    "../routes/accounts/$accountId/subscription/index.tsx",
  ),
  route(
    "accounts/$accountId/billing",
    "../routes/accounts/$accountId/billing/index.tsx",
  ),
  route(
    "accounts/$accountId/payment-methods",
    "../routes/accounts/$accountId/payment-methods/index.tsx",
  ),
  route(
    "accounts/$accountId/invoices/$invoiceId",
    "../routes/accounts/$accountId/invoices/$invoiceId/index.tsx",
  ),
  route(
    "accounts/$accountId/support",
    "../routes/accounts/$accountId/support/index.tsx",
  ),
  route("approvals", "../routes/approvals/index.tsx"),
  route("audit", "../routes/audit/index.tsx"),
  route("settings", "../routes/settings/index.tsx"),
  route("settings/rbac", "../routes/settings/rbac/index.tsx"),
] satisfies readonly unknown[];
