# LedgerOps Props, Runner, Tests, and Workflow

## 1. Goal

Add benchmark props files, property API coverage, expected-outcome classification, benchmark runner tooling, documentation, and GitHub Actions workflow for the LedgerOps React Router and Next.js benchmark apps.

## 2. Non-goals

- Do not implement app UI in this plan.
- Do not weaken properties to match seeded bugs.
- Do not conflate known FP/FN probes with passing product behavior.
- Do not import private extractor internals in benchmark runner code.

## 3. Current-State Findings

- Existing canary runner code already orchestrates extraction/check/replay through CLI wrappers.
- Public property APIs include registration helpers, CTL helpers, expression helpers, step helpers, `s`, `variable`, `pre`, `readOpArg`, and built-in vars.
- Existing CI uses separate workflows and pnpm setup that the benchmark workflow can copy.

## 4. Existing Patterns to Follow

- Use structured JSON manifests for benchmark expectations.
- Use `runExtractCommand`, `runCheckCommand`, and `runReplayCommand` from CLI wrappers.
- Use `rtk` for commands.
- Keep docs outside generated `docs/build/`.

## 5. Atomic Implementation Steps

1. Add one suffix `*.props.ts` file beside every page route file:

```text
benchmarks/react-router/src/routes/**/index.props.ts
benchmarks/nextjs/src/app/**/page.props.ts
```

Every route in plan 06 has exactly one colocated suffix props file. For React Router, `index.tsx` has sibling `index.props.ts`. For Next.js, `page.tsx` has sibling `page.props.ts`. Property names stay identical across frameworks, but imports point at framework-local route/feature files. Do not add `app.props.ts` aggregators.

2. Cover every public Property API across the two apps:

| API | Required use |
| --- | --- |
| `group` | every feature props file wraps names in feature group |
| `always` | auth/RBAC/billing/settings invariants |
| `reachable` | every main workflow has one non-vacuity check |
| `reachableFrom` | valid payment, approved subscription, and admin management states |
| `leadsToWithin` | login, management summary load, payment capture, audit export |
| `alwaysStep` | enqueue/resolve snapshot properties |
| `property` | CTL formulas for route guards and management dashboard |
| `inevitably` | one fair-progress formula for settling dashboard summary |
| `ctl.holds` | all CTL atom construction |
| `ctl.negate` | FP probe and forbidden route formula |
| `ctl.allOf` | combined route/RBAC formulas |
| `ctl.anyOf` | normal/error settlement formulas |
| `ctl.implies` | conditional route guard formulas |
| `ctl.always` | global CTL invariants |
| `ctl.canReach` | existential workflow reachability |
| `ctl.eventually` | payment and dashboard settlement |
| `ctl.canStayForever` | impossible stuck-loading FP probe |
| `ctl.afterEveryStep` | permission cache consistency |
| `ctl.afterSomeStep` | admin can take a management action |
| `ctl.holdsUntil` | login loading holds until success/error |
| `ctl.canHoldUntil` | payment requires-action branch probe |
| `ctl.fairlyOften` | fair summary refresh / network settles constraint |
| `variable` | SWR/cache/system vars without importable handles |
| `s` | component local state handles when generated handles are absent |
| `pre` | stale snapshot and no-mutation checks |
| `readOpArg` | payment, approval, support, management bulk snapshot checks |
| `eq`, `neq`, `and`, `or`, `not` | baseline predicates |
| `lessThan`, `lessThanOrEqual`, `greaterThan`, `greaterThanOrEqual`, `add`, `sub`, `mod` | seats, retry, risk, amount bucket numeric checks |
| `enabled` | exact transition guard properties where IDs are stable |
| `enabledTransitionPrefix` | framework route/action handlers with suffixable IDs |
| `stepEnqueued` | API enqueue properties |
| `stepResolved` | async completion properties |
| `stepTransitionId` | focused handler postconditions |
| `stepAny` | global no-forbidden-mutation edge checks |
| `stepChanged` | route/account mutation checks |
| `stepChangedTo` | role/status transition checks |

3. Add these core properties in both framework suites:

- `auth.managerCannotLandOnAdminReturnTo`
- `auth.failedLoginKeepsGuest`
- `auth.loginSettlesWithinTwoEnvironmentSteps`
- `rbac.permissionCacheMatchesCurrentRole`
- `rbac.analystCannotSaveRoleAssignment`
- `rbac.adminCanReachRoleManagement`
- `management.bulkSuspendRequiresAdmin`
- `management.bulkSuspendUsesEnqueuedRiskBucket`
- `management.summaryLoadSettles`
- `management.criticalRevenueRequiresFailedPayments`
- `billing.captureUsesEnqueuedInvoice`
- `billing.paidInvoiceVoidDisabled`
- `billing.requiresActionEventuallySettles`
- `subscription.approvalAppliesRequestedSeats`
- `support.escalationUsesEnqueuedAccount`
- `invoice.retryBudgetNeverExceedsTwo`
- `dashboard.suspendedAccountCheckoutDisabled`
- `approvals.rejectedApprovalCannotApply`
- `audit.exportRequiresAdminPermission`
- `audit.filteredExportNeverIncludesSupportEvents`
- `settings.saveRequiresAdmin`

