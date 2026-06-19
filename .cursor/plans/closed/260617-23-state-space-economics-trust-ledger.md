# State-Space Economics and Trust Ledger

Status: implementation plan.
Date: 2026-06-17.
Plan families:

- H — State-Space Economics
- I — Trust Ledger and Documentation

## 1. Goal

Make `modality-ts` scale by default without hiding approximation.

This plan connects the checker's property-focused state-space reductions with
the extractor and report trust ledger so every reduction, bound, caveat, and
confidence downgrade is structured, inspectable, and documented.

The intended end state is:

- property-focused slicing works from structured read/write dependency data,
  not broad property-kind exceptions;
- read/write dependency tracking records path-level and effect-level
  contributors where the IR can express them;
- pending queues, route state, mount scopes, and record fields are pruned from
  unrelated property slices;
- extraction and check reports show top contributors for the full model and for
  each property slice;
- every precision bound or approximation is emitted as a structured caveat,
  including model-slack caveats for pruning, pending queue caps, field pruning,
  and route/mount-scope pruning;
- report confidence is visible per property, not only as global warning text;
- docs and internal specs are updated in the same implementation;
- production code does not parse warning strings such as
  `"Unextractable handler ..."` or `"Global taint ..."` to recover structured
  report data.

## 2. Non-goals

- Do not add new framework or library adapters.
- Do not preserve old warning-string parsing paths for compatibility. Delete
  them once structured caveats cover the source.
- Do not add heuristic search or randomized exploration.
- Do not make AI-assisted pruning, AI-authored proofs, or AI confidence part of
  verification.
- Do not weaken the Rust checker's well-formedness validation.
- Do not change generated `dist/` artifacts.
- Do not edit `.cursor/plans/260617-18-versatility-plan-of-plans.md` or other
  worker plan files.

## 3. Current-State Findings

- `src/check/slicing/slice-model.ts` already implements per-property slicing.
  `sliceModelForProperty()` computes a backwards write/read closure from
  `property.reads`, `enabledTransitionVars()`, transition `reads`, and
  transition `writes`. `sliceModelForTargetedStepProperty()` handles only a
  narrow negated `alwaysStep` shape with a literal target transition.
- `propertySliceMode()` currently returns `"full"` for all `leadsToWithin`
  properties and for non-targeted `alwaysStep` properties, even when their
  trigger/goal/predicate dependencies are structurally readable.
- `addRouteVarsForNeededRouteLocals()` already adds `sys:route` for
  `route-local` vars and mount guard reads for `mount-local` vars, but slicing
  does not yet report why those vars were retained or whether route/mount vars
  were pruned.
- `src/check/check-model.ts` groups identical slices and emits
  `SliceSummary` diagnostics with counts for vars, transitions, states, edges,
  depth, and mode. It does not include slice contributor lists, dropped
  contributor lists, confidence impact, or caveats.
- `src/check/types.ts` has `CheckDiagnostics.dominantVars`, `SliceSummary`,
  `CheckResult.boundHits`, and search/storage/hot-path diagnostics. It does not
  have a first-class per-property confidence or model-slack diagnostics shape.
- `src/cli/features/check/command.ts` writes `CheckReport.trustLedger` from
  model metadata and check results. It includes bounds, plugins, assumptions,
  abstractions, typed caveat partitions, domains, manual/over-approx
  transitions, bound hits, ignored vars, and numeric reductions.
- `createCheckReport()` downgrades property verdicts only for numeric
  reductions through `reportVerdict()` and
  `downgradeVerdictForReductions()`. Non-numeric model slack does not yet
  affect per-property confidence.
- `collectCheckNumericReductions()` computes dropped numeric reductions with
  `sliceModelForProperty()`, but that helper is not aware of `leadsToWithin`,
  targeted step slices, route pruning, field pruning, or pending queue pruning.
- `src/cli/features/extract/command.ts` already builds
  `ExtractionReport.stateContributors` using `buildStateContributors()`.
  Contributors are full-model var-level estimates only: `domainCardinality()`,
  `Math.log2(cardinality)`, `scope`, and `origin`.
- Extraction CLI output already prints
  `state-space≈<bits>bits top:<var>(<bits>)` and `coarse-domains=...`.
  Check CLI output prints `slicing=...`, `search-limit=...`, and storage/hot
  path diagnostics.
