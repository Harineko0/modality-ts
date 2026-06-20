# LedgerOps Shared Domain and Page Spec

## 1. Goal

Add the shared DDD benchmark specification used by both framework apps. This plan pins down exact directories, domain types, fake infra contracts, third-party library responsibilities, page UI, page state locations, effect APIs, and seeded expected outcomes.

## 2. Non-goals

- Do not place React Router or Next.js code in `benchmarks/shared/`.
- Do not place extractable React hook state only in shared pure helpers.
- Do not use live auth/payment/network services.
- Do not use open-ended data shapes where finite domains are enough.

## 3. Current-State Findings

- The repo has no existing `benchmarks/` directory.
- Existing examples are small and app-specific; the benchmark needs shared specification files because two frameworks must remain behaviorally identical.
- The extractor benefits from literal unions, static package dependencies, stable effect API names, and handlers that keep state writes close to React components.

## 4. Existing Patterns to Follow

- Use NodeNext ESM imports.
- Use strict TypeScript, two-space indentation, double quotes, and semicolons.
- Keep source files small and colocated by domain.
- Use public package imports (`modality-ts/properties`, `modality-ts/vars`) in props files.

## 5. Atomic Implementation Steps

1. Add this shared directory structure:

```text
benchmarks/shared/
  README.md
  app-spec/
    routes.ts
    pages.ts
    seeded-outcomes.ts
    property-catalog.ts
  domain/
    auth/
      rbac.ts
      session.ts
      session.schema.ts
      session.ark.ts
    accounts/
      account.ts
      account.schema.ts
      account.ark.ts
    billing/
      invoice.ts
      payment.ts
      billing.schema.ts
      billing.ark.ts
    subscription/
      plan.ts
      approval.ts
      subscription.schema.ts
      subscription.ark.ts
    management/
      dashboard.ts
      dashboard.schema.ts
      dashboard.ark.ts
    support/
      escalation.ts
      support.schema.ts
      support.ark.ts
    audit/
      audit.ts
      audit.schema.ts
      audit.ark.ts
    settings/
      settings.ts
      settings.schema.ts
      settings.ark.ts
  application/
    auth-service.ts
    account-service.ts
    billing-service.ts
    subscription-service.ts
    management-service.ts
    support-service.ts
    audit-service.ts
    settings-service.ts
  infrastructure/
    fake/
      fake-auth-provider.ts
      fake-account-repository.ts
      fake-payment-gateway.ts
      fake-management-api.ts
      fake-support-api.ts
      fake-audit-api.ts
      fake-settings-api.ts
      fixtures.ts
  testing/
    parity.ts
    route-fixtures.ts
```

2. Add package dependencies to each benchmark app, not to root unless necessary:

```json
{
  "dependencies": {
    "@ark/schema": "latest if required by arktype",
    "arktype": "^2.1.0",
    "jotai": "^2.0.0",
    "swr": "^2.0.0",
    "zustand": "^5.0.0",
    "zod": "^4.0.0"
  }
}
```

Use exact versions already present in `pnpm-lock.yaml` if the lockfile contains them. Stop and report if adding ArkType/Zod/Zustand requires a root lockfile migration that conflicts with repo policy.

3. Use this domain vocabulary exactly:

```ts
export type Role = "guest" | "analyst" | "manager" | "admin";
export type Permission =
  | "view_dashboard"
  | "view_accounts"
  | "manage_subscription"
  | "manage_billing"
  | "manage_payment_methods"
  | "approve_changes"
  | "view_audit"
  | "export_audit"
  | "manage_settings"
  | "manage_rbac"
  | "use_management_dashboard"
  | "bulk_suspend_accounts";
export type AccountStatus = "trial" | "active" | "past_due" | "suspended";
export type Plan = "starter" | "growth" | "enterprise";
export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "disputed";
export type PaymentMethodStatus = "missing" | "valid" | "expired" | "requires_action";
export type ApprovalStatus = "none" | "requested" | "approved" | "rejected";
export type QueueBucket = "empty" | "some" | "many";
export type RiskBucket = "low" | "medium" | "high";
export type RevenueHealth = "healthy" | "watch" | "critical";
export type AsyncStatus = "idle" | "loading" | "submitting" | "success" | "error";
```

