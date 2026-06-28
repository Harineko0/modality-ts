# 260624-02 — Benchmark observation-map realignment (Fix A)

## Goal

Make action-replay actually observe model variables for the ledgerops
benchmarks, so the `conformance` and `mutation` validity experiments stop
returning 0%. Both depend on the live app reproducing model violations through
the benchmark observation map; that map's var-id conventions have drifted away
from what the extractor now emits, so `ObservableActionReplayDriver.currentState()`
finds *nothing* observable and every walk is `inconclusive`.

Replace the brittle, hand-maintained string-catalog approach with a
**prefix-driven observation resolver** that parses the var-id structure
(`atom:`, `swr:`, `zustand:`, `local:`, `sys:`) and dispatches to the correct
runtime mechanism, deriving keys from the id itself rather than reconstructing
them from a duplicated catalog. This is the fundamental, library-agnostic fix and
removes the entire class of "catalog out of sync with extractor" drift.

## Non-goals

- Do NOT change the extractor's var-id scheme. The extractor is the source of
  truth; the observation layer adapts to it, never vice-versa.
- Do NOT change model assembly (`260624-02`) or reporting (`260624-04`).
- Do NOT add per-app special cases. The resolver must be driven by var-id prefix
  semantics common to all benchmarks, with runtime handles supplied by each app's
  harness.

## Current-state findings

Extractor emits (verified from `.modality/ledgerops-react-router.model.json`):

| Family | Actual model var ids |
|---|---|
| Jotai | `atom:<name>` AND `atom:<name>@store:provider:AppProviders` (15 atoms) |
| SWR | `swr:<hookName>:<field>` where field ∈ `data` `error` `isValidating` |
| Zustand | `zustand:<useStoreName>.<field>` |
| useState | `local:<Component>.<field>` |
| Router | `sys:route`, `sys:history`, `sys:pending` |

The map in `benchmarks/shared/testing/observation-map.ts` +
`benchmarks/shared/app-spec/property-catalog.ts` mismatches all of them:

- **SWR:** `swrVarIdHint("useAccountDetail")` produces `swr:account-detail`
  (strips `use`, kebab-cases). Model uses `swr:useAccountDetail:data`. Never
  matches → all 4590 swr vars unobservable.
- **useState:** map only has a `useState:` prefix entry; model uses `local:`.
  Never matches.
- **Jotai:** `ledgerOpsJotaiStateNames` lists only **9 of 15** atoms (missing
  `accountStatusFilterAtom`, `accountDetailTabAtom`, `loginStatusAtom`,
  `roleSaveStatusAtom`, `auditActorRoleFilterAtom`, `auditExportStatusAtom`).
  The `@store:provider:…` suffixed variant is also not handled distinctly.
- **Zustand:** routed to `dom-projection` (`data-modality-var=…`) which the
  benchmark app never emits → unobservable.
- **Router:** `sys:history` is not mapped (only `sys:route`, `sys:pending`).

Consequences:
- `conformance`: pass-rate 0/64, every walk `inconclusive` with reason
  "Unobservable model vars: …".
- `mutation`: a mutant is "killed" only when `reproducedViolationProperties`
  (`tools/validity/experiments/mutation.ts:435`) finds a checker-violation whose
  replay verdict is `reproduced`. Replay never reproduces anything → 0/16
  detection.

Relevant code:
- `createBenchmarkObservationSource` and `observationEntryForVar`
  (`benchmarks/shared/testing/observation-map.ts:46,92`) — the dispatch + matcher.
- `assertObservationMapCoversModel` (same file, line 79) — a coverage check that
  exists but is **only invoked from tests**, not from the conformance run path, so
  drift fails silently as inconclusive instead of loudly.
- Runtime handles come from each harness's `mount(...).observation`
  (`benchmarks/react-router/modality.replay-harness.ts`,
  `benchmarks/nextjs/modality.replay-harness.ts`). The react-router harness today
  exposes only `jotai` (with an incomplete `atomByName` of 15 entries) and relies
  on shared defaults for `swr`/`dom`.
- The replay driver throwing on unobservable vars:
  `ObservableActionReplayDriver.currentState`
  (`src/cli/harness/index.ts:264-278`).

## Atomic implementation steps

1. **Define a prefix-driven resolver.** Rewrite
   `createBenchmarkObservationSource` (`benchmarks/shared/testing/observation-map.ts`)
   to parse the var id by prefix and dispatch, deriving the lookup key from the id:
   - `atom:<name>` / `atom:<name>@…` → strip `atom:` prefix and any `@store:…`
     suffix to get `<name>`; call `handles.jotai(name)`.
   - `swr:<hook>:<field>` → call `handles.swr(hook, field)` (or
     `handles.swr("swr:<hook>:<field>")` — pick one signature and apply it
     consistently; prefer passing the structured `(hook, field)`).
   - `zustand:<store>.<field>` → call `handles.zustand(store, field)`.
   - `local:<component>.<field>` → call `handles.useState(component, field)`.
   - `sys:route` → `handles.route()`; `sys:pending` → `handles.pending()`;
     `sys:history` → `handles.history()` (new handle, see step 4).
   Unknown prefixes return `"unobservable"`. Remove `ledgerOpsObservationMap`,
   `swrVarIdHint`, and `observationEntryForVar` — they encode the stale
   conventions and are the root of the drift.