- `src/core/report/types.ts` defines `StateSpaceContributor`,
  `StateSpaceContributors`, `ExtractionReport.stateContributors`,
  `CheckReportDiagnostics`, and `ReportTrustLedger`, but check reports do not
  yet expose state-space contributors or model-slack caveats.
- `src/extract/engine/ts/caveats.ts` provides structured caveat constructors
  for `global-taint`, `stale-read`, `unhandled-rejection`, `unextractable`, and
  `model-slack`. `partitionCaveats()` ignores `model-slack` instead of
  exposing it in report trust ledgers.
- `src/cli/features/extract/command.ts` still contains
  `unextractableHandlerFromWarning()`, which parses warning text with regexes
  to recover unextractable handler IDs/reasons. This violates the plan family
  requirement that reports not parse warning strings.
- `src/extract/engine/pipeline/index.ts` still contains
  `pluginSafetyWarning()`, which parses the `"Global taint "` prefix to create
  a structured caveat after the fact. This should move to structured caveats at
  the source of imprecision.
- `src/extract/sources/next/routes.ts`, `src/extract/sources/next/cache.ts`,
  `src/extract/sources/next/config.ts`, Jotai, and Zustand sources still return
  several plain string warnings. Some should become typed `model-slack`,
  `global-taint`, or future structured caveat entries.
- `src/core/artifacts/index.ts` validates the presence of typed caveat buckets
  in check/extraction reports but does not validate `modelSlack`,
  per-property confidence, or state-space contributor diagnostics in check
  reports.
- Docs already describe the intended direction:
  - `docs/concepts/state-space-control.md` documents sound reductions,
    per-property slicing, explicit bounds, numeric reductions, and claim
    downgrades.
  - `docs/reference/schemas.md` documents report schemas and typed
    extraction caveats.
  - `docs/_specs/01-ir.md`, `docs/_specs/02-extraction.md`, and
    `docs/_specs/03-checker.md` describe field pruning, pending queue bounds,
    slicing, trust ledger, and diagnostics.
  Implementation should catch up to these docs and then update docs/specs for
  any schema changes.

## 4. Exact File Paths and Relevant Symbols

Primary state-space files:

- `src/check/slicing/slice-model.ts`
  - `PropertySliceMode`
  - `sliceModel()`
  - `targetedAlwaysStepTransitionIds()`
  - `propertySliceMode()`
  - `sliceModelForCheckProperty()`
  - `sliceModelForProperty()`
  - `sliceModelForTargetedStepProperty()`
  - `stepFactVars()`
  - `addRouteVarsForNeededRouteLocals()`
  - `enabledTransitionVars()`
  - `canSliceProperty()`
- `src/check/check-model.ts`
  - `checkModel()`
  - `buildSlicingRequestDiagnostics()`
  - `checkModelSliced()`
  - `mergeSearchDiagnostics()`
  - `mergeDominantVars()`
- `src/check/types.ts`
  - `SliceSummary`
  - `CheckDiagnostics`
  - `CheckResult`
  - `CheckOptions`
- `src/core/ir/types.ts`
  - `Transition.reads`
  - `Transition.writes`
  - `Transition.confidence`
  - `ExtractionCaveat`
  - `ExtractionCaveats`
  - `NumericReduction`
  - `Model.metadata`
  - `Property`
  - `StepPredicateIR`
- `src/core/ir/eval.ts`
  - expression read/evaluation helpers used for structured read extraction
- `src/core/ir/domains.ts`
  - `domainCardinality()`
  - `collectTokenDomainPaths()`
  - wide-domain helpers
- `src/core/ir/validator.ts`
  - footprint validation for `reads` and `writes`

Primary report/trust-ledger files:

- `src/core/report/types.ts`
  - `ReportTrustLedger`
  - `CheckReportDiagnostics`
  - `CheckReport`
  - `ExtractionReport`
  - `StateSpaceContributor`
  - `StateSpaceContributors`
- `src/core/artifacts/index.ts`
  - `parseCheckReportArtifact()`
  - `parseExtractionReportArtifact()`
- `src/cli/features/extract/command.ts`
  - `runExtractCommand()`
  - `createExtractionCaveats()`
  - `createExtractionReport()`
  - `buildStateContributors()`
  - `wideNumericReachabilityWarnings()`
  - `wideProductDomainReachabilityWarnings()`
  - `dedupeUnextractableHandlers()`
  - `unextractableHandlerFromWarning()`
  - `pendingVars()`
  - `applyMountScopesFromRouter()`