4. Add `benchmarks/manifest.json`:

```json
{
  "schemaVersion": 1,
  "manifestId": "ledgerops-benchmarks",
  "benchmarks": [
    {
      "id": "ledgerops-react-router",
      "framework": "react-router",
      "root": "benchmarks/react-router",
      "packageJsonPath": "package.json",
      "sourcePaths": ["src/App.tsx", "src/app/router.tsx", "src/routes/login/index.tsx", "src/routes/dashboard/index.tsx", "src/routes/management/index.tsx", "src/routes/management/risk/index.tsx", "src/routes/management/revenue/index.tsx", "src/routes/management/operations/index.tsx", "src/routes/accounts/index.tsx", "src/routes/accounts/$accountId/index.tsx", "src/routes/accounts/$accountId/subscription/index.tsx", "src/routes/accounts/$accountId/billing/index.tsx", "src/routes/accounts/$accountId/payment-methods/index.tsx", "src/routes/accounts/$accountId/invoices/$invoiceId/index.tsx", "src/routes/accounts/$accountId/support/index.tsx", "src/routes/approvals/index.tsx", "src/routes/audit/index.tsx", "src/routes/settings/index.tsx", "src/routes/settings/rbac/index.tsx"],
      "propsPaths": ["src/routes/login/index.props.ts", "src/routes/dashboard/index.props.ts", "src/routes/management/index.props.ts", "src/routes/management/risk/index.props.ts", "src/routes/management/revenue/index.props.ts", "src/routes/management/operations/index.props.ts", "src/routes/accounts/index.props.ts", "src/routes/accounts/$accountId/index.props.ts", "src/routes/accounts/$accountId/subscription/index.props.ts", "src/routes/accounts/$accountId/billing/index.props.ts", "src/routes/accounts/$accountId/payment-methods/index.props.ts", "src/routes/accounts/$accountId/invoices/$invoiceId/index.props.ts", "src/routes/accounts/$accountId/support/index.props.ts", "src/routes/approvals/index.props.ts", "src/routes/audit/index.props.ts", "src/routes/settings/index.props.ts", "src/routes/settings/rbac/index.props.ts"],
      "effectApis": ["api.login", "api.refreshSession", "api.loadDashboardSummary", "api.loadAccount", "api.loadManagementSummary", "api.bulkSuspendAccounts", "api.requestApproval", "api.applyApproval", "api.createPaymentIntent", "api.capturePayment", "api.retryInvoice", "api.savePaymentMethod", "api.openSupportEscalation", "api.exportAudit", "api.saveSettings", "api.saveRoleAssignment"],
      "expected": {
        "truePositiveViolations": 7,
        "trueNegativeVerified": 7,
        "falsePositiveProbes": 3,
        "falseNegativeProbes": 3
      }
    },
    {
      "id": "ledgerops-nextjs",
      "framework": "nextjs",
      "root": "benchmarks/nextjs",
      "packageJsonPath": "package.json",
      "sourcePaths": ["src/app/page.tsx", "src/app/login/page.tsx", "src/app/dashboard/page.tsx", "src/app/management/page.tsx", "src/app/management/risk/page.tsx", "src/app/management/revenue/page.tsx", "src/app/management/operations/page.tsx", "src/app/accounts/page.tsx", "src/app/accounts/[accountId]/page.tsx", "src/app/accounts/[accountId]/subscription/page.tsx", "src/app/accounts/[accountId]/billing/page.tsx", "src/app/accounts/[accountId]/payment-methods/page.tsx", "src/app/accounts/[accountId]/invoices/[invoiceId]/page.tsx", "src/app/accounts/[accountId]/support/page.tsx", "src/app/approvals/page.tsx", "src/app/audit/page.tsx", "src/app/settings/page.tsx", "src/app/settings/rbac/page.tsx"],
      "propsPaths": ["src/app/login/page.props.ts", "src/app/dashboard/page.props.ts", "src/app/management/page.props.ts", "src/app/management/risk/page.props.ts", "src/app/management/revenue/page.props.ts", "src/app/management/operations/page.props.ts", "src/app/accounts/page.props.ts", "src/app/accounts/[accountId]/page.props.ts", "src/app/accounts/[accountId]/subscription/page.props.ts", "src/app/accounts/[accountId]/billing/page.props.ts", "src/app/accounts/[accountId]/payment-methods/page.props.ts", "src/app/accounts/[accountId]/invoices/[invoiceId]/page.props.ts", "src/app/accounts/[accountId]/support/page.props.ts", "src/app/approvals/page.props.ts", "src/app/audit/page.props.ts", "src/app/settings/page.props.ts", "src/app/settings/rbac/page.props.ts"],
      "effectApis": ["api.login", "api.refreshSession", "api.loadDashboardSummary", "api.loadAccount", "api.loadManagementSummary", "api.bulkSuspendAccounts", "api.requestApproval", "api.applyApproval", "api.createPaymentIntent", "api.capturePayment", "api.retryInvoice", "api.savePaymentMethod", "api.openSupportEscalation", "api.exportAudit", "api.saveSettings", "api.saveRoleAssignment"],
      "expected": {
        "truePositiveViolations": 7,
        "trueNegativeVerified": 7,
        "falsePositiveProbes": 3,
        "falseNegativeProbes": 3
      }
    }
  ]
}
```