4. Use this RBAC matrix in `benchmarks/shared/domain/auth/rbac.ts`:

```ts
export const permissionsByRole = {
  guest: [],
  analyst: ["view_dashboard", "view_accounts", "view_audit"],
  manager: [
    "view_dashboard",
    "view_accounts",
    "manage_subscription",
    "approve_changes",
    "view_audit",
    "use_management_dashboard"
  ],
  admin: [
    "view_dashboard",
    "view_accounts",
    "manage_subscription",
    "manage_billing",
    "manage_payment_methods",
    "approve_changes",
    "view_audit",
    "export_audit",
    "manage_settings",
    "manage_rbac",
    "use_management_dashboard",
    "bulk_suspend_accounts"
  ]
} as const;
```

5. Use this page inventory exactly in `benchmarks/shared/app-spec/routes.ts`:

```ts
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
  "/settings/rbac"
] as const;
```

6. Use this page-by-page UI and state matrix. The React Router and Next.js plans map these logical files to framework-specific route files.

| Route | UI controls and outputs | Jotai state | Zustand state | SWR resource | Validation |
| --- | --- | --- | --- | --- | --- |
| `/login` | role segmented control, email field, password field, login button, login error banner, return-path notice | `presentation/state/session-atoms.ts` (`sessionAtom`, `returnToAtom`, `permissionCacheAtom`) | `presentation/state/auth-workflow-store.ts` (`loginStatus`, `loginAttemptRole`) | none | Zod `LoginFormSchema`, ArkType `RoleType` |
| `/dashboard` | status summary cards, selected account switcher, start checkout button, support badge, audit shortcut | `selectedAccountAtom`, `sessionAtom` | `dashboard-store.ts` (`checkoutIntent`, `supportBadge`) | `useDashboardSummary` from `infrastructure/swr/dashboard-queries.ts` | Zod dashboard filter schema, ArkType queue buckets |
| `/management` | management tab list, revenue/risk/operations cards, refresh summary button, drill-down links | `managementTabAtom`, `permissionCacheAtom` | `management-store.ts` (`summaryStatus`, `bulkDraft`) | `useManagementSummary` | Zod management filter schema, ArkType `RevenueHealthType` |
| `/management/risk` | risk filter, high-risk account bucket, select bucket button, bulk suspend button, warning banner | `managementFilterAtom` | `management-store.ts` (`riskFilter`, `selectedRiskBucket`, `bulkStatus`) | `useRiskQueue` | Zod bulk action schema, ArkType risk bucket |
| `/management/revenue` | revenue health cards, failed payment queue, retry all draft button, export CSV button | `managementTabAtom` | `management-store.ts` (`revenueHealth`, `exportStatus`) | `useRevenueQueue` | Zod export schema |
| `/management/operations` | approval queue, support breach queue, assign reviewer button, bulk request approvals button | `managementTabAtom` | `management-store.ts` (`opsQueue`, `assignmentStatus`) | `useOperationsQueue` | Zod operations action schema |
| `/accounts` | account status filter, account list bucket, open account button, suspended account warning | `selectedAccountAtom` | `accounts-store.ts` (`statusFilter`, `listStatus`) | `useAccounts` | Zod account filter schema |
| `/accounts/:accountId` | account profile panel, plan badge, status badge, tabs to subscription/billing/payment/support | `selectedAccountAtom` | `accounts-store.ts` (`detailStatus`, `selectedTab`) | `useAccountDetail` | ArkType account id and account status |
| `/accounts/:accountId/subscription` | plan selector, seat stepper, request approval button, apply approval button, approval banner | `selectedAccountAtom`, `sessionAtom` | `subscription-store.ts` (`planDraft`, `seatDraft`, `approvalStatus`) | `useSubscription` | Zod subscription change schema, ArkType bounded seats |
| `/accounts/:accountId/billing` | invoice bucket, amount bucket, create payment intent button, capture payment button, retry invoice button | `selectedInvoiceAtom` | `billing-store.ts` (`paymentIntentStatus`, `retryCount`, `riskScore`) | `useBillingAccount` | Zod payment intent schema, ArkType invoice amount/risk/retry |
| `/accounts/:accountId/payment-methods` | payment method status, add method button, mark expired button, set primary button, requires action banner | `selectedAccountAtom` | `payment-method-store.ts` (`methodStatus`, `saveStatus`) | `usePaymentMethods` | Zod payment method schema |
| `/accounts/:accountId/invoices/:invoiceId` | invoice detail, void button, dispute button, pay button, retry count output | `selectedInvoiceAtom` | `invoice-store.ts` (`invoiceStatus`, `retryCount`) | `useInvoiceDetail` | Zod invoice action schema |
| `/accounts/:accountId/support` | priority selector, escalation text bucket, open escalation button, assign owner button | `selectedAccountAtom` | `support-store.ts` (`priority`, `escalationStatus`) | `useSupportCase` | Zod support escalation schema |
| `/approvals` | approval queue filter, approval detail card, approve button, reject button, apply approved change button | `sessionAtom` | `approval-store.ts` (`queueFilter`, `decisionStatus`) | `useApprovals` | Zod approval decision schema |
| `/audit` | action filter, actor role filter, export button, export status, results bucket | `sessionAtom` | `audit-store.ts` (`auditFilter`, `exportStatus`) | `useAuditEvents` | Zod audit filter/export schema |
| `/settings` | tenant name field, billing policy toggle, save settings button, settings save status | `sessionAtom` | `settings-store.ts` (`settingsDraft`, `saveStatus`) | `useSettings` | Zod settings schema |
| `/settings/rbac` | user selector, target role selector, permission preview, save role assignment button, stale cache warning | `sessionAtom`, `permissionCacheAtom` | `rbac-store.ts` (`targetUser`, `targetRole`, `saveRoleStatus`) | `useRoleAssignments` | Zod role assignment schema, ArkType role/permission |

