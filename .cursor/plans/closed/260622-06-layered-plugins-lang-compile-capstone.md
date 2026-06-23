# Layered Plugins — Phase 7 (Capstone): L1/L2 Split + Thin-Driver Inversion

> Part 6 of 6. Specs: `docs/_specs/plugin-layering/01-language-frontend.md`,
> `02-semantic-compiler.md`, `06-migration-roadmap.md` (Phase 7). Depends on Parts 2–5 (all leaf
> recognition already behind SPIs). **This is the only phase that may reorder transitions** — it
> carries a snapshot-review budget and the demo-app acceptance gate.

## 1. Goal

Complete the layering by extracting the two universal layers out of the monolithic engine:

- **L1 `src/extract/lang/ts`** — parse → normalized **Surface IR** (fn/block/if/for/return/assign/
  expr/jsx) plus a `SymbolPort` over the TS type checker (incl. `importBinding` for real
  alias-awareness). Owns the `typescript` dependency.
- **L2 `src/extract/compile`** — universal control-flow/arithmetic/guards/dataflow lowering from
  Surface IR to `EffectIR`/`ExprIR`, dispatching every leaf to L3 SPIs via a generic `dispatchNode`
  that merges L3-returned leaf fragments under a deterministic precedence.

The walkers `react-source-transitions.ts` and `transition/statement-summary.ts` collapse into a
thin engine driver that wires L1 → L2 → L3 and stabilizes ids after merge.

## 2. Non-goals

- Do not change the IR node kinds, the checker, or the exporter (Spec `04-ir-policy.md`).
- Do not add new SPI methods beyond the `LeafDispatch` adapter that fronts the Part 2–5 SPIs.
- Do not add a second language; only prove L1/L2 are language-agnostic by construction.
- Do not "improve" semantics opportunistically — any behavior change must be an intentional,
  reviewed snapshot delta, not a silent ride-along.

## 3. Current-state findings

- The universal compiler already exists inside `transition/statement-summary.ts` (1156 lines): loop
  detection (`isLoopStatement`, `statement-summary.ts:96`), statement sequencing, guarded-effect
  construction for `if`, and leaf delegation (`summarizeSetterCall` / `setterCallFrom` /
  `summarizeWrite`, `statement-summary.ts:200-300`). It is entangled with leaf recognition that Parts
  2–5 already moved behind SPIs, so by this phase the file's *remaining* responsibilities are
  genuinely universal.
- The expression compiler is reached via `BoundExpr` (`src/extract/engine/ts/expressions.ts` is a
  one-line re-export of `./types.js`); the actual expression lowering lives in
  `transition/` + `numeric/`.
- `react-source-transitions.ts` (1353 lines) is the JSX/handler walker; after Parts 2–4 its
  React-specific recognition is gone, leaving traversal + control-flow orchestration.
- Symbol/type resolution is `SemanticTypeContext` (`spi/index.ts`), with `localSymbolKey` and
  `resolveModuleName`. `importBinding` does **not** exist yet; `ast.ts` matched bare identifiers.
- Id stabilization happens in the engine driver post-assembly (`build-model.ts:277-347` assembles
  vars/transitions; overlay stability depends on stable ids).
- depcruise has no `extract/lang/*` or `extract/compile` boundary yet (Part 2 added
  `extract/frameworks/*`).

## 4. Atomic implementation steps

1. **Define Surface IR + `SymbolPort`.** Add `src/extract/lang/ts/surface-ir.ts` (the node set from
   `01-language-frontend.md §3`) and `symbol-port.ts` (`resolve`, `localSymbolKey`, `importBinding`,
   `typeOf`) implemented over `SemanticTypeContext`. `importBinding` resolves
   `import { useState as x }` and `import * as React` aliases.
2. **Implement TS → Surface IR lowering.** Add `src/extract/lang/ts/lower.ts` turning the TS AST into
   Surface IR, carrying `origin: NodeRef` handles for L4 leaf interpreters. This is the only module
   below L5 allowed to `import * as ts`.
3. **Extract L2 compiler.** Create `src/extract/compile/` from `statement-summary.ts` + the
   expression/numeric lowering: `compile-stmt.ts` (block→seq, if/switch→`EffectIR.if`, loop
   over-approx, dataflow env), `compile-expr.ts` (arithmetic/guards/equality), and `leaf-dispatch.ts`
   (the `LeafDispatch` contract from `02-semantic-compiler.md §2`). L2 imports `core` +
   `extract/engine/spi` only.
