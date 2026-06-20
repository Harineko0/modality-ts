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

1. Add this shared feature-sliced directory structure:

```text
benchmarks/shared/
  README.md
  app-spec/
    routes.ts
    pages.ts
    seeded-outcomes.ts
    property-catalog.ts
  features/
    auth/
      domain/
        rbac.ts
        session.ts
        session.schema.ts
        session.ark.ts
      application/
        auth-service.ts
      infra/
        fake-auth-provider.ts
    accounts/
      domain/
        account.ts
        account.ark.ts
      application/
        account-service.ts
      infra/
        fake-account-repository.ts
    billing/
      domain/
        invoice.ts
        payment.ts
        billing.schema.ts
      application/
        billing-service.ts
      infra/
        fake-payment-gateway.ts
    subscription/
      domain/
        plan.ts
        approval.ts
        subscription.ark.ts
      application/
        subscription-service.ts
      infra/
        fake-subscription-api.ts
    management/
      domain/
        dashboard.ts
        dashboard.ark.ts
      application/
        management-service.ts
      infra/
        fake-management-api.ts
    support/
      domain/
        escalation.ts
        support.schema.ts
      application/
        support-service.ts
      infra/
        fake-support-api.ts
    audit/
      domain/
        audit.ts
        audit.ark.ts
      application/
        audit-service.ts
      infra/
        fake-audit-api.ts
    settings/
      domain/
        settings.ts
        settings.schema.ts
      application/
        settings-service.ts
      infra/
        fake-settings-api.ts
    fixtures/
      domain/
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

4. Use this RBAC matrix in `benchmarks/shared/features/auth/domain/rbac.ts`:

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

Each concrete page file has a sibling suffix props file. In React Router, route components are named `index.tsx`, so properties live in `index.props.ts`. In Next.js, route components are named `page.tsx`, so properties live in `page.props.ts`. Do not create standalone `props.ts` files for benchmark pages.

6. Use this page-by-page UI and primary state-owner matrix. A page should use the listed primary state library for its interactive UI state. Cross-page reads from `sessionAtom` or selected-account atoms are allowed where needed for guards, but do not import both Jotai and Zustand into every page just for coverage.

| Route | UI controls and outputs | Primary state owner and file | SWR resource | Domain validation owner |
| --- | --- | --- | --- | --- |
| `/login` | role segmented control, email field, password field, login button, login error banner, return-path notice | Jotai: `features/auth/state/session-atoms.ts` (`sessionAtom`, `returnToAtom`, `permissionCacheAtom`, `loginStatusAtom`) | none | Zod: `features/auth/domain/session.schema.ts` |
| `/dashboard` | status summary cards, selected account switcher, start checkout button, support badge, audit shortcut | Jotai: `features/accounts/state/selection-atoms.ts` (`selectedAccountAtom`, `selectedInvoiceAtom`) | `useDashboardSummary` from `features/dashboard/infra/dashboard-queries.ts` | ArkType: `features/accounts/domain/account.ark.ts` |
| `/management` | management tab list, revenue/risk/operations cards, refresh summary button, drill-down links | Jotai: `features/management/state/management-atoms.ts` (`managementTabAtom`) | `useManagementSummary` | ArkType: `features/management/domain/dashboard.ark.ts` |
| `/management/risk` | risk filter, high-risk account bucket, select bucket button, bulk suspend button, warning banner | Zustand: `features/management/state/management-store.ts` (`riskFilter`, `selectedRiskBucket`, `bulkStatus`) | `useRiskQueue` | ArkType: `features/management/domain/dashboard.ark.ts` |
| `/management/revenue` | revenue health cards, failed payment queue, retry all draft button, export CSV button | Zustand: `features/management/state/management-store.ts` (`revenueHealth`, `failedPaymentQueue`, `exportStatus`) | `useRevenueQueue` | ArkType: `features/management/domain/dashboard.ark.ts` |
| `/management/operations` | approval queue, support breach queue, assign reviewer button, bulk request approvals button | Zustand: `features/management/state/management-store.ts` (`opsQueue`, `assignmentStatus`) | `useOperationsQueue` | ArkType: `features/management/domain/dashboard.ark.ts` |
| `/accounts` | account status filter, account list bucket, open account button, suspended account warning | Jotai: `features/accounts/state/selection-atoms.ts` (`selectedAccountAtom`, `accountStatusFilterAtom`) | `useAccounts` | ArkType: `features/accounts/domain/account.ark.ts` |
| `/accounts/:accountId` | account profile panel, plan badge, status badge, tabs to subscription/billing/payment/support | Jotai: `features/accounts/state/selection-atoms.ts` (`selectedAccountAtom`, `accountDetailTabAtom`) | `useAccountDetail` | ArkType: `features/accounts/domain/account.ark.ts` |
| `/accounts/:accountId/subscription` | plan selector, seat stepper, request approval button, apply approval button, approval banner | Zustand: `features/subscription/state/subscription-store.ts` (`planDraft`, `seatDraft`, `approvalStatus`) | `useSubscription` | ArkType: `features/subscription/domain/subscription.ark.ts` |
| `/accounts/:accountId/billing` | invoice bucket, amount bucket, create payment intent button, capture payment button, retry invoice button | Zustand: `features/billing/state/billing-store.ts` (`paymentIntentStatus`, `retryCount`, `riskScore`) | `useBillingAccount` | Zod: `features/billing/domain/billing.schema.ts` |
| `/accounts/:accountId/payment-methods` | payment method status, add method button, mark expired button, set primary button, requires action banner | Zustand: `features/billing/state/payment-method-store.ts` (`methodStatus`, `saveStatus`) | `usePaymentMethods` | Zod: `features/billing/domain/billing.schema.ts` |
| `/accounts/:accountId/invoices/:invoiceId` | invoice detail, void button, dispute button, pay button, retry count output | Zustand: `features/billing/state/invoice-store.ts` (`invoiceStatus`, `retryCount`) | `useInvoiceDetail` | Zod: `features/billing/domain/billing.schema.ts` |
| `/accounts/:accountId/support` | priority selector, escalation text bucket, open escalation button, assign owner button | Zustand: `features/support/state/support-store.ts` (`priority`, `escalationStatus`) | `useSupportCase` | Zod: `features/support/domain/support.schema.ts` |
| `/approvals` | approval queue filter, approval detail card, approve button, reject button, apply approved change button | Zustand: `features/subscription/state/approval-store.ts` (`queueFilter`, `decisionStatus`) | `useApprovals` | ArkType: `features/subscription/domain/subscription.ark.ts` |
| `/audit` | action filter, actor role filter, export button, export status, results bucket | Jotai: `features/audit/state/audit-atoms.ts` (`auditActionFilterAtom`, `auditActorRoleFilterAtom`, `auditExportStatusAtom`) | `useAuditEvents` | ArkType: `features/audit/domain/audit.ark.ts` |
| `/settings` | tenant name field, billing policy toggle, save settings button, settings save status | Zustand: `features/settings/state/settings-store.ts` (`settingsDraft`, `saveStatus`) | `useSettings` | Zod: `features/settings/domain/settings.schema.ts` |
| `/settings/rbac` | user selector, target role selector, permission preview, save role assignment button, stale cache warning | Jotai: `features/auth/state/session-atoms.ts` (`permissionCacheAtom`, `targetRoleAtom`, `roleSaveStatusAtom`) | `useRoleAssignments` | ArkType: `features/auth/domain/session.ark.ts` |

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

8. Use this mixed DDD library responsibility map in both apps:

- Jotai:
  - `sessionAtom`
  - `permissionCacheAtom`
  - `returnToAtom`
  - `selectedAccountAtom`
  - `selectedInvoiceAtom`
  - `managementTabAtom`
  - `managementFilterAtom`
  - `auditActionFilterAtom`
  - `targetRoleAtom`
  - primary page owner for `/login`, `/dashboard`, `/management`, `/accounts`, `/accounts/:accountId`, `/audit`, and `/settings/rbac`
- Zustand:
  - workflow-machine stores for `/management/risk`, `/management/revenue`, `/management/operations`, `/subscription`, `/billing`, `/payment-methods`, `/invoices/:invoiceId`, `/support`, `/approvals`, and `/settings`
  - state names must stay stable because props use `s(component, idOverride)` or generated handles
- SWR:
  - one read hook per page list/detail resource listed in the page matrix
  - deterministic fake fetchers from each feature's `infra/` directory
  - bounded data buckets only: `empty`, `some`, `many`, or fixed enum records
- Zod:
  - schemas for auth, billing/payment/invoice, support, and settings domains only
  - component submit handlers in those domains call schema parse/safeParse before enqueueing fake API effects
- ArkType:
  - schemas/guards for RBAC, accounts, subscription/approvals, management, and audit domains only
  - app fixtures in those domains use ArkType validation before they reach fake repositories

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

10. Add `benchmarks/shared/README.md` with the route matrix, library map, seeded ledger, and the rule that apps may duplicate route components but not change domain outcomes.

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