7. Use these fake infra effect API names exactly:

```ts
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
  "api.saveRoleAssignment"
] as const;
```

8. Use this DDD library responsibility map in both apps:

- Jotai:
  - `sessionAtom`
  - `permissionCacheAtom`
  - `returnToAtom`
  - `selectedAccountAtom`
  - `selectedInvoiceAtom`
  - `managementTabAtom`
  - `managementFilterAtom`
- Zustand:
  - one store per workflow listed in the page matrix
  - state names must stay stable because props use `s(component, idOverride)` or generated handles
- SWR:
  - one read hook per page list/detail resource listed in the page matrix
  - deterministic fake fetchers from `infrastructure/fake/*`
  - bounded data buckets only: `empty`, `some`, `many`, or fixed enum records
- Zod:
  - one schema per user form/effect API payload
  - component submit handlers call schema parse/safeParse before enqueueing fake API effects
- ArkType:
  - finite domain constraints for roles, permissions, status buckets, bounded seats, retry count, risk score, and amount bucket
  - app fixtures use ArkType validation before they reach fake repositories

9. Use this seeded expected-outcome ledger in `benchmarks/shared/app-spec/seeded-outcomes.ts`:

| Id | Property | Class | Expected checker result | Repro expectation | Frameworks |
| --- | --- | --- | --- | --- | --- |
| `auth.redirectReturnPathRoleConfusion` | `auth.managerCannotLandOnAdminReturnTo` | TP | violated | reproduced | both |
| `rbac.permissionCacheStaleAfterRoleSwitch` | `rbac.permissionCacheMatchesCurrentRole` | TP | violated | reproduced | both |
| `billing.stalePaymentIntentCapture` | `billing.captureUsesEnqueuedInvoice` | TP | violated | reproduced | both |
| `subscription.approvalStaleSeats` | `subscription.approvalAppliesRequestedSeats` | TP | violated | reproduced | both |
| `support.impersonationLeak` | `support.escalationUsesEnqueuedAccount` | TP | violated | reproduced | both |
| `invoice.retryBudgetOffByOne` | `invoice.retryBudgetNeverExceedsTwo` | TP | violated | reproduced | both |
| `management.bulkSuspendUsesFilteredSelection` | `management.bulkSuspendUsesEnqueuedRiskBucket` | TP | violated | reproduced | both |
| `auth.loginFailureDoesNotEscalateRole` | `auth.failedLoginKeepsGuest` | TN | verified or verified-within-bounds | none | both |
| `billing.paidInvoiceCannotBeVoided` | `billing.paidInvoiceVoidDisabled` | TN | verified or verified-within-bounds | none | both |
| `settings.auditExportRequiresAdmin` | `audit.exportRequiresAdminPermission` | TN | verified or verified-within-bounds | none | both |
| `dashboard.suspendedAccountCannotStartCheckout` | `dashboard.suspendedAccountCheckoutDisabled` | TN | verified or verified-within-bounds | none | both |
| `approvals.rejectedApprovalCannotApplyPlan` | `approvals.rejectedApprovalCannotApply` | TN | verified or verified-within-bounds | none | both |
| `rbac.analystCannotManageRoles` | `rbac.analystCannotSaveRoleAssignment` | TN | verified or verified-within-bounds | none | both |
| `management.managerCannotBulkSuspendAccounts` | `management.bulkSuspendRequiresAdmin` | TN | verified or verified-within-bounds | none | both |
| `audit.dynamicFilterOverApprox` | `audit.filteredExportNeverIncludesSupportEvents` | FP probe | violated or non-reproduced accepted | non-reproduced accepted | both |
| `payment.requiresActionLoopOverApprox` | `billing.requiresActionEventuallySettles` | FP probe | violated or non-reproduced accepted | non-reproduced accepted | both |
| `management.aggregateBucketOverApprox` | `management.criticalRevenueRequiresFailedPayments` | FP probe | violated or non-reproduced accepted | non-reproduced accepted | both |
| `billing.currencyRoundingDrift` | no property; metadata-only FN probe | FN probe | not checked | none | both |
| `auth.crossTabSessionStorageRace` | no property; metadata-only FN probe | FN probe | not checked | none | both |
| `rbac.remotePolicyDocumentDrift` | no property; metadata-only FN probe | FN probe | not checked | both |