- `src/cli/features/extract/output.ts`
  - `renderHumanExtractTargets()`
- `src/cli/features/check/command.ts`
  - `runCheckCommand()`
  - `createCheckReport()`
  - `collectCheckNumericReductions()`
  - `reportVerdict()`
  - `renderCheckResult()`
- `src/cli/features/check/output.ts`
  - `renderHumanCheckTargets()`
  - `slicingStats()`
  - `formatTargetStats()`
- `src/cli/features/ci/command.ts`
  - trust-ledger diffing helpers for caveats/domains/plugins/bounds
- `src/extract/engine/ts/caveats.ts`
  - `modelSlackCaveat()`
  - `globalTaintCaveat()`
  - `unextractableHandlerCaveat()`
  - `partitionCaveats()`
  - `compareCaveats()`
- `src/extract/engine/ts/types.ts`
  - `ExtractionWarning`
- `src/extract/engine/pipeline/index.ts`
  - `runExtractionPipeline()`
  - `pluginSafetyWarning()`

Source warning/caveat producers to update:

- `src/extract/sources/jotai/writes.ts`
- `src/extract/sources/jotai/discover.ts`
- `src/extract/sources/jotai/hydration.ts`
- `src/extract/sources/jotai/transitions.ts`
- `src/extract/sources/zustand/writes.ts`
- `src/extract/sources/zustand/discover.ts`
- `src/extract/sources/zustand/transitions.ts`
- `src/extract/sources/next/routes.ts`
- `src/extract/sources/next/cache.ts`
- `src/extract/sources/next/config.ts`
- `src/extract/sources/next/server-effects.ts`
- `src/extract/sources/router/server-effects.ts`
- `src/extract/sources/swr/transitions.ts`

Docs/specs to keep synchronized:

- `docs/concepts/state-space-control.md`
- `docs/reference/schemas.md`
- `docs/guides/diagnostics-and-search-limits.md`
- `docs/soundness/trust-ledger.md`
- `docs/soundness/e1-invariant.md`
- `docs/_specs/01-ir.md`
- `docs/_specs/02-extraction.md`
- `docs/_specs/03-checker.md`
- `docs/_specs/04-conformance.md`

Tests to add/update:

- `test/kernel/mounted-scope.test.ts`
- `test/kernel/kernel.test.ts`
- `test/checker/checker.test.ts`
- `src/cli/features/check/command.test.ts`
- `src/cli/features/extract/command.test.ts`
- `src/cli/features/ci/command.test.ts`
- `test/kernel/artifacts.test.ts`
- focused source tests under `test/sources/*` and `src/extract/sources/*/*.test.ts`

## 5. Existing Patterns to Follow

- Keep IR and artifact schema types in `src/core/**`; CLI command modules should
  assemble reports from these types, not create private ad hoc shapes.
- Keep slicing logic under `src/check/slicing/` and use structured
  `Property`, `StepPredicateIR`, `ExprIR`, transition `reads`, and transition
  `writes`.
- Keep state-space bits based on `domainCardinality()` so full-model and
  per-slice contributor reports use one definition.
- Keep extraction imprecision represented as `ExtractionCaveat` in
  `Model.metadata.extractionCaveats`.
- Keep numeric reduction confidence through `NumericReduction.claim` and reuse
  the existing downgrade mechanism for analogous model-slack confidence.
- Keep docs and internal specs in lockstep with schema changes.
- Prefer additive schema fields on schema version 1 only when old fields are not
  semantically wrong. Because backward compatibility is not a constraint,
  remove misleading fields or parsers instead of preserving them.

## 6. Atomic Implementation Steps

### Step 1 — Add a structured state-space economics module

Files to edit:

- `src/check/slicing/slice-model.ts`
- `src/check/types.ts`
- `src/core/report/types.ts`
- `src/cli/features/extract/command.ts`
- new file if useful: `src/check/slicing/contributors.ts`

Implementation:

1. Extract the contributor logic from
   `src/cli/features/extract/command.ts#buildStateContributors` into a shared
   module that can compute contributors for any `Model`.
2. Keep the same public math initially:
   - `bits = log2(domainCardinality(domain))`, rounded consistently;
   - contributor fields include `varId`, `domainKind`, `bits`, `scope`,
     `origin`.
