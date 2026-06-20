# TODO: Spec-Defined Future and Missing Work

This list captures features described in `docs/design.md` and `docs/specs/*.md` that are not currently implemented, are only partially implemented, or are explicitly marked as future work. It treats the current `src/` layout as authoritative; doc paths in older specs are conceptual.

## Extraction

- Add first-class `useReducer` extraction. The specs call this a natural v2 target because reducers are model-friendly, while current extraction reports `useReducer` as unsupported.
- Add future state-source slices for Redux and similar libraries via the public plugin contracts, with no checker/exporter changes.
- Implement automatic predicate harvesting from guards, with report visibility, while preserving the E1 review story.
- Expand predicate-refinement support so witness obligations are required and validated at extract time.
- Improve M0 expression coverage where still partial: bounded-list comprehensions such as `find`/`some`/`every`/`includes`, richer input coercion pipelines, and condition-only nondeterministic branch modeling.
- Implement closure-snapshot semantics for async continuations as the v2 alternative to current stale-read caveats.
- Improve derived read-only Jotai atom inlining beyond current token-domain + warning fallback.
- Add `modality extract --explain-drift` for orphaned overlay entries and AST-similarity hints.

## Checker

- Replace interpreted guard/effect evaluation hot paths with compiled per-model closures where specified for performance.
- Replace JSON-based canonical state encoding with the domain-aware compiled encoder described in Spec 03.
- Add the full checker assurance suite: TLC differential runner, randomized structured IR corpus, metamorphic tests, and canonicalization property tests.
- Add trace post-processing helpers: diff focusing and heuristic hints such as double-submit pattern detection.
- Add nearest-miss/exhausted-search certificate details for `reachableFrom` counterexamples.
- Implement specified performance extensions when needed: worker-thread frontier partitioning, partial-order reduction for independent resolve transitions, binary visited-set encoding, and on-disk frontiers.
- Add unbounded `leadsTo`/fair liveness support via SCC/fair-cycle detection if v2 needs it.
- Improve memory-exhaustion handling with partial reports instead of process failure.

## Replay and Conformance

- Generate fuller self-contained RTL/MSW replay tests with gated request handlers, teardown reporting for unexpected requests, and robust stabilization barriers.
- Add Playwright replay as a later replay tier for traces whose labels map to real browser interactions.
- Add richer witness generation: deterministic TS-type-based payload generation for token domains, per-var witness factories, refinement witness validation, and validator-derived input witnesses.
- Implement the opt-in SWC/Babel `useState` probe transform for full-fidelity local state observation in tests.
- Add extract-time observability checks per property, so replay is blocked early for predicates that read unobservable vars without observation declarations.
- Make `modality conform` sampling match the spec more closely: bias toward exact transitions and rarely covered transitions, and report coverage-guided transition health.
- Add SWR template conformance against pinned real SWR versions and report tested-version ranges.

## Runtime Assertions

- Broaden `useModalityAssertions` around observable-only invariant checks, source subscriptions, and clearer skipped-property reporting.
- Keep runtime bundle size dependency-free and expose only the minimal property-combinator/runtime subpath needed by app dev bundles.

## Export and External Backends

- Add SMV/nuXmv export if it becomes useful; specs mention it as an eventual external backend path.
- Keep opaque-effect export explicitly over-approximating via `havoc(declaredWrites)` and surface that caveat in export headers/reports.
- Cross-validate TLA export against checker results automatically in CI once the TLC runner exists.

## Reporting and Artifacts

- Enrich reports with peak memory, elapsed time, trace hints, nearest-miss certificates, and clearer bounded-verification language.
- Improve schema-version compatibility messages, especially rejecting newer-major artifacts with actionable “re-run extract” guidance.
- Continue expanding trust-ledger coverage for plugin provenance, source hashes, assumptions, abstractions, bounds that actually bit, and conformance regressions.

## Product and UX

- Add AI assistance only as suggestion/explanation tooling, never as state-space pruning or proof authority.
- Add property-authoring helpers and examples for common frontend bug classes.
- Keep example/docs alignment current as features graduate from this TODO into implementation.
