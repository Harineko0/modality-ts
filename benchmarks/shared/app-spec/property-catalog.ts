export const ledgerOpsEffectApis = [
  "api.login",
  "api.refreshSession",
  "api.loadDashboardSummary",
  "api.loadAccount",
  "api.loadManagementSummary",
  "api.bulkSuspendAccounts",
  "api.requestApproval",
  "api.applyApproval",
  "api.createPaymentIntent",
  "api.capturePayment",
  "api.retryInvoice",
  "api.savePaymentMethod",
  "api.openSupportEscalation",
  "api.exportAudit",
  "api.saveSettings",
  "api.saveRoleAssignment",
] as const;

export type LedgerOpsEffectApi = (typeof ledgerOpsEffectApis)[number];

export const ledgerOpsProperties = [
  "auth.managerCannotLandOnAdminReturnTo",
  "auth.failedLoginKeepsGuest",
  "rbac.permissionCacheMatchesCurrentRole",
  "billing.captureUsesEnqueuedInvoice",
  "subscription.approvalAppliesRequestedSeats",
  "support.escalationUsesEnqueuedAccount",
  "invoice.retryBudgetNeverExceedsTwo",
  "management.bulkSuspendUsesEnqueuedRiskBucket",
  "billing.paidInvoiceVoidDisabled",
  "audit.exportRequiresAdminPermission",
  "dashboard.suspendedAccountCheckoutDisabled",
  "approvals.rejectedApprovalCannotApply",
  "rbac.analystCannotSaveRoleAssignment",
  "management.bulkSuspendRequiresAdmin",
  "audit.filteredExportNeverIncludesSupportEvents",
  "billing.requiresActionEventuallySettles",
  "management.criticalRevenueRequiresFailedPayments",
] as const;

export type LedgerOpsProperty = (typeof ledgerOpsProperties)[number];

export const ledgerOpsJotaiStateNames = [
  "sessionAtom",
  "permissionCacheAtom",
  "returnToAtom",
  "selectedAccountAtom",
  "selectedInvoiceAtom",
  "managementTabAtom",
  "managementFilterAtom",
  "auditActionFilterAtom",
  "targetRoleAtom",
] as const;

export const ledgerOpsJotaiPrimaryRoutes = [
  "/login",
  "/dashboard",
  "/management",
  "/accounts",
  "/accounts/:accountId",
  "/audit",
  "/settings/rbac",
] as const;

export const ledgerOpsZustandPrimaryRoutes = [
  "/management/risk",
  "/management/revenue",
  "/management/operations",
  "/accounts/:accountId/subscription",
  "/accounts/:accountId/billing",
  "/accounts/:accountId/payment-methods",
  "/accounts/:accountId/invoices/:invoiceId",
  "/accounts/:accountId/support",
  "/approvals",
  "/settings",
] as const;

export const ledgerOpsZodDomains = [
  "auth",
  "billing",
  "payment-methods",
  "invoices",
  "support",
  "settings",
] as const;

export const ledgerOpsArktypeDomains = [
  "rbac",
  "accounts",
  "subscription",
  "approvals",
  "management",
  "audit",
] as const;

export const ledgerOpsSwrHooks = [
  "useDashboardSummary",
  "useManagementSummary",
  "useRiskQueue",
  "useRevenueQueue",
  "useOperationsQueue",
  "useAccounts",
  "useAccountDetail",
  "useSubscription",
  "useBillingAccount",
  "usePaymentMethods",
  "useInvoiceDetail",
  "useSupportCase",
  "useApprovals",
  "useAuditEvents",
  "useSettings",
  "useRoleAssignments",
] as const;
