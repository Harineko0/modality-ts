# LedgerOps Shared Benchmark Specification

Shared domain, page, library, effect API, and seeded-outcome specification for the LedgerOps benchmark suite. Framework apps under `benchmarks/react-router/` and `benchmarks/nextjs/` import these pure modules; they may duplicate route components but must not change domain outcomes.

## Route inventory

| Route | Primary state library | SWR resource | Validation |
| --- | --- | --- | --- |
| `/login` | Jotai (`session-atoms.ts`) | none | Zod (`session.schema.ts`) |
| `/dashboard` | Jotai (`selection-atoms.ts`) | `useDashboardSummary` | ArkType (`account.ark.ts`) |
| `/management` | Jotai (`management-atoms.ts`) | `useManagementSummary` | ArkType (`dashboard.ark.ts`) |
| `/management/risk` | Zustand (`management-store.ts`) | `useRiskQueue` | ArkType (`dashboard.ark.ts`) |
| `/management/revenue` | Zustand (`management-store.ts`) | `useRevenueQueue` | ArkType (`dashboard.ark.ts`) |
| `/management/operations` | Zustand (`management-store.ts`) | `useOperationsQueue` | ArkType (`dashboard.ark.ts`) |
| `/accounts` | Jotai (`selection-atoms.ts`) | `useAccounts` | ArkType (`account.ark.ts`) |
| `/accounts/:accountId` | Jotai (`selection-atoms.ts`) | `useAccountDetail` | ArkType (`account.ark.ts`) |
| `/accounts/:accountId/subscription` | Zustand (`subscription-store.ts`) | `useSubscription` | ArkType (`subscription.ark.ts`) |
| `/accounts/:accountId/billing` | Zustand (`billing-store.ts`) | `useBillingAccount` | Zod (`billing.schema.ts`) |
| `/accounts/:accountId/payment-methods` | Zustand (`payment-method-store.ts`) | `usePaymentMethods` | Zod (`billing.schema.ts`) |
| `/accounts/:accountId/invoices/:invoiceId` | Zustand (`invoice-store.ts`) | `useInvoiceDetail` | Zod (`billing.schema.ts`) |
| `/accounts/:accountId/support` | Zustand (`support-store.ts`) | `useSupportCase` | Zod (`support.schema.ts`) |
| `/approvals` | Zustand (`approval-store.ts`) | `useApprovals` | ArkType (`subscription.ark.ts`) |
| `/audit` | Jotai (`audit-atoms.ts`) | `useAuditEvents` | ArkType (`audit.ark.ts`) |
| `/settings` | Zustand (`settings-store.ts`) | `useSettings` | Zod (`settings.schema.ts`) |
| `/settings/rbac` | Jotai (`session-atoms.ts`) | `useRoleAssignments` | ArkType (`session.ark.ts`) |

Typed exports: `ledgerOpsRoutes` in `app-spec/routes.ts`, `ledgerOpsPages` in `app-spec/pages.ts`.

## Library responsibility map

- **Jotai**: `sessionAtom`, `permissionCacheAtom`, `returnToAtom`, `selectedAccountAtom`, `selectedInvoiceAtom`, `managementTabAtom`, `managementFilterAtom`, `auditActionFilterAtom`, `targetRoleAtom`. Primary page owner for `/login`, `/dashboard`, `/management`, `/accounts`, `/accounts/:accountId`, `/audit`, and `/settings/rbac`.
- **Zustand**: workflow-machine stores for `/management/risk`, `/management/revenue`, `/management/operations`, subscription, billing, payment-methods, invoices, support, approvals, and settings. State names stay stable for props `s(component, idOverride)` handles.
- **SWR**: one read hook per page list/detail resource in the matrix; deterministic fake fetchers from each feature `infra/` directory; bounded buckets only (`empty`, `some`, `many`, or fixed enum records).
- **Zod**: auth, billing/payment/invoice, support, and settings domains. Submit handlers call `parse`/`safeParse` before enqueueing fake API effects.
- **ArkType**: RBAC, accounts, subscription/approvals, management, and audit domains. Fixtures use ArkType validation before fake repositories.

Typed exports: `ledgerOpsJotaiStateNames`, `ledgerOpsZustandPrimaryRoutes`, `ledgerOpsSwrHooks`, `ledgerOpsZodDomains`, `ledgerOpsArktypeDomains` in `app-spec/property-catalog.ts`.

## Effect APIs

`ledgerOpsEffectApis` in `app-spec/property-catalog.ts` lists every fake infra effect name both apps must expose.

## Seeded expected-outcome ledger

`ledgerOpsSeededOutcomes` in `app-spec/seeded-outcomes.ts` records TP/TN/FP/FN probe expectations for both frameworks. Property references use names from `ledgerOpsProperties` in `app-spec/property-catalog.ts`.

## Parity rule

Apps may duplicate route components and framework-specific state files, but must import shared domain rules, RBAC matrix, fixtures, fake infra contracts, routes, page matrix, effect API names, and seeded outcomes from `benchmarks/shared/` without altering expected checker results.