The implementation may add more Next source paths if extraction misses route files, but it must keep parity expectations identical.

5. Add benchmark runner files:

```text
tools/
  benchmark-ci.ts
  benchmark/
    manifest.ts
    runner.ts
    classify.ts
    report.ts
```

Runner behavior:

- Reads `benchmarks/manifest.json`.
- Runs extract and check for each benchmark through CLI wrappers.
- Writes report JSON with per-framework route counts, vars, transitions, library coverage, property verdicts, TP/TN/FP/FN counts, and artifact paths.
- Fails if a TP property verifies.
- Fails if a TN property violates.
- Fails if any required library has no evidence in app package/dependency facts or extraction report.
- Treats FP probes as accepted only when the manifest marks the property as an FP probe and replay is `not-reproduced` or the runner classifies the violation as model slack.
- Treats FN probes as metadata-only expected gaps and reports them separately.

6. Add root package scripts:

```json
{
  "benchmarks": "tsx tools/benchmark-ci.ts",
  "benchmarks:react-router": "tsx tools/benchmark-ci.ts --id ledgerops-react-router",
  "benchmarks:nextjs": "tsx tools/benchmark-ci.ts --id ledgerops-nextjs"
}
```

7. Add tests:

- `test/benchmarks/property-api-coverage.test.ts`
  - parses props files and reports missing APIs from the table above
- `test/benchmarks/manifest.test.ts`
  - validates ids, paths, effect APIs, expected counts, mixed library allocation requirements, and seeded outcome references
- `test/benchmarks/ledgerops-benchmark.test.ts`
  - runs the runner on both apps with bounded search limits
  - checks all 17 routes exist for both frameworks
  - checks all five supported libraries are present in both apps and assigned to the planned pages/domains rather than every page
  - checks expected classification counts
  - checks RBAC and management properties exist and have expected outcomes

8. Add `.github/workflows/benchmarks.yml`:

```yaml
name: Benchmarks

on:
  push:
    branches:
      - main
  pull_request:
  workflow_dispatch:

jobs:
  ledgerops:
    name: LedgerOps benchmark
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.12.4
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Typecheck
        run: pnpm typecheck
      - name: Benchmarks
        run: pnpm benchmarks -- --report .modality/benchmarks/report.json
      - name: Upload benchmark report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: ledgerops-benchmark-report
          path: .modality/benchmarks/
```

9. Add docs:

- `benchmarks/README.md`
  - app purpose
  - DDD structure
  - page matrix summary
  - supported library coverage
  - seeded outcome classification
  - commands
- `docs/guides/ci-integration.md`
  - one short section naming `pnpm benchmarks` and the separate workflow

## 6. Tests to Add or Update

- `test/benchmarks/property-api-coverage.test.ts`
- `test/benchmarks/manifest.test.ts`
- `test/benchmarks/ledgerops-benchmark.test.ts`
- Optional focused framework tests from plans 07 and 08 if the combined benchmark test becomes too slow.

## 7. Verification

- `rtk pnpm test -- test/benchmarks/property-api-coverage.test.ts`
- `rtk pnpm test -- test/benchmarks/manifest.test.ts`
- `rtk pnpm test -- test/benchmarks/ledgerops-benchmark.test.ts`
- `rtk pnpm benchmarks`
- `rtk pnpm typecheck`
- `rtk pnpm architecture`
- `rtk pnpm test`
- `rtk pnpm ci:examples`
- `rtk pnpm phase7`
- `rtk pnpm fix`

## 8. Acceptance Criteria

- Props files exist for both apps and use every public Property API helper in the coverage table.
- Benchmark manifest has two active entries with identical effect APIs, expected counts, and seeded outcome ids.
- Runner emits a structured report and exits non-zero on classification drift.
- Tests verify all routes, all five supported libraries, RBAC properties, management dashboard properties, and TP/TN/FP/FN counts.
- GitHub Actions workflow runs `pnpm benchmarks`.

## 9. Risks, Ambiguities, and Stop Conditions

- Stop and report if replay support cannot distinguish accepted FP probes from real reproduced failures; keep FP reporting but avoid making replay classification authoritative until support exists.
- Stop and report if full benchmark check exceeds CI budget; add search limits to manifest and report `verified-within-bounds` for TN properties where appropriate.
- Stop and report if property handle imports require generated files that repo policy excludes; use stable `s(component, idOverride)` and `variable(id)` handles.