3. Add a helper such as `compareModelEconomics(full, slice)` that returns:
   - full contributors;
   - retained contributors;
   - pruned contributors;
   - retained bits;
   - pruned bits;
   - route/system/pending/mount buckets.
4. Extend `SliceSummary` with optional fields:
   - `retainedBits`;
   - `prunedBits`;
   - `topContributors`;
   - `prunedTopContributors`;
   - `retainedSystemVars`;
   - `prunedSystemVars`.
5. Use this helper in `checkModelSliced()` for every grouped slice.
6. Keep extraction reports using the same helper, so extraction and check
   reports do not drift.

Acceptance criteria:

- Extraction report `stateContributors` remains stable except for canonical
  ordering if needed.
- Check slicing diagnostics include per-slice contributors.
- Contributor code is not duplicated between extraction and check paths.

### Step 2 — Generalize property read/dependency extraction

Files to edit:

- `src/check/slicing/slice-model.ts`
- `src/core/ir/types.ts` only if a new internal helper type belongs there
- `test/kernel/kernel.test.ts`
- `test/checker/checker.test.ts`

Implementation:

1. Add a structured helper such as `propertyDependencyRequest(property)` that
   returns:
   - `stateReads`;
   - `stepFactVars`;
   - `enabledTransitions`;
   - `targetTransitionIds`;
   - `modeHint`.
2. Populate it by walking the actual property shape:
   - `always` / `reachable`: `property.reads` plus `exprReads(predicate)`;
   - `reachableFrom`: `property.reads` plus `exprReads(when)` and
     `exprReads(goal)`;
   - `leadsToWithin`: `property.reads`, `exprReads(goal)`, trigger step vars,
     and trigger transition vars if the trigger names a transition;
   - `alwaysStep`: `property.reads`, composite `pre` / `post` expression reads,
     step fact vars, and target transition vars when present.
3. Keep explicit `property.reads` as an override/addition, not as the only
   source of truth. This should reduce "property missing reads" skip cases when
   the property was built from serializable IR.
4. Make `buildSlicingRequestDiagnostics()` report missing reads only when a
   property has function predicates or opaque shapes that cannot be walked.
5. Update property API tests that currently depend on manual `reads` to assert
   inferred read metadata where possible.

Acceptance criteria:

- Serializable IR properties can slice even when callers omit explicit
  `reads`.
- `leadsToWithin` properties with structured goal and transition trigger no
  longer force full-model search solely because of their kind.
- Function-based/opaque predicates remain unsliceable and get an explicit skip
  reason.

### Step 3 — Make route and mount-scope pruning explainable

Files to edit:

- `src/check/slicing/slice-model.ts`
- `src/check/types.ts`
- `src/core/report/types.ts`
- `test/kernel/mounted-scope.test.ts`
- `src/cli/features/check/command.test.ts`

Implementation:

1. Track why `addRouteVarsForNeededRouteLocals()` retains each route/mount
   dependency:
   - `route-local` var needs `sys:route`;
   - `mount-local` var needs every var read by `scope.when`.
2. Include those reasons in slice diagnostics under a structured field such as
   `mountScopeDependencies`.
3. Add pruned route/mount-scope contributors to the per-slice contributor
   summary.
4. Treat route/mount pruning as sound when the pruned vars do not influence
   property dependencies through transition read/write closure.
5. Emit a `model-slack` caveat only when route/mount pruning is bounded or
   approximate, for example an ambiguous mount scope that fell back to
   `route-local` earlier in extraction.

Acceptance criteria:

- A property reading a mount-local var keeps only the mount guard dependency
  vars needed for that var.
- A property unrelated to route-local vars can prune `sys:route` and
  `sys:history` when no retained transition requires them.
- Check report diagnostics explain retained route/mount dependencies.

### Step 4 — Add pending queue slicing and bound diagnostics

Files to edit:

- `src/check/slicing/slice-model.ts`
- `src/check/types.ts`
- `src/cli/features/extract/command.ts`
- `src/cli/features/check/command.ts`
- `src/cli/features/check/output.ts`
- `test/checker/checker.test.ts`
- `src/cli/features/check/command.test.ts`

Implementation:

1. Add a helper that detects which pending-op facts a property or transition
   actually uses:
   - `enqueued`;
   - `resolved`;
   - `opId`;
   - `continuation`;
   - `opArgs`;
   - explicit `read("sys:pending", path)`.
