# LedgerOps React Router Benchmark App

## 1. Goal

Implement the LedgerOps benchmark app under `benchmarks/react-router/` using React Router while preserving the shared domain, page, library, effect API, and seeded-outcome specs from plan 06.

## 2. Non-goals

- Do not implement Next.js files in this plan.
- Do not fork the shared business rules.
- Do not omit any supported library: Jotai, Zustand, SWR, Zod, and ArkType must all run in app code.
- Do not hide route/page interactions in shared helpers that extraction cannot see.

## 3. Current-State Findings

- React Router support is enabled by package detection for `react-router` or `react-router-dom`.
- Existing conformance fixtures include React Router route files and app-level props patterns.
- Existing examples keep local package manifests inside app folders.

## 4. Existing Patterns to Follow

- Keep React components and event handlers in framework-local files.
- Keep pure domain and fake infra imports from `benchmarks/shared/`.
- Use stable button text and form controls for extractable handlers.
- Use finite enum/bucket state for lists and dashboards.

## 5. Atomic Implementation Steps

1. Add package and config files:

```text
benchmarks/react-router/
  package.json
  tsconfig.json
  index.html
  vite.config.ts
```

`package.json` dependencies:

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "arktype": "^2.1.0",
    "jotai": "^2.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "react-router-dom": "^6.0.0",
    "swr": "^2.0.0",
    "zustand": "^5.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "modality-ts": "file:../.."
  }
}
```

2. Add this React Router DDD directory structure:

```text
benchmarks/react-router/src/
  main.tsx
  App.tsx
  app.props.ts
  app/
    router.tsx
    providers.tsx
    shell/
      AppShell.tsx
      NavMenu.tsx
      GuardedRoute.tsx
  domain/
    index.ts
  application/
    hooks/
      useAuthActions.ts
      useBillingActions.ts
      useManagementActions.ts
      useRbacActions.ts
  infrastructure/
    fake/
      api.ts
    swr/
      account-queries.ts
      audit-queries.ts
      billing-queries.ts
      dashboard-queries.ts
      management-queries.ts
      settings-queries.ts
      support-queries.ts
  presentation/
    state/
      session-atoms.ts
      selection-atoms.ts
      management-atoms.ts
      auth-workflow-store.ts
      accounts-store.ts
      approval-store.ts
      audit-store.ts
      billing-store.ts
      dashboard-store.ts
      invoice-store.ts
      management-store.ts
      payment-method-store.ts
      rbac-store.ts
      settings-store.ts
      subscription-store.ts
      support-store.ts
    pages/
      LoginPage.tsx
      DashboardPage.tsx
      ManagementPage.tsx
      ManagementRiskPage.tsx
      ManagementRevenuePage.tsx
      ManagementOperationsPage.tsx
      AccountsPage.tsx
      AccountDetailPage.tsx
      SubscriptionPage.tsx
      BillingPage.tsx
      PaymentMethodsPage.tsx
      InvoiceDetailPage.tsx
      SupportPage.tsx
      ApprovalsPage.tsx
      AuditPage.tsx
      SettingsPage.tsx
      RbacSettingsPage.tsx
    components/
      StatusBadge.tsx
      PermissionGate.tsx
      AsyncButton.tsx
      BucketSelect.tsx
