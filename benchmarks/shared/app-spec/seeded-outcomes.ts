import type { LedgerOpsProperty } from "./property-catalog.js";

export type SeededOutcomeClass = "TP" | "TN" | "FP probe" | "FN probe";

export type SeededCheckerResult =
  | "violated"
  | "verified"
  | "verified-within-bounds"
  | "not checked"
  | "violated or non-reproduced accepted";

export type SeededReproExpectation =
  | "reproduced"
  | "none"
  | "non-reproduced accepted";

export type SeededFrameworkScope = "both";

export type SeededOutcome = {
  id: string;
  property: LedgerOpsProperty | null;
  class: SeededOutcomeClass;
  expectedCheckerResult: SeededCheckerResult;
  reproExpectation: SeededReproExpectation;
  frameworks: SeededFrameworkScope;
  metadataOnly?: boolean;
};

export const ledgerOpsSeededOutcomes = [
  {
    id: "auth.redirectReturnPathRoleConfusion",
    property: "auth.managerCannotLandOnAdminReturnTo",
    class: "TP",
    expectedCheckerResult: "violated",
    reproExpectation: "reproduced",
    frameworks: "both",
  },
  {
    id: "rbac.permissionCacheStaleAfterRoleSwitch",
    property: "rbac.permissionCacheMatchesCurrentRole",
    class: "TP",
    expectedCheckerResult: "violated",
    reproExpectation: "reproduced",
    frameworks: "both",
  },
  {
    id: "billing.stalePaymentIntentCapture",
    property: "billing.captureUsesEnqueuedInvoice",
    class: "TP",
    expectedCheckerResult: "violated",
    reproExpectation: "reproduced",
    frameworks: "both",
  },
  {
    id: "subscription.approvalStaleSeats",
    property: "subscription.approvalAppliesRequestedSeats",
    class: "TP",
    expectedCheckerResult: "violated",
    reproExpectation: "reproduced",
    frameworks: "both",
  },
  {
    id: "support.impersonationLeak",
    property: "support.escalationUsesEnqueuedAccount",
    class: "TP",
    expectedCheckerResult: "violated",
    reproExpectation: "reproduced",
    frameworks: "both",
  },
  {
    id: "invoice.retryBudgetOffByOne",
    property: "invoice.retryBudgetNeverExceedsTwo",
    class: "TP",
    expectedCheckerResult: "violated",
    reproExpectation: "reproduced",
    frameworks: "both",
  },
  {
    id: "management.bulkSuspendUsesFilteredSelection",
    property: "management.bulkSuspendUsesEnqueuedRiskBucket",
    class: "TP",
    expectedCheckerResult: "violated",
    reproExpectation: "reproduced",
    frameworks: "both",
  },
  {
    id: "auth.loginFailureDoesNotEscalateRole",
    property: "auth.failedLoginKeepsGuest",
    class: "TN",
    expectedCheckerResult: "verified or verified-within-bounds",
    reproExpectation: "none",
    frameworks: "both",
  },
  {
    id: "billing.paidInvoiceCannotBeVoided",
    property: "billing.paidInvoiceVoidDisabled",
    class: "TN",
    expectedCheckerResult: "verified or verified-within-bounds",
    reproExpectation: "none",
    frameworks: "both",
  },
  {
    id: "settings.auditExportRequiresAdmin",
    property: "audit.exportRequiresAdminPermission",
    class: "TN",
    expectedCheckerResult: "verified or verified-within-bounds",
    reproExpectation: "none",
    frameworks: "both",
  },
  {
    id: "dashboard.suspendedAccountCannotStartCheckout",
    property: "dashboard.suspendedAccountCheckoutDisabled",
    class: "TN",
    expectedCheckerResult: "verified or verified-within-bounds",
    reproExpectation: "none",
    frameworks: "both",
  },
  {
    id: "approvals.rejectedApprovalCannotApplyPlan",
    property: "approvals.rejectedApprovalCannotApply",
    class: "TN",
    expectedCheckerResult: "verified or verified-within-bounds",
    reproExpectation: "none",
    frameworks: "both",
  },
  {
    id: "rbac.analystCannotManageRoles",
    property: "rbac.analystCannotSaveRoleAssignment",
    class: "TN",
    expectedCheckerResult: "verified or verified-within-bounds",
    reproExpectation: "none",
    frameworks: "both",
  },
  {
    id: "management.managerCannotBulkSuspendAccounts",
    property: "management.bulkSuspendRequiresAdmin",
    class: "TN",
    expectedCheckerResult: "verified or verified-within-bounds",
    reproExpectation: "none",
    frameworks: "both",
  },
  {
    id: "audit.dynamicFilterOverApprox",
    property: "audit.filteredExportNeverIncludesSupportEvents",
    class: "FP probe",
    expectedCheckerResult: "violated or non-reproduced accepted",
    reproExpectation: "non-reproduced accepted",
    frameworks: "both",
  },
  {
    id: "payment.requiresActionLoopOverApprox",
    property: "billing.requiresActionEventuallySettles",
    class: "FP probe",
    expectedCheckerResult: "violated or non-reproduced accepted",
    reproExpectation: "non-reproduced accepted",
    frameworks: "both",
  },
  {
    id: "management.aggregateBucketOverApprox",
    property: "management.criticalRevenueRequiresFailedPayments",
    class: "FP probe",
    expectedCheckerResult: "violated or non-reproduced accepted",
    reproExpectation: "non-reproduced accepted",
    frameworks: "both",
  },
  {
    id: "billing.currencyRoundingDrift",
    property: null,
    class: "FN probe",
    expectedCheckerResult: "not checked",
    reproExpectation: "none",
    frameworks: "both",
    metadataOnly: true,
  },
  {
    id: "auth.crossTabSessionStorageRace",
    property: null,
    class: "FN probe",
    expectedCheckerResult: "not checked",
    reproExpectation: "none",
    frameworks: "both",
    metadataOnly: true,
  },
  {
    id: "rbac.remotePolicyDocumentDrift",
    property: null,
    class: "FN probe",
    expectedCheckerResult: "not checked",
    reproExpectation: "none",
    frameworks: "both",
    metadataOnly: true,
  },
] as const satisfies readonly SeededOutcome[];