2. **Update `BenchmarkObservationHandles`.** Replace the current handle shape with
   one keyed by mechanism that takes structured arguments:
   `jotai(name)`, `swr(hook, field)`, `zustand(store, field)`,
   `useState(component, field)`, `route()`, `pending()`, `history()`. Each returns
   `Value | "unobservable"`. This makes the contract explicit and removes string
   reconstruction.

3. **Provide real runtime handles in `replay-harness.ts` (shared).** In
   `benchmarks/shared/testing/replay-harness.ts`, supply defaults that read from
   the actual runtime stores the harness already has access to (the SWR cache map,
   and — newly — the jotai store and zustand stores passed up from each app's
   `mount`). Drop the DOM-projection fallback for zustand; observe the store
   directly. Keep DOM projection available only as an explicit opt-in mechanism,
   not the default for store-backed families.

4. **Wire app harnesses to expose stores.** In
   `benchmarks/react-router/modality.replay-harness.ts` and
   `benchmarks/nextjs/modality.replay-harness.ts`:
   - Complete the jotai atom registry to cover all 15 atoms (the model's atom set),
     and resolve atoms generically rather than via a hand-listed subset.
   - Expose the zustand store(s) so `handles.zustand(store, field)` can read
     `store.getState()[field]`.
   - Expose useState values via the existing DOM/projection or a component-state
     bridge so `handles.useState(component, field)` resolves `local:` vars.
   - Provide `handles.history()` for `sys:history` from the router state.

5. **Delete the catalog drift surface.** Remove
   `ledgerOpsJotaiStateNames`/`ledgerOpsSwrHooks`-as-id-source usage from the
   observation path (the catalog may remain for *property* generation, but must no
   longer be the observation key source). Confirm nothing else imports the removed
   helpers.

6. **Make coverage failures loud.** Invoke `assertObservationMapCoversModel(model)`
   (rework it to validate the resolver can handle every property-relevant var id by
   *prefix*, not by catalog membership) inside the conformance run path
   (`tools/validity/experiments/conformance.ts` before walks execute, or in the
   harness setup) so an unobservable var aborts with a clear error instead of
   silently degrading to `inconclusive`.

## Tests to add or update

- Update `test/harness/replay.test.ts` and
  `src/cli/features/replay/command.test.ts` expectations for the new
  `Unobservable model vars` messaging if handle shapes change.
- **New unit test** for the prefix resolver: feed representative ids
  (`atom:x`, `atom:x@store:provider:AppProviders`, `swr:useFoo:data`,
  `zustand:useBar.baz`, `local:Comp.field`, `sys:history`) and assert each routes
  to the correct handle with the correctly-parsed key; unknown prefix →
  `"unobservable"`.
- **New coverage test** asserting `assertObservationMapCoversModel` passes for the
  full extracted react-router and nextjs models (regression guard against future
  extractor-scheme drift).
- Update any benchmark conformance fixture tests under
  `test/conformance/`/`test/modality/` that asserted the old handle shape.

## Verification

- `pnpm typecheck`, `pnpm fix`, `pnpm architecture`.
- `pnpm test` fast tier green.
- `pnpm validity:conformance` — action pass-rate must be **> 0** for both
  benchmarks; the per-walk reason "Unobservable model vars: …" must disappear for
  property-relevant vars. (Some walks may still be legitimately `notReproduced`;
  that is fine — the requirement is that observation works, not that every walk
  reproduces.)
- `pnpm validity:mutation` — detection must be **> 0** (mutants now killable).
- `pnpm ci:examples` to confirm the example/benchmark harnesses still mount.

## Acceptance criteria

- For both ledgerops benchmarks, no property-relevant model var reports
  `unobservable` during conformance replay.
- `conformance` headline pass-rate > 0% and not gated by the all-inconclusive
  fail-guard.
- `mutation` detection rate > 0%.
- Observation dispatch is purely prefix/structure driven; no hardcoded
  hook-name/atom-name catalog participates in observation key resolution.
- `assertObservationMapCoversModel` runs in the conformance path and fails loudly
  on any uncovered var.

## Risks, ambiguities, and stop conditions

- **Depends on `260624-01`.** Run after the dedup fix so the model the resolver is
  validated against is the canonical 114-var model, not the 4659-var bloat.
- **Risk:** zustand/useState stores may not be reachable from the harness without
  app changes. If the app does not expose a store handle, prefer adding a minimal
  test-only bridge in the harness mount over re-introducing DOM projection. If
  neither is feasible without app-source changes, **stop** and document which var
  families remain unobservable and why.
- **Risk:** SWR cache keys at runtime may be arrays/objects; `handles.swr(hook,
  field)` must resolve the hook→cache-key mapping deterministically. If the cache
  key cannot be derived from the hook name alone, surface it as an explicit
  per-hook binding in the harness rather than a fuzzy `includes` scan (the current
  `readSWRCache` substring scan is a latent correctness bug — replace it).
- **Stop condition:** if conformance pass-rate stays at 0 after observation is
  confirmed working (vars observable but walks still all `notReproduced`), that is
  a *checker/property* mismatch, out of scope here — file separately.