```

3. Implement `src/app/router.tsx` with exactly the route paths from plan 06 and components from `presentation/pages`.

4. Implement `src/app/providers.tsx` with:

- `SWRConfig` using deterministic fake fetchers.
- Jotai provider if needed.
- React Router app shell.

5. Implement Jotai atoms:

- `session-atoms.ts`: `sessionAtom`, `permissionCacheAtom`, `returnToAtom`.
- `selection-atoms.ts`: `selectedAccountAtom`, `selectedInvoiceAtom`.
- `management-atoms.ts`: `managementTabAtom`, `managementFilterAtom`.

6. Implement Zustand stores with exact state fields from plan 06 page matrix. Each store exposes small action methods with extractable names, for example:

- `billing-store.ts`: `paymentIntentStatus`, `retryCount`, `riskScore`, `setInvoiceBucket`, `markPaymentIntentCreated`, `markCaptureSucceeded`, `markRetryFailed`.
- `management-store.ts`: `summaryStatus`, `riskFilter`, `selectedRiskBucket`, `bulkDraft`, `bulkStatus`, `setRiskFilter`, `enqueueBulkSuspend`, `resolveBulkSuspend`.
- `rbac-store.ts`: `targetUser`, `targetRole`, `saveRoleStatus`, `setTargetRole`, `markRoleSaved`.

7. Implement fake infra wrapper `src/infrastructure/fake/api.ts` that re-exports shared fake functions under the exact effect API names:

```ts
export const api = {
  login,
  refreshSession,
  loadDashboardSummary,
  loadAccount,
  loadManagementSummary,
  bulkSuspendAccounts,
  requestApproval,
  applyApproval,
  createPaymentIntent,
  capturePayment,
  retryInvoice,
  savePaymentMethod,
  openSupportEscalation,
  exportAudit,
  saveSettings,
  saveRoleAssignment
};
```

8. Implement SWR hooks in `src/infrastructure/swr/*`:

- Hook names from plan 06 page matrix.
- Keys are literal or bounded tuple keys, such as `["account", selectedAccountBucket]`.
- Fetchers return shared fake fixture buckets.
- Mutations stay in page handlers or action hooks so extraction sees operations.

9. Implement Zod validation in each submit handler:

- `LoginPage` uses `LoginFormSchema`.
- Billing pages use payment schemas.
- Management pages use bulk action/export schemas.
- RBAC page uses role assignment schema.

10. Implement ArkType validation in domain fixture imports or page guards:

- Validate role, permission, queue buckets, risk buckets, seats, retry count, and amount bucket.
- Keep ArkType result branches finite and visible to extraction when possible.

11. Implement each page UI exactly:

- `/login`: role selector, email input, password input, login button, failure banner, return-to text.
- `/dashboard`: five cards (`Account status`, `Plan`, `Invoice`, `Support`, `Audit`), account selector, start checkout button.
- `/management`: tabs and three summary cards; refresh summary button.
- `/management/risk`: risk filter, selected risk bucket, bulk suspend button, admin-only warning.
- `/management/revenue`: revenue health, failed-payment queue, retry draft button, export CSV button.
- `/management/operations`: approval queue, support breach queue, assign reviewer button.
- `/accounts`: status filter, account list bucket, open selected account button.
- `/accounts/:accountId`: account profile, plan/status badges, links to child flows.
- `/subscription`: plan selector, seat stepper, request approval, apply approval.
- `/billing`: invoice selector, create payment intent, capture payment, retry invoice, risk score.
- `/payment-methods`: method status, add/expire/set-primary buttons.
- `/invoices/:invoiceId`: invoice status, pay/void/dispute/retry controls.
- `/support`: priority selector, escalation bucket, open/assign controls.
- `/approvals`: queue filter, approve/reject/apply controls.
- `/audit`: action filter, actor role filter, export button.
- `/settings`: tenant name bucket, billing policy toggle, save settings.
- `/settings/rbac`: user selector, role selector, permission preview, save role assignment.

12. Seed subtle bugs in framework code matching plan 06:

- Login success writes `permissionCacheAtom` from previous role in one interleaving.
- Return-to redirect checks cached permission instead of current role.
- Billing capture uses current selected invoice instead of enqueued invoice arg.
- Approval apply uses current seat draft instead of request snapshot.
- Support resolve writes current account while displaying enqueued account.
- Retry budget permits retry count `3` after risk score changes.
- Bulk suspend resolve uses current risk filter instead of enqueued risk bucket.

No source comments should mark these as bugs.

## 6. Tests to Add or Update

- `test/benchmarks/ledgerops-react-router.test.ts`
  - extraction includes all routes
  - coverage includes Jotai/Zustand/SWR state vars
  - effect API operations include all names from plan 06
  - Zod and ArkType package facts appear in extraction dependency facts or benchmark manifest validation

## 7. Verification

- `rtk pnpm exec modality extract benchmarks/react-router/src/App.tsx --props benchmarks/react-router/src/app.props.ts --package-json benchmarks/react-router/package.json --report /tmp/ledgerops-react-router.extract.json`
- `rtk pnpm test -- test/benchmarks/ledgerops-react-router.test.ts`
- `rtk pnpm typecheck`
- `rtk pnpm fix`

## 8. Acceptance Criteria

- `benchmarks/react-router/` contains the directory structure above.
- Every route in plan 06 is present in `src/app/router.tsx`.
- Jotai, Zustand, SWR, Zod, and ArkType each affect at least two pages.
- Seeded bugs exist through ordinary-looking app logic.
- Extraction sees route transitions, local workflow transitions, async effect APIs, and supported library state.

## 9. Risks, Ambiguities, and Stop Conditions

- Stop and report if React Router v6 route extraction misses nested routes; switch benchmark manifest `sourcePaths` to include route files directly.
- Stop and report if Zustand methods hide state writes from extraction; inline small action handlers in pages.
- Stop and report if SWR tuple keys explode the model; use bounded enum buckets from shared fixtures.
