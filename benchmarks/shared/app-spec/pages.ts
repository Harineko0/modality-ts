import type { LedgerOpsRoute } from "./routes.js";

export type StateLibrary = "jotai" | "zustand";

export type ValidationLibrary = "zod" | "arktype";

export type LedgerOpsPageSpec = {
  route: LedgerOpsRoute;
  uiControls: readonly string[];
  stateOwner: {
    library: StateLibrary;
    file: string;
    stateNames: readonly string[];
  };
  swrResource: string | null;
  validationOwner: {
    library: ValidationLibrary;
    file: string;
  };
};

export const ledgerOpsPages = [
  {
    route: "/login",
    uiControls: [
      "role segmented control",
      "email field",
      "password field",
      "login button",
      "login error banner",
      "return-path notice",
    ],
    stateOwner: {
      library: "jotai",
      file: "features/auth/state/session-atoms.ts",
      stateNames: [
        "sessionAtom",
        "returnToAtom",
        "permissionCacheAtom",
        "loginStatusAtom",
      ],
    },
    swrResource: null,
    validationOwner: {
      library: "zod",
      file: "features/auth/domain/session.schema.ts",
    },
  },
  {
    route: "/dashboard",
    uiControls: [
      "status summary cards",
      "selected account switcher",
      "start checkout button",
      "support badge",
      "audit shortcut",
    ],
    stateOwner: {
      library: "jotai",
      file: "features/accounts/state/selection-atoms.ts",
      stateNames: ["selectedAccountAtom", "selectedInvoiceAtom"],
    },
    swrResource: "useDashboardSummary",
    validationOwner: {
      library: "arktype",
      file: "features/accounts/domain/account.ark.ts",
    },
  },
  {
    route: "/management",
    uiControls: [
      "management tab list",
      "revenue/risk/operations cards",
      "refresh summary button",
      "drill-down links",
    ],
    stateOwner: {
      library: "jotai",
      file: "features/management/state/management-atoms.ts",
      stateNames: ["managementTabAtom"],
    },
    swrResource: "useManagementSummary",
    validationOwner: {
      library: "arktype",
      file: "features/management/domain/dashboard.ark.ts",
    },
  },
  {
    route: "/management/risk",
    uiControls: [
      "risk filter",
      "high-risk account bucket",
      "select bucket button",
      "bulk suspend button",
      "warning banner",
    ],
    stateOwner: {
      library: "zustand",
      file: "features/management/state/management-store.ts",
      stateNames: ["riskFilter", "selectedRiskBucket", "bulkStatus"],
    },
    swrResource: "useRiskQueue",
    validationOwner: {
      library: "arktype",
      file: "features/management/domain/dashboard.ark.ts",
    },
  },
  {
    route: "/management/revenue",
    uiControls: [
      "revenue health cards",
      "failed payment queue",
      "retry all draft button",
      "export CSV button",
    ],
    stateOwner: {
      library: "zustand",
      file: "features/management/state/management-store.ts",
      stateNames: ["revenueHealth", "failedPaymentQueue", "exportStatus"],
    },
    swrResource: "useRevenueQueue",
    validationOwner: {
      library: "arktype",
      file: "features/management/domain/dashboard.ark.ts",
    },
  },
  {
    route: "/management/operations",
    uiControls: [
      "approval queue",
      "support breach queue",
      "assign reviewer button",
      "bulk request approvals button",
    ],
    stateOwner: {
      library: "zustand",
      file: "features/management/state/management-store.ts",
      stateNames: ["opsQueue", "assignmentStatus"],
    },
    swrResource: "useOperationsQueue",
    validationOwner: {
      library: "arktype",
      file: "features/management/domain/dashboard.ark.ts",
    },
  },
  {
    route: "/accounts",
    uiControls: [
      "account status filter",
      "account list bucket",
      "open account button",
      "suspended account warning",
    ],
    stateOwner: {
      library: "jotai",
      file: "features/accounts/state/selection-atoms.ts",
      stateNames: ["selectedAccountAtom", "accountStatusFilterAtom"],
    },
    swrResource: "useAccounts",
    validationOwner: {
      library: "arktype",
      file: "features/accounts/domain/account.ark.ts",
    },
  },
  {
    route: "/accounts/:accountId",
    uiControls: [
      "account profile panel",
      "plan badge",
      "status badge",
      "tabs to subscription/billing/payment/support",
    ],
    stateOwner: {
      library: "jotai",
      file: "features/accounts/state/selection-atoms.ts",
      stateNames: ["selectedAccountAtom", "accountDetailTabAtom"],
    },
    swrResource: "useAccountDetail",
    validationOwner: {
      library: "arktype",
      file: "features/accounts/domain/account.ark.ts",
    },
  },
  {
    route: "/accounts/:accountId/subscription",
    uiControls: [
      "plan selector",
      "seat stepper",
      "request approval button",
      "apply approval button",
      "approval banner",
    ],
    stateOwner: {
      library: "zustand",
      file: "features/subscription/state/subscription-store.ts",
      stateNames: ["planDraft", "seatDraft", "approvalStatus"],
    },
    swrResource: "useSubscription",
    validationOwner: {
      library: "arktype",
      file: "features/subscription/domain/subscription.ark.ts",
    },
  },
  {
    route: "/accounts/:accountId/billing",
    uiControls: [
      "invoice bucket",
      "amount bucket",
      "create payment intent button",
      "capture payment button",
      "retry invoice button",
    ],
    stateOwner: {
      library: "zustand",
      file: "features/billing/state/billing-store.ts",
      stateNames: ["paymentIntentStatus", "retryCount", "riskScore"],
    },
    swrResource: "useBillingAccount",
    validationOwner: {
      library: "zod",
      file: "features/billing/domain/billing.schema.ts",
    },
  },
  {
    route: "/accounts/:accountId/payment-methods",
    uiControls: [
      "payment method status",
      "add method button",
      "mark expired button",
      "set primary button",
      "requires action banner",
    ],
    stateOwner: {
      library: "zustand",
      file: "features/billing/state/payment-method-store.ts",
      stateNames: ["methodStatus", "saveStatus"],
    },
    swrResource: "usePaymentMethods",
    validationOwner: {
      library: "zod",
      file: "features/billing/domain/billing.schema.ts",
    },
  },
  {
    route: "/accounts/:accountId/invoices/:invoiceId",
    uiControls: [
      "invoice detail",
      "void button",
      "dispute button",
      "pay button",
      "retry count output",
    ],
    stateOwner: {
      library: "zustand",
      file: "features/billing/state/invoice-store.ts",
      stateNames: ["invoiceStatus", "retryCount"],
    },
    swrResource: "useInvoiceDetail",
    validationOwner: {
      library: "zod",
      file: "features/billing/domain/billing.schema.ts",
    },
  },
  {
    route: "/accounts/:accountId/support",
    uiControls: [
      "priority selector",
      "escalation text bucket",
      "open escalation button",
      "assign owner button",
    ],
    stateOwner: {
      library: "zustand",
      file: "features/support/state/support-store.ts",
      stateNames: ["priority", "escalationStatus"],
    },
    swrResource: "useSupportCase",
    validationOwner: {
      library: "zod",
      file: "features/support/domain/support.schema.ts",
    },
  },
  {
    route: "/approvals",
    uiControls: [
      "approval queue filter",
      "approval detail card",
      "approve button",
      "reject button",
      "apply approved change button",
    ],
    stateOwner: {
      library: "zustand",
      file: "features/subscription/state/approval-store.ts",
      stateNames: ["queueFilter", "decisionStatus"],
    },
    swrResource: "useApprovals",
    validationOwner: {
      library: "arktype",
      file: "features/subscription/domain/subscription.ark.ts",
    },
  },
  {
    route: "/audit",
    uiControls: [
      "action filter",
      "actor role filter",
      "export button",
      "export status",
      "results bucket",
    ],
    stateOwner: {
      library: "jotai",
      file: "features/audit/state/audit-atoms.ts",
      stateNames: [
        "auditActionFilterAtom",
        "auditActorRoleFilterAtom",
        "auditExportStatusAtom",
      ],
    },
    swrResource: "useAuditEvents",
    validationOwner: {
      library: "arktype",
      file: "features/audit/domain/audit.ark.ts",
    },
  },
  {
    route: "/settings",
    uiControls: [
      "tenant name field",
      "billing policy toggle",
      "save settings button",
      "settings save status",
    ],
    stateOwner: {
      library: "zustand",
      file: "features/settings/state/settings-store.ts",
      stateNames: ["settingsDraft", "saveStatus"],
    },
    swrResource: "useSettings",
    validationOwner: {
      library: "zod",
      file: "features/settings/domain/settings.schema.ts",
    },
  },
  {
    route: "/settings/rbac",
    uiControls: [
      "user selector",
      "target role selector",
      "permission preview",
      "save role assignment button",
      "stale cache warning",
    ],
    stateOwner: {
      library: "jotai",
      file: "features/auth/state/session-atoms.ts",
      stateNames: [
        "permissionCacheAtom",
        "targetRoleAtom",
        "roleSaveStatusAtom",
      ],
    },
    swrResource: "useRoleAssignments",
    validationOwner: {
      library: "arktype",
      file: "features/auth/domain/session.ark.ts",
    },
  },
] as const satisfies readonly LedgerOpsPageSpec[];

export type LedgerOpsPageRoute = (typeof ledgerOpsPages)[number]["route"];

export function pageSpecForRoute(
  route: LedgerOpsRoute,
): LedgerOpsPageSpec | undefined {
  return ledgerOpsPages.find((page) => page.route === route);
}
