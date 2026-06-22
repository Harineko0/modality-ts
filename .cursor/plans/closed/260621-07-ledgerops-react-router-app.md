# LedgerOps React Router Benchmark App

## 1. Goal

Implement the LedgerOps benchmark app under `benchmarks/react-router/` using React Router while preserving the shared domain, page, library, effect API, and seeded-outcome specs from plan 06.

## 2. Non-goals

- Do not implement Next.js files in this plan.
- Do not fork the shared business rules.
- Do not omit any supported library: Jotai, Zustand, SWR, Zod, and ArkType must all run in app code.
- Do not import all state/validation libraries into every page. Follow the mixed page/domain allocation from plan 06.
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

2. Add this React Router feature-sliced directory structure. Route directories own page UI and colocated `index.props.ts`; feature directories own domain/application/infra/state/common components.

```text
benchmarks/react-router/src/
  main.tsx
  App.tsx
  app/
    router.tsx
    providers.tsx
    shell/
      AppShell.tsx
      NavMenu.tsx
  features/
    auth/
      domain/
      application/
        useAuthActions.ts
      infra/
        api.ts
      state/
        session-atoms.ts
      _components/
        PermissionGate.tsx
        RoleBadge.tsx
    accounts/
      domain/
      application/
        useAccountActions.ts
      infra/
        account-queries.ts
      state/
        selection-atoms.ts
      _components/
        AccountStatusBadge.tsx
        AccountBucketSelect.tsx
    dashboard/
      domain/
      application/
      infra/
        dashboard-queries.ts
      state/
      _components/
        DashboardCard.tsx
    management/
      domain/
      application/
        useManagementActions.ts
      infra/
        management-queries.ts
      state/
        management-atoms.ts
        management-store.ts
      _components/
        ManagementTabs.tsx
        BulkActionButton.tsx
    billing/
      domain/
      application/
        useBillingActions.ts
      infra/
        billing-queries.ts
        api.ts
      state/
        billing-store.ts
        invoice-store.ts
        payment-method-store.ts
      _components/
        InvoiceStatusBadge.tsx
        PaymentIntentPanel.tsx
    subscription/
      domain/
      application/
        useSubscriptionActions.ts
      infra/
        subscription-queries.ts
      state/
        subscription-store.ts
        approval-store.ts
      _components/
        PlanSelector.tsx
        ApprovalBanner.tsx
    support/
      domain/
      application/
        useSupportActions.ts
      infra/
        support-queries.ts
      state/
        support-store.ts
      _components/
        PrioritySelect.tsx
    audit/
      domain/
      application/
        useAuditActions.ts
      infra/
        audit-queries.ts
      state/
        audit-atoms.ts
      _components/
        AuditFilterBar.tsx
    settings/
      domain/
      application/
        useSettingsActions.ts
      infra/
        settings-queries.ts
      state/
        settings-store.ts
      _components/
        SettingsSaveBar.tsx
    common/
      _components/
        AsyncButton.tsx
        BucketSelect.tsx
        StatusBadge.tsx
  routes/
    login/
      index.tsx
      index.props.ts
      _components/
        LoginForm.tsx
    dashboard/
      index.tsx
      index.props.ts
      _components/
        DashboardSummary.tsx
    management/
      index.tsx
      index.props.ts
      _components/
        ManagementOverview.tsx
      risk/
        index.tsx
        index.props.ts
        _components/
          RiskBulkPanel.tsx
      revenue/
        index.tsx
        index.props.ts
        _components/
          RevenueQueuePanel.tsx
      operations/
        index.tsx
        index.props.ts
        _components/
          OperationsQueuePanel.tsx
    accounts/
      index.tsx
      index.props.ts
      _components/
        AccountList.tsx
      $accountId/
        index.tsx
        index.props.ts
        _components/
          AccountProfile.tsx
        subscription/
          index.tsx
          index.props.ts
          _components/
            SubscriptionEditor.tsx
        billing/
          index.tsx
          index.props.ts
          _components/
            BillingWorkbench.tsx
        payment-methods/
          index.tsx
          index.props.ts
          _components/
            PaymentMethodEditor.tsx
        invoices/
          $invoiceId/
            index.tsx
            index.props.ts
            _components/
              InvoiceActions.tsx
        support/
          index.tsx
          index.props.ts
          _components/
            SupportEscalationForm.tsx
    approvals/
      index.tsx
      index.props.ts
      _components/
        ApprovalQueue.tsx
    audit/
      index.tsx
      index.props.ts
      _components/
        AuditExportPanel.tsx
    settings/
      index.tsx
      index.props.ts
      _components/
        TenantSettingsForm.tsx
      rbac/
        index.tsx
        index.props.ts
        _components/
          RoleAssignmentForm.tsx
```

3. Implement `src/app/router.tsx` with exactly the route paths from plan 06 and route modules from `src/routes/**/index.tsx`. Do not create `*Page.tsx` files.

4. Implement `src/app/providers.tsx` with:

- `SWRConfig` using deterministic fake fetchers.
- Jotai provider if needed.
- React Router app shell.

