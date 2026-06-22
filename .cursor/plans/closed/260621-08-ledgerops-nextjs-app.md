# LedgerOps Next.js Benchmark App

## 1. Goal

Implement the LedgerOps benchmark app under `benchmarks/nextjs/` using Next.js App Router while preserving the shared domain, page, library, effect API, and seeded-outcome specs from plan 06.

## 2. Non-goals

- Do not implement React Router files in this plan.
- Do not rely on server-only state for benchmark behavior that props must check.
- Do not omit Jotai, Zustand, SWR, Zod, or ArkType from client app code.
- Do not import all state/validation libraries into every client page. Follow the mixed page/domain allocation from plan 06.
- Do not change shared seeded outcomes for Next-specific convenience.

## 3. Current-State Findings

- Next support is enabled by dependency detection for `next`.
- The Next adapter models App Router route/module roles and Next route state.
- Interactive benchmark behavior must live in client components for extraction.

## 4. Existing Patterns to Follow

- Keep route UI in `src/app/**/page.tsx` plus colocated `_components/`.
- Keep pure domain imports from `benchmarks/shared/`.
- Use static route files and static config.
- Keep fake infra and SWR hooks under feature-local `src/features/<feature>/infra/` folders.

## 5. Atomic Implementation Steps

1. Add package and config files:

```text
benchmarks/nextjs/
  package.json
  tsconfig.json
  next.config.ts
  src/
    app/
      layout.tsx
      page.tsx
```

`package.json` dependencies:

```json
{
  "private": true,
  "type": "module",
  "dependencies": {
    "arktype": "^2.1.0",
    "jotai": "^2.0.0",
    "next": "^15.0.0",
    "react": "^18.0.0",
    "react-dom": "^18.0.0",
    "swr": "^2.0.0",
    "zustand": "^5.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "modality-ts": "file:../.."
  }
}
```

2. Add this Next feature-sliced directory structure. Next's `app` directory lives under `src/app`. Route directories own `page.tsx`, `page.props.ts`, and route-local `_components/`; feature directories own domain/application/infra/state/common components.

```text
benchmarks/nextjs/
  src/
    app/
      layout.tsx
      providers.tsx
      page.tsx
      login/
        page.tsx
        page.props.ts
        _components/
          LoginForm.tsx
      dashboard/
        page.tsx
        page.props.ts
        _components/
          DashboardSummary.tsx
      management/
        page.tsx
        page.props.ts
        _components/
          ManagementOverview.tsx
        risk/
          page.tsx
          page.props.ts
          _components/
            RiskBulkPanel.tsx
        revenue/
          page.tsx
          page.props.ts
          _components/
            RevenueQueuePanel.tsx
        operations/
          page.tsx
          page.props.ts
          _components/
            OperationsQueuePanel.tsx
      accounts/
        page.tsx
        page.props.ts
        _components/
          AccountList.tsx
        [accountId]/
          page.tsx
          page.props.ts
          _components/
            AccountProfile.tsx
          subscription/
            page.tsx
            page.props.ts
            _components/
              SubscriptionEditor.tsx
          billing/
            page.tsx
            page.props.ts
            _components/
              BillingWorkbench.tsx
          payment-methods/
            page.tsx
            page.props.ts
            _components/
              PaymentMethodEditor.tsx
          invoices/
            [invoiceId]/
              page.tsx
              page.props.ts
              _components/
                InvoiceActions.tsx
          support/
            page.tsx
            page.props.ts
            _components/
              SupportEscalationForm.tsx
      approvals/
        page.tsx
        page.props.ts
        _components/
          ApprovalQueue.tsx
      audit/
        page.tsx
        page.props.ts
        _components/
          AuditExportPanel.tsx
      settings/
        page.tsx
        page.props.ts
        _components/
          TenantSettingsForm.tsx
        rbac/
          page.tsx
          page.props.ts
          _components/
            RoleAssignmentForm.tsx
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
        infra/
          dashboard-queries.ts
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
```

3. Every interactive `src/app/**/page.tsx` starts with `"use client";` or imports route-local client components from its sibling `_components/`. Do not create `*Page.tsx` or `*Client.tsx` files.

4. `src/app/providers.tsx` wraps the app with:

- `SWRConfig`
- Jotai provider if needed
- app shell/nav component

5. App Router path mapping:

- root `/` redirects or links to `/dashboard`; keep `/login` as the unauthenticated entry.
- Every page listed in plan 06 has one `page.tsx` and one colocated `page.props.ts`.
- Dynamic route params use `[accountId]` and `[invoiceId]`, but page clients receive bounded fixture buckets, not arbitrary strings.

6. Implement Jotai atoms and Zustand stores with the same mixed ownership as the React Router app. The import paths differ, but exported atom/store names must match plan 06:

- Jotai-owned pages: login, dashboard, management overview, accounts list/detail, audit, RBAC settings.
- Zustand-owned pages: management risk/revenue/operations, subscription, billing, payment methods, invoice detail, support, approvals, settings.

7. Implement fake API and SWR hooks in feature-local `src/features/<feature>/infra/` files with the same operation names and SWR hook names as React Router.

8. Implement page UI exactly as the plan 06 page matrix and plan 07 page UI list. Next route files and route-local `_components/` must use the same button text, form labels, local state names, and action hook names as the React Router pages.

9. Implement Next route/RBAC guards:

- `PermissionGate.tsx` hides controls without permission.
- Client pages with forbidden role render a redirect button and set route/navigation state through Next navigation APIs.
- Guard behavior mirrors React Router:
  - `guest` can reach `/login` only.
  - `analyst` cannot reach `/settings`, `/settings/rbac`, or bulk management controls.
  - `manager` can reach `/management` and child dashboard pages but cannot bulk suspend.
  - `admin` can reach all pages and operations.

10. Use all third-party libraries in client code with the mixed allocation from plan 06:

- Jotai atoms imported by login, dashboard, management overview, accounts list/detail, audit, and RBAC clients.
- Zustand stores imported by management risk/revenue/operations, subscription, billing, payment methods, invoice detail, support, approvals, and settings clients.
- SWR hooks imported by dashboard, accounts, management, billing, support, audit, settings, and RBAC clients.
- Zod schemas called in auth, billing/payment/invoice, support, and settings submit handlers before fake API enqueue.
- ArkType guards called in RBAC, account, subscription/approval, management, and audit fixture hydration or page-level action guards.

11. Add one `page.props.ts` file beside every `page.tsx` listed in the structure above. The benchmark manifest in plan 09 lists every `src/app/**/page.props.ts` path explicitly.

12. Seed the same subtle bugs as plan 07 using Next client code:

- stale permission cache after role switch
- cached permission return-to guard
- capture payment current invoice bug
- approval current seat draft bug
- support current account write bug
- retry budget off-by-one after risk change
- bulk suspend current risk filter bug

No source comments should mark these as bugs.

## 6. Tests to Add or Update

- `test/benchmarks/ledgerops-nextjs.test.ts`
  - extraction includes all App Router pages
  - Next route tree variables are present where expected
  - Jotai/Zustand/SWR/Zod/ArkType dependency facts are present in package or manifest checks
  - effect API operations match the shared list

## 7. Verification

- `rtk pnpm exec modality extract benchmarks/nextjs/src/app/page.tsx --props benchmarks/nextjs/src/app/login/page.props.ts --package-json benchmarks/nextjs/package.json --report /tmp/ledgerops-nextjs.extract.json`
- If single-entry extraction misses route files, use the benchmark manifest with multiple source paths under `benchmarks/nextjs/src/app/**/*.tsx`.
- `rtk pnpm test -- test/benchmarks/ledgerops-nextjs.test.ts`
- `rtk pnpm typecheck`
- `rtk pnpm fix`

## 8. Acceptance Criteria

- `benchmarks/nextjs/` contains the directory structure above.
- Every route in plan 06 has an App Router page.
- Client components use the same UI controls and business state names as React Router.
- Jotai, Zustand, SWR, Zod, and ArkType each affect the exact page/domain allocation from plan 06.
- Extraction sees Next route inventory, route transitions, workflow transitions, async effect APIs, and supported library state.

## 9. Risks, Ambiguities, and Stop Conditions

- Stop and report if App Router extraction misses client components behind server `page.tsx` wrappers; add explicit source paths to the benchmark manifest.
- Stop and report if Next server/layout files hide essential interactions from extraction; move benchmark interactions into client components.
- Stop and report if route params become unbounded token domains; map them to bounded fixture buckets in client code.