10. Add `benchmarks/shared/README.md` with the route matrix, library map, seeded ledger, and the rule that apps may duplicate presentation handlers but not change domain outcomes.

## 6. Tests to Add or Update

- `test/benchmarks/shared-spec.test.ts`
  - checks every route has a page matrix entry
  - checks every effect API appears in both app manifests after plan 07/08 land
  - checks every seeded outcome references a property or is marked metadata-only FN
  - checks RBAC matrix grants `admin` all permissions and `guest` no authenticated permissions

## 7. Verification

- `rtk pnpm test -- test/benchmarks/shared-spec.test.ts`
- `rtk pnpm typecheck`
- `rtk pnpm fix`

## 8. Acceptance Criteria

- `benchmarks/shared/` contains the exact directory structure above.
- Page matrix, route list, effect API list, RBAC matrix, and seeded ledger are exported as typed constants.
- Both app plans can import shared pure domain/spec files without importing framework code.
- Every required library has an explicit responsibility and file location.

## 9. Risks, Ambiguities, and Stop Conditions

- Stop and report if ArkType package exports differ from the assumed import shape; use the current package docs or installed package types before implementation.
- Stop and report if TypeScript cannot infer finite literal domains from shared schemas; keep explicit literal unions beside schemas.
- Stop and report if a shared service helper makes framework event handlers unextractable; move handler logic back into each app.
