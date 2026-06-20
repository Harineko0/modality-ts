# LedgerOps Benchmarks

LedgerOps is a B2B subscription operations console used to exercise modality-ts extraction and model checking across two framework implementations:

- `benchmarks/react-router/` — React Router app with `index.props.ts` beside each route
- `benchmarks/nextjs/` — Next.js App Router app with `page.props.ts` beside each route

Both apps share domain rules, effect APIs, property names, and seeded outcome classification via `benchmarks/shared/`.

## DDD structure

- `benchmarks/shared/features/*` — pure domain, application services, and fake infra
- `benchmarks/*/src/features/*` — framework-local state, queries, and UI components
- `benchmarks/*/src/routes/**` or `benchmarks/*/src/app/**` — route pages and colocated props files

## Page matrix

| Route | Primary state | Validation |
| --- | --- | --- |
| `/login` | Jotai session atoms | Zod |
| `/dashboard` | Jotai selection atoms | ArkType |
| `/management` | Jotai management atoms | ArkType |
| `/management/risk` | Zustand management store | ArkType |
| `/management/revenue` | Zustand management store | ArkType |
| `/management/operations` | Zustand management store | ArkType |
| `/accounts` | Jotai selection atoms | ArkType |
| `/accounts/:accountId` | Jotai selection atoms | ArkType |
| `/accounts/:accountId/subscription` | Zustand subscription store | ArkType |
| `/accounts/:accountId/billing` | Zustand billing store | Zod |
| `/accounts/:accountId/payment-methods` | Zustand payment-method store | Zod |
| `/accounts/:accountId/invoices/:invoiceId` | Zustand invoice store | Zod |
| `/accounts/:accountId/support` | Zustand support store | Zod |
| `/approvals` | Zustand approval store | ArkType |
| `/audit` | Jotai audit atoms | ArkType |
| `/settings` | Zustand settings store | Zod |
| `/settings/rbac` | Jotai session atoms | ArkType |

## Supported library coverage

| Library | Responsibility |
| --- | --- |
| Jotai | Session, return path, selected account/invoice, management tab, audit filters, RBAC target role |
| Zustand | Management workflows, billing, subscription, approvals, support, settings |
| SWR | One read hook per page list/detail resource |
| Zod | Auth, billing, payment methods, invoices, support, settings forms |
| ArkType | RBAC, accounts, subscription, approvals, management, audit domains |

Libraries are allocated to planned pages/domains rather than imported into every page.

## Seeded outcome classification

The benchmark manifest tracks expected TP/TN/FP/FN counts against `benchmarks/shared/app-spec/seeded-outcomes.ts`:

- **TP (7)** — seeded bugs the checker should violate and replay should reproduce
- **TN (7)** — invariants the checker should verify
- **FP probe (3)** — over-approximation probes accepted when replay is not reproduced or model slack applies
- **FN probe (3)** — metadata-only expected gaps with no property

## Commands

```bash
pnpm benchmarks
pnpm benchmarks:react-router
pnpm benchmarks:nextjs
pnpm benchmarks -- --report .modality/benchmarks/report.json
```
