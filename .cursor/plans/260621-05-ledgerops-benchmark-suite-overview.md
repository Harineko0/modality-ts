# LedgerOps Benchmark Suite Overview

## 1. Goal

Add a benchmark suite under `benchmarks/` with the same LedgerOps business application implemented twice:

- `benchmarks/react-router/`
- `benchmarks/nextjs/`

LedgerOps is a B2B subscription operations console with authentication, authorization/RBAC, management dashboards, account management, billing, payment processing, approvals, support escalation, audit export, and settings. Both apps must use every currently supported third-party integration surface across the app:

- Jotai for session, RBAC, selected account, and cross-page UI atoms.
- Zustand for workflow stores and complex local-business state machines.
- SWR for read-model caches and async list/detail resources.
- Zod for form/input/API payload schemas.
- ArkType for domain-level finite business constraints and fixtures.

The benchmark must classify true positives, true negatives, false positives, and false negatives against a machine-readable expected-outcome ledger.

This plan set is split as:

- `260621-05-ledgerops-benchmark-suite-overview.md`: suite-level scope and sequencing.
- `260621-06-ledgerops-shared-domain-and-page-spec.md`: shared DDD structure, page specs, fake infra, library usage, and seeded-bug ledger.
- `260621-07-ledgerops-react-router-app.md`: React Router app implementation.
- `260621-08-ledgerops-nextjs-app.md`: Next.js app implementation.
- `260621-09-ledgerops-props-runner-and-workflow.md`: props files, benchmark runner, tests, docs, and GitHub Actions workflow.

## 2. Non-goals

- Do not change checker or extractor semantics to force benchmark outcomes.
- Do not add generated build output, `.next/`, `dist/`, coverage output, or local env files.
- Do not allow the React Router and Next.js apps to drift in business rules, seeded bugs, state names, property names, or expected outcomes.
- Do not replace supported library usage with hand-rolled state when the benchmark is intended to exercise Jotai, Zustand, SWR, Zod, and ArkType.
- Do not use real external auth, payment, or analytics providers.
- Do not hide benchmark expectations in prose only; the implementation must include structured metadata.

## 3. Current-State Findings

- The repo is a TypeScript ESM package. Core code is in `src/`, examples in `examples/`, canary tooling in `tools/canary/`, and CI in `.github/workflows/`.
- Existing example fixtures use local app folders with `package.json`, `App.tsx`, generated-handle imports or stable variable ids, and `app.props.ts`.
- Existing canary runner code invokes public CLI wrappers from `src/cli/*` and does not import private adapter internals.
- Built-in source support already includes React Router/React Router DOM, Next, Jotai, Zustand, SWR, Zod, and ArkType through package detection and exported adapters/type-library support.
- Property authoring helpers live in `modality-ts/properties`; stable system vars live in `modality-ts/vars`.
- The existing workflow pattern uses Node 24 and pnpm 10.12.4.

## 4. Existing Patterns to Follow

- Keep benchmark apps realistic but finite: use enumerated buckets instead of unbounded records, strings, or lists.
- Keep shared pure business facts in `benchmarks/shared/`; keep extractable React state and event handlers in each framework app.
- Use fake infra modules for auth/payment/API behavior, with effect API names passed into extraction.
- Use the canary runner boundary: orchestrate through CLI wrappers and report structured artifacts.
- Keep the route and page inventory identical across frameworks.
- Treat RBAC as a domain invariant and an operation guard, not only a navigation redirect.

## 5. Atomic Implementation Steps

1. Land the shared LedgerOps specification from plan 06.
2. Implement `benchmarks/react-router/` from plan 07.
3. Implement `benchmarks/nextjs/` from plan 08.
4. Implement benchmark props, runner, tests, docs, and workflow from plan 09.
5. Run focused extraction after each app reaches a vertical slice: login, dashboard, one account detail page, billing payment flow, RBAC settings, management bulk action.
6. Keep app parity with a shared manifest. Any route, operation, property, or seeded-bug id present in one framework must be present in the other unless `benchmarks/manifest.json` contains a documented framework-specific caveat.

## 6. Tests to Add or Update

- Add tests listed in plan 09:
  - `test/benchmarks/property-api-coverage.test.ts`
  - `test/benchmarks/ledgerops-benchmark.test.ts`
  - `test/benchmarks/manifest.test.ts`
- Update registry tests only if dependency detection for benchmark package shapes fails.
- Update docs tests or snapshots only if docs infrastructure requires it.

## 7. Verification

Run from the repo root:

- `rtk pnpm test -- test/benchmarks`
- `rtk pnpm benchmarks`
- `rtk pnpm typecheck`
- `rtk pnpm architecture`
- `rtk pnpm test`
- `rtk pnpm ci:examples`
- `rtk pnpm phase7`
- `rtk pnpm fix`

## 8. Acceptance Criteria

- Both benchmark apps exist and implement the same LedgerOps app.
- Both apps use Jotai, Zustand, SWR, Zod, and ArkType in extractable app code.
- Both apps implement all pages in the shared page matrix from plan 06.
- Both apps use the same fake infra operations and seeded-bug ledger.
- The benchmark runner reports TP/TN/FP/FN classification counts for both frameworks.
- A separate GitHub Actions benchmark workflow runs the benchmark command.

## 9. Risks, Ambiguities, and Stop Conditions

- Stop and report if installing all five library families in benchmark package manifests requires a root workspace/package-manager restructuring larger than the benchmark scope.
- Stop and report if shared helper extraction drops route or handler coverage below benchmark thresholds; duplicate small framework handlers instead of hiding interactions.
- Stop and report if the state space becomes intractable; reduce domain cardinality while preserving every screen, library, and workflow class.
- Stop and report if a seeded bug becomes obvious from UI text or comments. The bug ledger may name the issue; app source should look like ordinary business code.
