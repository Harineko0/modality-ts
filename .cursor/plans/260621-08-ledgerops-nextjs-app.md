# LedgerOps Next.js Benchmark App

## 1. Goal

Implement the LedgerOps benchmark app under `benchmarks/nextjs/` using Next.js App Router while preserving the shared domain, page, library, effect API, and seeded-outcome specs from plan 06.

## 2. Non-goals

- Do not implement React Router files in this plan.
- Do not rely on server-only state for benchmark behavior that props must check.
- Do not omit Jotai, Zustand, SWR, Zod, or ArkType from client app code.
- Do not change shared seeded outcomes for Next-specific convenience.

## 3. Current-State Findings

- Next support is enabled by dependency detection for `next`.
- The Next adapter models App Router route/module roles and Next route state.
- Interactive benchmark behavior must live in client components for extraction.

## 4. Existing Patterns to Follow

- Keep `page.tsx` files thin and delegate interactive UI to colocated client components.
- Keep pure domain imports from `benchmarks/shared/`.
- Use static route files and static config.
- Keep fake infra and SWR hooks under app-local infrastructure folders.

## 5. Atomic Implementation Steps

1. Add package and config files:

```text
benchmarks/nextjs/
  package.json
  tsconfig.json
  next.config.ts
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

2. Add this Next DDD directory structure:

```text
benchmarks/nextjs/
  app/
    layout.tsx
    providers.tsx
    page.tsx
    login/page.tsx
    dashboard/page.tsx
    management/page.tsx
    management/risk/page.tsx
    management/revenue/page.tsx
    management/operations/page.tsx
    accounts/page.tsx
    accounts/[accountId]/page.tsx
    accounts/[accountId]/subscription/page.tsx
    accounts/[accountId]/billing/page.tsx
    accounts/[accountId]/payment-methods/page.tsx
    accounts/[accountId]/invoices/[invoiceId]/page.tsx
    accounts/[accountId]/support/page.tsx
    approvals/page.tsx
    audit/page.tsx
    settings/page.tsx
    settings/rbac/page.tsx
  src/
    app.props.ts
    domain/index.ts
    application/hooks/
      useAuthActions.ts
      useBillingActions.ts
      useManagementActions.ts
      useRbacActions.ts
    infrastructure/
      fake/api.ts
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
        LoginClient.tsx
        DashboardClient.tsx
        ManagementClient.tsx
        ManagementRiskClient.tsx
        ManagementRevenueClient.tsx
        ManagementOperationsClient.tsx
        AccountsClient.tsx
        AccountDetailClient.tsx
        SubscriptionClient.tsx
        BillingClient.tsx
        PaymentMethodsClient.tsx
        InvoiceDetailClient.tsx
        SupportClient.tsx
        ApprovalsClient.tsx
        AuditClient.tsx
        SettingsClient.tsx
        RbacSettingsClient.tsx
      components/
        StatusBadge.tsx
        PermissionGate.tsx
        AsyncButton.tsx
        BucketSelect.tsx
```

3. Every `app/**/page.tsx` imports and renders its matching `*Client.tsx`. Client files start with `"use client";`.

4. `app/providers.tsx` wraps the app with:

- `SWRConfig`
- Jotai provider if needed
- app shell/nav component

5. App Router path mapping:

- root `/` redirects or links to `/dashboard`; keep `/login` as the unauthenticated entry.
- Every page listed in plan 06 has one `page.tsx`.
- Dynamic route params use `[accountId]` and `[invoiceId]`, but page clients receive bounded fixture buckets, not arbitrary strings.

6. Implement Jotai atoms and Zustand stores with the same file names and state fields as the React Router app. The import paths differ, but exported atom/store names must match.

7. Implement fake API and SWR hooks with the same operation names and SWR hook names as React Router.

8. Implement page UI exactly as the plan 06 page matrix and plan 07 page UI list. Next page clients must use the same button text, form labels, local state names, and action hook names as the React Router pages.

9. Implement Next route/RBAC guards:

- `PermissionGate.tsx` hides controls without permission.
- Client pages with forbidden role render a redirect button and set route/navigation state through Next navigation APIs.
- Guard behavior mirrors React Router:
  - `guest` can reach `/login` only.
  - `analyst` cannot reach `/settings`, `/settings/rbac`, or bulk management controls.
  - `manager` can reach `/management` and child dashboard pages but cannot bulk suspend.
  - `admin` can reach all pages and operations.

10. Use all third-party libraries in client code:

- Jotai atoms imported by at least login, dashboard, management, billing, and RBAC clients.
- Zustand stores imported by every workflow page client.
- SWR hooks imported by dashboard, accounts, management, billing, support, audit, settings, and RBAC clients.
- Zod schemas called in every submit handler before fake API enqueue.
- ArkType guards called in fixture hydration or page-level action guards for roles, permission buckets, amount/risk/retry buckets, and queue buckets.

11. Seed the same subtle bugs as plan 07 using Next client code:

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

- `rtk pnpm exec modality extract benchmarks/nextjs/app/page.tsx --props benchmarks/nextjs/src/app.props.ts --package-json benchmarks/nextjs/package.json --report /tmp/ledgerops-nextjs.extract.json`
- If single-entry extraction misses route files, use the benchmark manifest with multiple source paths under `benchmarks/nextjs/app/**/*.tsx`.
- `rtk pnpm test -- test/benchmarks/ledgerops-nextjs.test.ts`
- `rtk pnpm typecheck`
- `rtk pnpm fix`

## 8. Acceptance Criteria

- `benchmarks/nextjs/` contains the directory structure above.
- Every route in plan 06 has an App Router page.
- Client components use the same UI controls and business state names as React Router.
- Jotai, Zustand, SWR, Zod, and ArkType each affect at least two pages.
- Extraction sees Next route inventory, route transitions, workflow transitions, async effect APIs, and supported library state.

## 9. Risks, Ambiguities, and Stop Conditions

- Stop and report if App Router extraction misses client components behind server `page.tsx` wrappers; add explicit source paths to the benchmark manifest.
- Stop and report if Next server/layout files hide essential interactions from extraction; move benchmark interactions into client components.
- Stop and report if route params become unbounded token domains; map them to bounded fixture buckets in client code.
