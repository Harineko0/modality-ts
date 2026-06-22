# 260623-02 — Experiment 3: action-mode conformance pass-rate on benchmark apps

Part 2 of 4. Depends on 260623-01 (the `ValidityExperiment` seam + report spine).
Replaces the `conformance` stub.

## 1. Goal

Measure how well the *extracted model* matches the *running app* by replaying
model-derived random walks against the real benchmark apps in the DOM (RTL + MSW), and
report the aggregate **pass-rate** and **per-transition pass-rate** for each benchmark.
This is the only direct empirical evidence that `extract` produced a faithful model, and
becomes the standing conformance metric for the blog and CI.

## 2. Non-goals

- No change to the `modality conform` engine or `ConformReport` schema — they already
  emit `metrics` + `transitionMetrics` and support `mode: "action"`.
- No abstract-mode fallback in the headline number (abstract mode may be kept as a
  cross-check, but the reported figure is action-mode).
- No new properties; reuse `benchmarks/shared/app-spec` properties and seeded outcomes.
- No production-code observation transform (Spec 04 §4 "probe transform"); use DOM
  projection + explicit observation maps only.

## 3. Current-state findings

- `runConformCommand` (`src/cli/features/conform/command.ts`, re-exported by
  `src/cli/conform.ts`) accepts `{ modelPath, walksPath?, walkCount, depth, seed,
  mode: "action", harnessPath, thresholds, reportPath }` and, when no `walksPath`, it
  **generates** seeded random walks from the model (`loadOrGenerateWalks`).
- Action mode requires a harness module exporting
  `renderModalityReplay(trace): ModalityReplayHarness | Promise<…>` and optional
  `observeModalityReplay(harness): ObservationSource`. The harness must provide
  `document`, `navigate`, `resolve`, `focusRevalidate`, `timer`, `stabilize`, and optional
  `sources`. Default observation is DOM projection via the attribute
  `[data-modality-var="<varId>"]` (see `domProjectionSource`).
- `ObservableActionReplayDriver`, `createDomReplayActor`, `observationSource`,
  `replayTrace`, `statesFromTrace` are exported from `modality-ts/cli/harness`.
- `ConformReport.transitionMetrics[]` already gives `{ transitionId, walks, reproduced,
  notReproduced, inconclusive, passRate }`.
- `benchmarks/{react-router,nextjs}` are real runnable apps (Vite / Next). Shared
  app-spec lives in `benchmarks/shared/app-spec` (`pages.ts`, `routes.ts`,
  `seeded-outcomes.ts`, `property-catalog.ts`, `property-api-requirements.ts`) and shared
  testing helpers in `benchmarks/shared/testing` (`parity.ts`, `route-fixtures.ts`).
- The verdict vocabulary is `reproduced | not-reproduced | inconclusive` (Spec 04 §1):
  `not-reproduced` = model divergence (the signal we measure); `inconclusive` = harness
  failure (must be driven to ~0, never counted as agreement).

## 4. Atomic implementation steps

1. **Author one shared action harness factory** at
   `benchmarks/shared/testing/replay-harness.ts`:
   `createBenchmarkReplayHarness({ mount, store, swrCache, router, msw })` returning an
   object implementing the `renderModalityReplay`/`observeModalityReplay` contract:
   - `renderModalityReplay(trace)`: mount the app under a deterministic provider tree
     (fresh Jotai store, `SWRConfig` with `provider: () => new Map()` + `dedupingInterval:
     0`, `MemoryRouter`/router test API seeded from `trace.initialRoute`, fake timers),
     return `{ document, navigate, resolve, focusRevalidate, timer, stabilize, sources }`
     wired to gated MSW handlers (capture+park each effect-API request; `resolve` releases
     the parked promise with the witness payload for the chosen outcome — Spec 04 §3).
   - `stabilize`: flush microtasks → advance fake timers by template delays → `waitFor`
     idle (no parked release pending, React act queue empty).
   - This is framework-parameterized: app-specific mounting, provider wiring, and the MSW
     handler set are injected, so react-router and nextjs reuse the same factory.
2. **Build observation maps** from `benchmarks/shared/app-spec`. For directly-observable
   vars (Jotai atoms via the store handle, SWR cache by key, route via router API,
   `sys:pending` via parked-MSW bookkeeping) implement an `observeModalityReplay` returning
   an `observationSource` that reads those sources directly (full fidelity, Spec 04 §4).
   For any `useState`-derived var used by a property, add `data-modality-var="<varId>"`
   attributes at the render site in the benchmark app and rely on DOM projection. Produce a
   per-app `observation-map.ts` listing, per property read-set var, its observation
   mechanism; fail fast (clear error) if a property reads an unobservable var with no entry.
