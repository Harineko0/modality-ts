# Spec 09.06 — Migration Roadmap

Status: draft for review. Part of the `plugin-layering/` series. This is the **canonical phase
sequence** for implementing the L0–L5 layering. The guiding constraint is below; the per-phase
detail follows.

## 1. Guiding constraint: identity-preserving until the capstone

Every phase before the last moves library strings **out** of the engine and threads an injected
adapter that returns the *same* names, domains, and ordinals the engine produced inline. Therefore:

- Golden extraction snapshots and conformance probes stay **green with zero diffs** through Phases
  0–6.
- Only **Phase 7** (the thin-driver inversion) reorders transitions, and it is the only phase that
  budgets a snapshot-review pass and the demo-app acceptance gate.

This lets the refactor land incrementally on `main` without a long-lived branch, and makes any
unexpected snapshot diff in Phases 1–6 an immediate signal of a behavior-changing bug.

## 2. Phase sequence

### Phase 0 — Config reception (ships first; foundational)
Spec `05-config-and-registry.md`. Make plugin wiring explicit in the generated config; registry uses
explicit config as source of truth with auto-detect as fallback. Touches
`src/cli/features/init/command.ts`, `src/cli/extraction/build-model.ts`, `src/cli/registry/index.ts`.
No engine code; no snapshot risk. **Acceptance:** generated config typechecks; benchmark model
identical; `pnpm test` + `pnpm architecture` green.

### Phase 1 — `FrameworkPlugin` SPI + `frameworks/react` (the proof)
- New: `src/extract/engine/spi/framework.ts` — `FrameworkPlugin`, `HookCall`, `RenderBoundary`.
- New: `src/extract/frameworks/react/{index,hooks,render-boundaries}.ts` — the name tables from
  `ast.ts:13-157` + `transition/effects.ts:313` (`reactEffectPhase`) + the Suspense domain currently
  built inline in `react-source-transitions.ts`; all import-alias-aware via L1's `importBinding`.
- Modify: `ast.ts` predicates to consult an injected framework; thread `framework` through
  `react-source-transitions.ts` options and `pipeline/index.ts`.
- Modify: `registry/index.ts` (register/validate/stamp `framework`); `core/ir/types.ts`
  (`PluginProvenance.kind += "framework"`); `tools/depcruise.config.cjs` (new `frameworks/*`
  boundary).
- Identity-preserving; near-zero snapshot churn. **Acceptance:** `pnpm test` + `pnpm phase7` zero
  golden diffs; `pnpm architecture`; `pnpm ci:examples`.

### Phase 2 — useState binding consolidation
Engine consumes the binding from `StateSourcePlugin` discovery (already flowing via
`extractionCtx.stateVars`) instead of re-deriving it in `react-source-transitions.ts:454-541` and
`context.ts:134-160`; add `decodeBinding` (Spec 03 §3) to delete the var-id regex at
`context.ts:27-44`.

### Phase 3 — render-boundary ownership
Move `<Suspense>` / `React.lazy` / `use()` recognition (`ast.ts:101-132`) into `frameworks/react`
`recognizeRenderBoundary`; the engine keeps the generic `gateTransitionForBoundary`.

### Phase 4 — effect/concurrency ownership
Move `useEffect` / `useTransition` / `useDeferredValue` / `flushSync` recognition (`ast.ts:39-99`)
plus phase ordinals (`effects.ts:313`) into the react plugin; summarization stays generic in L2.

### Phase 5 — router form ownership
Move the `Form` / `useSubmit` / `useActionData` recognition behind
`NavigationAdapter.recognizeFormSubmit` (Spec 03 §4); generic location lowering stays in the engine.

### Phase 6 — effect-model ownership
Move timer / websocket recognition (`timers.ts`, `environment-callbacks.ts`) behind
`EffectModelProvider` (Spec 03 §5); CPS / enqueue-resolve stays generic in L2. Add `effectModels` to
config and `PluginProvenance.kind += "effect-model"`.

### Phase 7 — L1/L2 split + thin-driver inversion (capstone)
Extract `src/extract/lang/ts` (Surface IR + symbol port, Spec 01) and `src/extract/compile`
(universal control-flow/arithmetic, Spec 02) out of `statement-summary.ts` /
the expression compiler / `react-source-transitions.ts`. The walker becomes a generic `dispatchNode`
that merges L3-returned leaf fragments under the deterministic precedence of Spec 03 §6. **Only phase
with transition reordering** — budget a snapshot-review pass and the demo-app three-seeded-bugs
acceptance gate. **Acceptance:** snapshot review signed off; demo app still catches all three seeded
bugs; `pnpm phase7` TLA+ parity holds.

## 3. Per-phase verification matrix

| Phase | `pnpm test` | `pnpm phase7` | `pnpm architecture` | `pnpm ci:examples` | snapshot diffs |
|---|---|---|---|---|---|
| 0 | ✓ | — | ✓ | — | none |
| 1–6 | ✓ | ✓ | ✓ (after depcruise edits) | ✓ | **zero** |
| 7 | ✓ | ✓ (TLA+ parity) | ✓ | ✓ (three seeded bugs) | reviewed reorder |

Run `pnpm fix` after any authored Markdown/TS in every phase.

## 4. Risks and mitigations

- **Leaf interpreters that under-approximate** → route all plugin writes through the existing escape
  analysis (E1) so a missed write taints loudly (Spec `04-ir-policy.md §3`).
- **New conformance surface** for `FrameworkPlugin` (Suspense gating, effect-phase ordering,
  concurrency lag) → pin probes to `testedVersions`.
- **O(nodes × plugins) dispatch** in Phase 7 → index interpreters by node kind / hook name.
- **Determinism** → explicit fragment-merge precedence (Spec 03 §6); keep ID stabilization in the
  engine driver *after* merge for overlay stability.
- **Config reception** must keep zero-config UX working (auto-detect fallback) and not break existing
  `modality.config.ts` files that omit the new fields (Spec `05-config-and-registry.md §3`).