4. **Front the SPIs with `LeafDispatch`.** Implement an adapter that turns the Part 2–5 SPIs
   (`FrameworkPlugin`, `StateSourcePlugin.summarizeWrite/decodeBinding`,
   `NavigationAdapter.recognizeFormSubmit`, `EffectModelProvider`) into the three `LeafDispatch`
   methods (`interpretCall`/`interpretExpr`/`interpretBoundary`) under the **total precedence order**
   of `03-use-case-spis.md §6`. Index interpreters by node kind / hook name to avoid
   O(nodes × plugins).
5. **Build the thin driver.** Replace the bodies of `react-source-transitions.ts` and
   `statement-summary.ts` with a generic `dispatchNode` that walks Surface IR, calls L2, merges
   L3 leaf fragments by precedence, and emits transitions. Keep id stabilization in the driver
   **after** merge for overlay stability.
6. **Boundaries + cleanup.** Add depcruise rules: `extract/lang/*` imports `core` only;
   `extract/compile` imports `core` + `extract/engine/spi`; engine may not import `lang`. Delete the
   emptied engine modules. Update `package.json#exports` if `lang`/`compile` need subpaths.
7. **Snapshot-review pass.** Re-baseline any intentional transition reordering, documenting each
   delta; run the demo-app three-seeded-bugs gate and `pnpm phase7` TLA+ parity.

## 5. Tests to add or update

- Add `test/lang/ts/surface-ir.test.ts`: lowering produces the expected Surface IR for fn/block/if/
  switch/for/return/assign/declare/expr/jsx; `importBinding` resolves named and namespace aliases.
- Add `test/compile/compile-stmt.test.ts`: the `handleX(){ if(a){ setX(p) } }` trace
  (`02-semantic-compiler.md §4`) lowers to `EffectIR.if{cond, then:assign(local:C.X, read(p)),
  else:noop}` given a stub `LeafDispatch`; loop over-approx → `havoc` + caveat; block → seq.
- Add `test/compile/leaf-dispatch-precedence.test.ts`: when two stub plugins claim a node, the
  declared precedence wins deterministically regardless of registration order; conflicting IR raises
  a caveat, not a silent pick.
- Update all engine tests that imported the old walker internals to the new driver entry points.
- **Acceptance gates:** demo-app three-seeded-bugs test still catches all three; `pnpm phase7` TLA+
  parity holds; snapshot deltas are reviewed and re-baselined intentionally.

## 6. Verification

```bash
rtk pnpm vitest run test/lang/ts test/compile
rtk pnpm typecheck
rtk pnpm architecture            # new lang/compile boundaries enforced
rtk pnpm test                    # review + re-baseline intentional reorderings
rtk pnpm phase7                  # TLA+ parity must hold
rtk pnpm ci:examples             # demo-app three seeded bugs
rtk pnpm fix
```

## 7. Acceptance criteria

- `src/extract/lang/ts` owns Surface IR + `SymbolPort` and is the only sub-L5 module importing
  `typescript`; `importBinding` resolves aliases.
- `src/extract/compile` owns all control-flow/arithmetic lowering and contains no library string and
  no `typescript` import.
- The engine driver is a thin `dispatchNode` merging L3 fragments by the declared precedence, with id
  stabilization after merge.
- `pnpm architecture` enforces `lang → core`, `compile → core + engine/spi`, engine ↛ `lang`.
- Demo-app catches all three seeded bugs; `pnpm phase7` TLA+ parity holds; every snapshot delta is a
  reviewed, intentional reordering.

## 8. Risks, ambiguities, and stop conditions

- **Transition reordering is expected here and only here.** Budget the review. If a delta is not a
  pure reordering (i.e. it changes a verdict or a seeded-bug catch), stop — it is a bug in the L2/L3
  seam, not a re-baseline.
- **`origin: NodeRef` leakage:** L2 must never read `origin`; only L4 does, via the symbol port. If
  L2 needs node detail to compile control flow, that detail belongs in Surface IR — extend Surface IR
  rather than passing `origin` into L2.
- **Determinism:** the precedence merge must be total and order-independent. Stop and report any node
  where two plugins legitimately produce different valid IR — that is a spec decision for
  `03-use-case-spis.md §6`, not an ad-hoc tiebreak.
- **Performance:** index leaf interpreters by node kind / hook name; a naive O(nodes × plugins) loop
  will regress large apps. Measure on a benchmark before/after.
- **Scope discipline:** this capstone is large. If step 5 (the driver rewrite) cannot land without
  also touching Parts 2–5 SPIs, stop — those SPIs should already be sufficient; a gap means an
  earlier part was incomplete.