5. Implement Jotai atoms for the Jotai-owned pages and cross-page guards from plan 06:

- `features/auth/state/session-atoms.ts`: `sessionAtom`, `permissionCacheAtom`, `returnToAtom`.
- `features/accounts/state/selection-atoms.ts`: `selectedAccountAtom`, `selectedInvoiceAtom`.
- `features/management/state/management-atoms.ts`: `managementTabAtom`.
- `features/audit/state/audit-atoms.ts`: `auditActionFilterAtom`, `auditActorRoleFilterAtom`, `auditExportStatusAtom`.

6. Implement Zustand stores only for the Zustand-owned workflow pages from plan 06. Each store exposes small action methods with extractable names, for example:

- `billing-store.ts`: `paymentIntentStatus`, `retryCount`, `riskScore`, `setInvoiceBucket`, `markPaymentIntentCreated`, `markCaptureSucceeded`, `markRetryFailed`.
- `management-store.ts`: `summaryStatus`, `riskFilter`, `selectedRiskBucket`, `bulkDraft`, `bulkStatus`, `setRiskFilter`, `enqueueBulkSuspend`, `resolveBulkSuspend`.
- `settings-store.ts`: `settingsDraft`, `saveStatus`, `setBillingPolicy`, `markSettingsSaved`.

7. Implement feature-local fake infra wrappers that re-export shared fake functions under the exact effect API names. Use these file locations:

- `src/features/auth/infra/api.ts`: `login`, `refreshSession`
- `src/features/dashboard/infra/dashboard-queries.ts`: `loadDashboardSummary`
- `src/features/accounts/infra/account-queries.ts`: `loadAccount`
- `src/features/management/infra/management-queries.ts`: `loadManagementSummary`, `bulkSuspendAccounts`
- `src/features/subscription/infra/subscription-queries.ts`: `requestApproval`, `applyApproval`
- `src/features/billing/infra/api.ts`: `createPaymentIntent`, `capturePayment`, `retryInvoice`, `savePaymentMethod`
- `src/features/support/infra/support-queries.ts`: `openSupportEscalation`
- `src/features/audit/infra/audit-queries.ts`: `exportAudit`
- `src/features/settings/infra/settings-queries.ts`: `saveSettings`
- `src/features/auth/infra/api.ts`: `saveRoleAssignment`

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

8. Implement SWR hooks in feature-local `infra/*-queries.ts` files:

- Hook names from plan 06 page matrix.
- Keys are literal or bounded tuple keys, such as `["account", selectedAccountBucket]`.
- Fetchers return shared fake fixture buckets.
- Mutations stay in page handlers or action hooks so extraction sees operations.

9. Implement Zod validation only in Zod-owned feature domains from plan 06:

- `routes/login/_components/LoginForm.tsx` uses `LoginFormSchema`.
- Billing pages use payment schemas.
- Support pages use support escalation schemas.
- Settings pages use settings schemas.

10. Implement ArkType validation only in ArkType-owned domains from plan 06:

- Validate role, permission, account buckets, subscription seats, approval states, management queue buckets, management risk buckets, and audit filters.
- Keep ArkType result branches finite and visible to extraction when possible.

11. Implement each route UI exactly in `src/routes/**/index.tsx` plus its route-local `_components/`:

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

12. Add one `index.props.ts` file per route directory listed in the structure above. Each file imports property helpers and route/feature handles for only that page's properties. The benchmark manifest in plan 09 lists every `index.props.ts` path explicitly.

13. Seed subtle bugs in framework code matching plan 06:

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
  - coverage includes Jotai state vars on Jotai-owned pages and Zustand vars on Zustand-owned pages
  - effect API operations include all names from plan 06
  - Zod appears through auth/billing/support/settings domains and ArkType appears through RBAC/accounts/subscription/management/audit domains

## 7. Verification

- `rtk pnpm exec modality extract benchmarks/react-router/src/App.tsx --props benchmarks/react-router/src/routes/login/index.props.ts --package-json benchmarks/react-router/package.json --report /tmp/ledgerops-react-router.extract.json`
- `rtk pnpm test -- test/benchmarks/ledgerops-react-router.test.ts`
- `rtk pnpm typecheck`
- `rtk pnpm fix`

## 8. Acceptance Criteria

- `benchmarks/react-router/` contains the directory structure above.
- Every route in plan 06 is present in `src/app/router.tsx`.
- Jotai, Zustand, SWR, Zod, and ArkType each affect the exact page/domain allocation from plan 06.
- Seeded bugs exist through ordinary-looking app logic.
- Extraction sees route transitions, local workflow transitions, async effect APIs, and supported library state.

## 9. Risks, Ambiguities, and Stop Conditions

- Stop and report if React Router v6 route extraction misses nested routes; switch benchmark manifest `sourcePaths` to include route files directly.
- Stop and report if Zustand methods hide state writes from extraction; inline small action handlers in pages.
- Stop and report if SWR tuple keys explode the model; use bounded enum buckets from shared fixtures.