3. **Add a per-benchmark harness entry** `benchmarks/<app>/modality.replay-harness.ts` that
   composes the shared factory (step 1) with that app's mount + MSW handlers + observation
   map (step 2) and re-exports `renderModalityReplay` / `observeModalityReplay`. This is the
   `harnessPath` passed to `runConformCommand`.
4. **Implement the experiment module**
   `tools/validity/experiments/conformance.ts` (replacing the 01 stub):
   for each benchmark in the manifest — run `runExtractCommand` into the shared workDir,
   then `runConformCommand({ modelPath, mode: "action", harnessPath:
   benchmarks/<app>/modality.replay-harness.ts, walkCount, depth, seed, reportPath })`.
   Read back the `ConformReport`, map into a `ValidityBenchmarkSlice` with
   `metrics: { total, reproduced, notReproduced, inconclusive, passRate,
   transitionMetrics }`. Headline = aggregate pass-rate across both apps and the
   worst-performing transition ids. Mark `status: "fail"` if any benchmark's pass-rate is
   below `validityThresholds.conformance.minPassRate` (manifest-owned; default report-only).
5. **Make walk generation deterministic and coverage-biased**: pass a fixed `seed` per
   benchmark (manifest field `conformance: { walkCount, depth, seed }`), and bias sampling
   toward `confidence: exact` transitions and rarely-covered transitions if the conform
   engine exposes a sampler option; otherwise generate from the model successors with the
   seed and document the bias as future work. Record `walkCount`/`depth`/`seed` in the slice
   for reproducibility.
6. **Surface `inconclusive` loudly**: any `inconclusive > 0` downgrades the slice headline
   to a warning and lists the failing walk ids + reasons (locator missing, provider/setup
   error), since inconclusive means harness defects, not model agreement (Spec 04 §1). The
   experiment must not silently count inconclusive as pass.

## 5. Tests to add or update

- `benchmarks/<app>` unit: a smoke test that `renderModalityReplay(seededTrace)` mounts,
  drives 2–3 steps, and `resolve` releases a parked MSW request (proves gating works).
- `test/validity/conformance-experiment.test.ts`: run the experiment against a tiny
  fixture model (reuse `tools/conformance` fixture style) with a fake harness module and
  assert the slice maps `ConformReport.metrics`/`transitionMetrics` correctly and that
  `inconclusive` downgrades the headline.
- Extend `benchmarks/shared/testing/parity.ts` coverage so every property read-set var has
  an observation-map entry (a parity test that the observation map covers all
  property-referenced vars — closes the Spec 04 §4 "blocked replay" gap at CI time).

## 6. Verification

- `pnpm typecheck`
- `pnpm validity -- --id conformance --report /tmp/c.json` → non-trivial pass-rate,
  `inconclusive` near 0 for both apps, per-transition table populated.
- Cross-check (optional): run the same walks in `mode: "abstract"` and confirm action-mode
  pass-rate ≤ abstract-mode (action is stricter); a large gap flags harness/observation
  defects rather than model defects.
- `pnpm fix`, `pnpm architecture`.

## 7. Acceptance criteria

- Both benchmark apps run action-mode conformance end-to-end with `inconclusive ≈ 0`.
- The validity report's `conformance` slice carries aggregate + per-transition pass-rates
  for each app, with reproducible `seed`/`walkCount`/`depth`.
- Every property read-set var is observable (direct source or DOM-projection entry);
  missing observation maps fail the parity test, not silently pass.
- The shared harness factory is framework-agnostic (no react-router/next specifics in the
  factory itself; specifics injected per app).

## 8. Risks, ambiguities, and stop conditions

- **`inconclusive` dominates**: if harness setup is flaky, the headline is noise. Treat
  driving `inconclusive → 0` as the gating sub-task; if it cannot be driven down for an
  app, **stop** and report that app's conformance as "blocked: harness", never as a low
  pass-rate (which would falsely impugn `extract`).
- **Next.js app-router mounting** under RTL/jsdom is harder than the Vite react-router app.
  If full app-router mounting is infeasible in jsdom, scope the nextjs harness to the
  client-component subtree the model covers (client UI transitions only — consistent with
  `docs/soundness/limitations.md`), and record the scope in the slice `messages`.
- **Witness fidelity**: a `not-reproduced` may be witness-specific, not a model defect
  (Spec 04 §2 soundness note). Report `not-reproduced` as advisory; do not auto-fail CI on
  it. Use overlay `witness(...)` for apps whose code validates payload shape.
- **Observation of `useState`**: prefer adding `data-modality-var` attributes over the
  opt-in probe transform; if a var is genuinely unobservable, exclude its property from the
  conformance set and record the exclusion (do not fabricate observability).
