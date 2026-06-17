# Conformance and Canary Infrastructure Split Index

Status: split index.
Date: 2026-06-17.
Plan families: F - Conformance Matrix, G - Real-App Canary Suite.

The original monolithic conformance/canary infrastructure plan has been split
into the following implementation-sized plans. Implement them in numeric order.

- `260617-22-1-report-and-manifest-foundation.md`
  - Adds schema-versioned report types, artifact parsers, manifest validation
    boundaries, the first conformance matrix manifest, and conform fixture
    context metadata.
- `260617-22-2-canonical-conformance-fixtures-and-runner.md`
  - Adds canonical fixture conventions, initial semantic fixtures, and the
    manifest-driven `ci:conformance` runner.
- `260617-22-3-real-app-canary-manifest-and-runner.md`
  - Adds the real-app canary manifest, canary runner, `ci:canaries`, and
    migrates `ci:examples` onto manifest data while preserving demo-app
    acceptance behavior.
- `260617-22-4-threshold-budget-and-classification-gates.md`
  - Centralizes coverage, caveat, state-space budget, threshold, and deterministic
    failure-classification gates for both runner families.
- `260617-22-5-cli-docs-architecture-and-cleanup.md`
  - Adds optional user-facing CLI wrappers only if justified, updates docs/specs,
    tightens architecture tests, and removes obsolete hard-coded example paths.

Global constraints for every child plan:

- Do not implement new React, Next, React Router, Jotai, SWR, Zustand, Zod,
  ArkType, XState, or cache semantics.
- Do not make real apps the source of truth for semantics. Canonical fixtures
  own semantic claims; real apps are canaries.
- Do not commit generated `.modality/`, `dist/`, trace, report, or replay-test
  artifacts.
- Do not edit `.cursor/plans/260617-18-versatility-plan-of-plans.md` or other
  unrelated worker plan files.
- Use `rtk` for repository commands.