2. Retain `sys:pending` only when a property/transition dependency requires
   pending queue facts or an effect `enqueue`/`dequeue` participates in the
   backward dependency closure.
3. Extend diagnostics to explain `sys:pending` retention with the op IDs and
   continuations involved when statically visible.
4. Add model-slack caveats for pending queue caps that influence the model:
   - `sys:pending.maxLen` greater than zero is a declared bound;
   - a bound hit during checking remains `CheckResult.boundHits`;
   - extraction report should list the bound as an assumption, while check
     report should list actual bound hits.
5. Do not create op-specific `sys:pending` vars in this plan unless necessary.
   First make the existing bounded-list var disappear from unrelated slices.

Acceptance criteria:

- Properties unrelated to async operations can slice away `sys:pending`.
- Properties that mention `opId`/`resolved` retain `sys:pending` and report why.
- Check reports distinguish configured pending bounds from actual bound hits.

### Step 5 — Implement property-focused field pruning metadata

Files to edit:

- `src/core/ir/types.ts`
- `src/core/report/types.ts`
- `src/extract/engine/ts/type-domains.ts`
- `src/extract/engine/ts/domains.ts`
- `src/extract/engine/ts/transition/expressions.ts`
- `src/extract/engine/ts/transition/statement-summary.ts`
- `src/cli/features/extract/command.ts`
- `src/cli/features/check/command.ts`
- tests under `test/extract/`, `src/cli/features/extract/command.test.ts`,
  and `src/cli/features/check/command.test.ts`

Implementation:

1. Add structured metadata for field pruning to model metadata, for example:
   - `fieldPruning.entries[]`;
   - `varId`;
   - `keptPaths`;
   - `prunedPaths`;
   - `reason: "unread" | "property-unrelated" | "bounded-record"`;
   - `source?`;
   - `confidence: "exact" | "over-approx"`.
2. During extraction, record field paths read by guards, effects, derived
   values, pending args, and route/mount guards. Use existing `ExprIR.read.path`
   where possible.
3. Keep current full-record domain behavior at first if replacing domain shapes
   is too large; this step's minimum deliverable is trustworthy metadata and
   caveats. If implementation can safely prune domain fields in the same
   change, do it through the shared domain mapper and tests.
4. When field pruning collapses a path into token identity or omits it from a
   property slice, emit a `model-slack` caveat with the affected var/path.
5. Extend property-slice contributor reports to show pruned record-field paths
   separately from whole-var pruning.

Acceptance criteria:

- Extraction reports identify kept and pruned record paths for at least one
  nested object fixture.
- A property reading `session.user.id` keeps that path and can prune unrelated
  fields such as `session.user.avatarUrl`.
- Any field collapse that can create spurious behavior is represented as a
  structured `model-slack` caveat.

### Step 6 — Make model-slack caveats first-class in reports

Files to edit:

- `src/core/ir/types.ts`
- `src/core/report/types.ts`
- `src/core/artifacts/index.ts`
- `src/extract/engine/ts/caveats.ts`
- `src/cli/features/extract/command.ts`
- `src/cli/features/check/command.ts`
- `src/cli/features/ci/command.ts`
- `test/kernel/artifacts.test.ts`
- `src/cli/features/check/command.test.ts`
- `src/cli/features/extract/command.test.ts`
- `src/cli/features/ci/command.test.ts`

Implementation:

1. Extend `partitionCaveats()` to return `modelSlack`.
2. Add `modelSlack` to:
   - `ReportTrustLedger`;
   - `ExtractionReport`;
   - check report artifact validation;
   - extraction report artifact validation.
3. Include model-slack caveats from `Model.metadata.extractionCaveats` in
   `createExtractionReport()` and `createCheckReport()`.
4. Update CI trust-ledger diffing to compare model-slack caveats just like
   global taints, stale reads, unhandled rejections, and unextractable handlers.
5. Keep `warnings: string[]` as human text only. CI and reports must not need to
   parse it for caveat identity.

Acceptance criteria:

- Reports have a typed `modelSlack` bucket.
- CI can detect added/removed model-slack caveats.
- Existing model-slack caveats from wide numeric/product domains are visible in
  both extraction and check reports.

### Step 7 — Replace regex-parsed warnings with source-created caveats

Files to edit:

