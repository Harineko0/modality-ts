import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "./shell/AppShell.js";
import LoginRoute from "../routes/login/index.js";
import DashboardRoute from "../routes/dashboard/index.js";
import ManagementRoute from "../routes/management/index.js";
import ManagementRiskRoute from "../routes/management/risk/index.js";
import ManagementRevenueRoute from "../routes/management/revenue/index.js";
import ManagementOperationsRoute from "../routes/management/operations/index.js";
import AccountsRoute from "../routes/accounts/index.js";
import AccountDetailRoute from "../routes/accounts/$accountId/index.js";
import SubscriptionRoute from "../routes/accounts/$accountId/subscription/index.js";
import BillingRoute from "../routes/accounts/$accountId/billing/index.js";
import PaymentMethodsRoute from "../routes/accounts/$accountId/payment-methods/index.js";
import InvoiceRoute from "../routes/accounts/$accountId/invoices/$invoiceId/index.js";
import SupportRoute from "../routes/accounts/$accountId/support/index.js";
import ApprovalsRoute from "../routes/approvals/index.js";
import AuditRoute from "../routes/audit/index.js";
import SettingsRoute from "../routes/settings/index.js";
import RbacRoute from "../routes/settings/rbac/index.js";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppShell />,
    children: [
      { path: "login", element: <LoginRoute /> },
      { path: "dashboard", element: <DashboardRoute /> },
      { path: "management", element: <ManagementRoute /> },
      { path: "management/risk", element: <ManagementRiskRoute /> },
      { path: "management/revenue", element: <ManagementRevenueRoute /> },
      { path: "management/operations", element: <ManagementOperationsRoute /> },
      { path: "accounts", element: <AccountsRoute /> },
      { path: "accounts/:accountId", element: <AccountDetailRoute /> },
      {
        path: "accounts/:accountId/subscription",
        element: <SubscriptionRoute />,
      },
      { path: "accounts/:accountId/billing", element: <BillingRoute /> },
      {
        path: "accounts/:accountId/payment-methods",
        element: <PaymentMethodsRoute />,
      },
      {
        path: "accounts/:accountId/invoices/:invoiceId",
        element: <InvoiceRoute />,
      },
      { path: "accounts/:accountId/support", element: <SupportRoute /> },
      { path: "approvals", element: <ApprovalsRoute /> },
      { path: "audit", element: <AuditRoute /> },
      { path: "settings", element: <SettingsRoute /> },
      { path: "settings/rbac", element: <RbacRoute /> },
    ],
  },
]);