- `src/extract/engine/ts/types.ts`
- `src/extract/engine/ts/caveats.ts`
- `src/extract/engine/pipeline/index.ts`
- `src/cli/features/extract/command.ts`
- source warning files listed in section 4
- `test/extraction/architecture.test.ts`
- focused source tests

Implementation:

1. Make warning-producing APIs return `ExtractionWarning` with a `caveat` when
   the warning describes extraction imprecision, taint, unextractability, or
   model slack.
2. Delete `pluginSafetyWarning()` from
   `src/extract/engine/pipeline/index.ts`. Source plugins should call
   `globalTaintCaveat()` or another constructor directly.
3. Delete `unextractableHandlerFromWarning()` from
   `src/cli/features/extract/command.ts`.
4. Change `dedupeUnextractableHandlers()` to consume only
   `warning.caveat?.kind === "unextractable"`.
5. Add architecture tests that fail on production regex parsing of warning
   strings. Suggested search terms:
   - `Unextractable handler`;
   - `Global taint `;
   - `startsWith("Global taint`;
   - regexes over `warning` in report-building files.
6. Keep plain string warnings only for purely informational messages that do
   not affect trust, confidence, or coverage.

Acceptance criteria:

- No production code parses warning strings to build caveats or report
  identities.
- Every unextractable handler in extraction reports comes from a structured
  `unextractable` caveat.
- Every global taint in reports comes from a structured `global-taint` caveat.

### Step 8 — Add property confidence reporting

Files to edit:

- `src/core/report/types.ts`
- `src/check/types.ts`
- `src/check/check-model.ts`
- `src/cli/features/check/command.ts`
- `src/cli/features/check/output.ts`
- `src/cli/features/check/command.test.ts`
- `docs/reference/schemas.md`

Implementation:

1. Add a property-level confidence shape, for example:
   - `confidence: "exact" | "over-approx" | "manual" | "bounded"`;
   - `reasons: string[]`;
   - `caveatIds: string[]`;
   - `affectedTransitions: string[]`;
   - `affectedVars: string[]`.
2. Compute it from the property slice:
   - retained `over-approx` transitions;
   - retained `manual` transitions;
   - relevant `modelSlack` caveats;
   - relevant numeric reductions;
   - actual bound hits;
   - search limit diagnostics.
3. Include confidence on each `ReportPropertyVerdict`.
4. Update human output to show compact confidence only when it is not exact,
   for example `confidence=over-approx reasons:2`.
5. Ensure a verified property with relevant heuristic/model-slack reductions is
   visibly downgraded or annotated. Do not report a plain
   `verified-within-bounds` claim when the proof depends on heuristic
   reductions.

Acceptance criteria:

- Check report verdicts carry confidence metadata.
- Exact properties remain uncluttered in human output.
- Properties affected by model slack, numeric reductions, manual transitions,
  over-approx transitions, or bound hits are visibly annotated.

### Step 9 — Update docs and internal specs with schema and behavior changes

Files to edit:

- `docs/concepts/state-space-control.md`
- `docs/reference/schemas.md`
- `docs/guides/diagnostics-and-search-limits.md`
- `docs/soundness/trust-ledger.md`
- `docs/soundness/e1-invariant.md`
- `docs/_specs/01-ir.md`
- `docs/_specs/02-extraction.md`
- `docs/_specs/03-checker.md`
- `docs/_specs/04-conformance.md`

Implementation:

1. Document contributor reports for extraction and check reports.
2. Document per-slice retained/pruned bits, top contributors, route/mount
   retention reasons, and pending queue retention reasons.
3. Update schema docs for:
   - `modelSlack`;
   - property confidence;
   - extended slicing diagnostics;
   - field-pruning metadata, if added to model metadata.
4. Update trust-ledger docs so model slack is a typed bucket, not a generic
   warning.
5. Update E1 docs to state that warning strings are human text only and caveats
   must be structured at creation.
6. Update conformance docs to say real-app canaries should compare contributor
   budgets and accepted caveats, not only pass/fail behavior.

Acceptance criteria:

- Docs describe the current implemented schema exactly.
- Internal specs and user-facing docs agree on caveat buckets and confidence
  semantics.
- No docs claim unsupported behavior is unsupported after this plan models it.

### Step 10 — Add focused economics and trust-ledger conformance fixtures

Files to edit:

- `test/checker/checker.test.ts`
- `test/kernel/mounted-scope.test.ts`
- `src/cli/features/check/command.test.ts`
- `src/cli/features/extract/command.test.ts`
- `src/cli/features/ci/command.test.ts`
- `test/kernel/artifacts.test.ts`
- focused source tests under `test/sources/*`

Implementation:

Add fixtures for:

1. Property unrelated to async state slices away `sys:pending`.
2. Property with `resolved` or `opId` retains `sys:pending` and reports why.
3. Property unrelated to route-local state slices away route/history vars.
4. Property reading mount-local state retains only mount guard dependencies.
5. Full model reports top state-space contributors by var and by source.
6. Per-slice report shows retained and pruned top contributors.
7. Wide product/numeric domains produce typed model-slack caveats in extraction
   and check reports.
8. Unextractable handler report entries are produced without regex parsing
   warning strings.
9. CI detects changes in `modelSlack`.
10. Property confidence downgrades/annotates results affected by over-approx
    transitions, manual transitions, model slack, numeric reductions, or bound
    hits.

Acceptance criteria:

- Tests prove each new report field from this plan.
- Tests prove no state-space contributor feature depends on a whole real app.
- Tests fail if warning-string parsing is reintroduced for trust data.

## 7. Per-Step Files to Edit

- Step 1:
  - `src/check/slicing/slice-model.ts`
  - `src/check/types.ts`
  - `src/core/report/types.ts`
  - `src/cli/features/extract/command.ts`
  - optional `src/check/slicing/contributors.ts`
- Step 2:
  - `src/check/slicing/slice-model.ts`
  - `test/kernel/kernel.test.ts`
  - `test/checker/checker.test.ts`
- Step 3:
  - `src/check/slicing/slice-model.ts`
  - `src/check/types.ts`
  - `src/core/report/types.ts`
  - `test/kernel/mounted-scope.test.ts`
  - `src/cli/features/check/command.test.ts`
- Step 4:
  - `src/check/slicing/slice-model.ts`
  - `src/check/types.ts`
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/check/command.ts`
  - `src/cli/features/check/output.ts`
  - `test/checker/checker.test.ts`
  - `src/cli/features/check/command.test.ts`
- Step 5:
  - `src/core/ir/types.ts`
  - `src/core/report/types.ts`
  - `src/extract/engine/ts/type-domains.ts`
  - `src/extract/engine/ts/domains.ts`
  - `src/extract/engine/ts/transition/expressions.ts`
  - `src/extract/engine/ts/transition/statement-summary.ts`
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/check/command.ts`
- Step 6:
  - `src/core/ir/types.ts`
  - `src/core/report/types.ts`
  - `src/core/artifacts/index.ts`
  - `src/extract/engine/ts/caveats.ts`
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/check/command.ts`
  - `src/cli/features/ci/command.ts`
- Step 7:
  - `src/extract/engine/ts/types.ts`
  - `src/extract/engine/ts/caveats.ts`
  - `src/extract/engine/pipeline/index.ts`
  - `src/cli/features/extract/command.ts`
  - source warning/caveat producer files listed in section 4
  - `test/extraction/architecture.test.ts`
- Step 8:
  - `src/core/report/types.ts`
  - `src/check/types.ts`
  - `src/check/check-model.ts`
  - `src/cli/features/check/command.ts`
  - `src/cli/features/check/output.ts`
  - `src/cli/features/check/command.test.ts`
- Step 9:
  - docs/spec files listed in section 4
- Step 10:
  - focused tests listed in section 6

## 8. Acceptance Criteria

- Property-focused slicing no longer depends solely on explicit
  `property.reads` when serializable predicate IR can be walked.
- `leadsToWithin` and non-targeted `alwaysStep` properties can slice when their
  structured dependencies are known.
- Unrelated properties can prune `sys:pending`, route/history state, mount-scope
  dependencies, and unrelated record fields where sound.
- Extraction reports and check reports both expose state-space contributors
  using one shared contributor implementation.
- Per-slice diagnostics show retained/pruned bits and top contributors.
- Pending queue, route/mount, and field-pruning decisions are explainable in
  diagnostics or trust-ledger caveats.
- `modelSlack` is a first-class typed caveat bucket in extraction reports,
  check reports, artifact parsers, and CI trust-ledger diffing.
- Property verdicts carry confidence metadata when the result depends on
  model slack, numeric reductions, over-approx/manual transitions, or bound
  hits.
- Production report code does not parse warning strings to recover caveats,
  unextractable handlers, or global taints.
- Docs and internal specs match implemented report schemas and confidence
  behavior.

## 9. Tests to Add or Update

Focused tests:

- `test/checker/checker.test.ts`
  - generalized property dependency extraction;
  - `leadsToWithin` slicing;
  - pending queue retained/pruned behavior;
  - property confidence for bound hits.
- `test/kernel/mounted-scope.test.ts`
  - mount-scope dependencies retained only when needed;
  - route/mount pruning appears in slice diagnostics.
- `src/cli/features/check/command.test.ts`
  - check report includes per-slice contributors;
  - trust ledger includes `modelSlack`;
  - property verdicts include confidence metadata;
  - human output shows non-exact confidence compactly.
- `src/cli/features/extract/command.test.ts`
  - extraction report includes full-model contributors from shared helper;
  - model-slack caveats are emitted for wide domains and field pruning;
  - unextractable handlers are reportable without parsing warning text.
- `src/cli/features/ci/command.test.ts`
  - CI detects added/removed model-slack caveats.
- `test/kernel/artifacts.test.ts`
  - artifact parsers validate `modelSlack`, property confidence, and extended
    slicing diagnostics.
- `test/extraction/architecture.test.ts`
  - no production warning-string parsing for trust data.
- Source-specific tests:
  - Jotai/Zustand global taint warnings create `global-taint` caveats at the
    source.
  - Next cache/config approximations create `model-slack` caveats where
    precision is bounded.

Avoid broad real-app snapshots for this plan. Real app canaries may be run
after fixtures pass to compare budgets and caveats.

## 10. Verification Commands

Run targeted tests while implementing:

```bash
rtk pnpm vitest run test/checker/checker.test.ts
rtk pnpm vitest run test/kernel/mounted-scope.test.ts
rtk pnpm vitest run src/cli/features/check/command.test.ts
rtk pnpm vitest run src/cli/features/extract/command.test.ts
rtk pnpm vitest run src/cli/features/ci/command.test.ts
rtk pnpm vitest run test/kernel/artifacts.test.ts
rtk pnpm vitest run test/extraction/architecture.test.ts
```

Run source-specific tests after structured warning/caveat migration:

```bash
rtk pnpm vitest run test/sources/jotai/jotai-source.test.ts
rtk pnpm vitest run test/sources/zustand/zustand-source.test.ts
rtk pnpm vitest run src/extract/sources/next/cache.test.ts
rtk pnpm vitest run src/extract/sources/next/config.test.ts
```

Run broad validation before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm ci:examples
rtk pnpm fix
rtk git diff --check
```

Use raw commands only when debugging `rtk` filtering itself.

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if generalized property dependency inference cannot
  soundly walk a predicate shape. Do not guess reads; mark that property
  unsliceable with a structured skip reason.
- Stop and report if pruning `sys:pending` changes reachable behavior for a
  property that can observe enqueue/dequeue facts. Fix dependency tracking
  before continuing.
- Stop and report if route/mount pruning removes a var needed to decide
  transition enabledness. Add the missing dependency edge rather than disabling
  pruning globally.
- Stop and report if field pruning would require changing `AbstractDomain` in a
  way that breaks checker validation or replay witness generation. Land metadata
  and caveats first, then split domain-shape changes into a follow-up.
- Stop and report if property confidence cannot be computed from existing model
  and slice data without re-running extraction. Confidence should be derived
  from artifacts already present in check inputs.
- Stop and report if model-slack caveats become too broad to be actionable.
  They must include stable IDs, source/path when available, and a specific
  reason.
- Stop and report if removing warning-string parsing exposes source plugins
  that cannot yet emit structured caveats. Add structured caveat constructors or
  source-specific caveat creation instead of preserving regex parsing.
- Stop and report if schema updates require touching historical closed plans,
  generated `dist/`, or unrelated docs. Those are outside this plan.

## 12. Must Not Change

- Do not add framework-specific fields to core IR for economics or trust data.
- Do not execute application code to decide pruning.
- Do not use heuristic pruning while still reporting exact verification.
- Do not silently drop writes, pending operations, route state, or fields that
  are in a property's dependency closure.
- Do not leave compatibility parsers for warning strings once structured
  caveats exist.
- Do not make real-app canaries the primary proof. Use small fixtures first;
  canaries only validate integration and budgets after conformance passes.
