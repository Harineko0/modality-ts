# Spec 09.00 — Layered Plugin Architecture: Overview

Status: current. Companion to Spec 05 (Software Architecture) and Specs 01–04.
Part of the `plugin-layering/` series (`00`–`06`). This file states the motivation, the
coupling it removes, the L0–L5 layering, and the dependency/inversion rules the rest of the
series elaborates.

## 1. Why this work exists

Spec 05 §4 promised that "supporting a new library = writing one new package in
`src/extract/plugins/`, zero diffs elsewhere." That promise holds for *discovery, domain hints,
and write channels* — the surface the `StateSourcePlugin` SPI already covers
(`src/extract/engine/spi/index.ts`). It does **not** hold for library *semantics*: the meaning of
a recognized call or JSX node is still hardcoded inside the extraction engine under
`src/extract/engine/ts/`. Adding or updating React, Next.js, a router, or a timer model means
editing engine core, not just authoring a plugin.

The work in this series is **separation, not invention**. The layer the user wants —
"plugins supply leaf meaning, the engine owns control flow" — already exists inside
the engine; it is merely entangled with library-specific string tables.
We are pulling the universal part down into a stable compiler layer and pushing the
library-specific part out behind SPIs.

## 2. Coupling inventory (verified in code)

| Coupling | Location | What is hardcoded |
|---|---|---|
| React hook name tables | `src/extract/engine/ts/ast.ts` | `useState`, `useReducer`, `useRef`, `useEffect`/`useLayoutEffect`/`useInsertionEffect`, `useTransition`, `useDeferredValue`, `startTransition`, `flushSync`, `Suspense`, `React.lazy`, `use`, `useCallback` |
| Library var-id shapes | `src/extract/engine/ts/context.ts` | regex match of `local:`, `atom:`, `atom-family:`, `swr:` inside `decodeSetterBinding` (now delegated to plugins via `decodeBinding`) |
| React context/helper semantics | `src/extract/engine/ts/context.ts` | `useCallback`, `useMemo`, `useContext` recognized by name (now delegated to `FrameworkPlugin` TS facets) |
| Timer API names | `src/extract/engine/ts/transition/timers.ts` | `setTimeout`, `setInterval`, `clearTimeout`, `clearInterval` (now owned by `plugins/effect/timers/recognition.ts`) |
| WebSocket API name | `src/extract/engine/ts/transition/environment-callbacks.ts` | `WebSocket` constructor recognition (now owned by `plugins/effect/websocket/recognition.ts`) |
| Effect phase ordinals | `src/extract/engine/ts/transition/effects.ts` | `reactEffectPhase` maps React hook names to ordinals |

The pattern: large *universal* compiler modules (`statement-driver.ts`, `effects.ts`) and a
*React-specific* walker (`react-source-transitions.ts`) reach directly for library strings.
The boundary we want runs straight through both files.

## 3. The L0–L5 layering ("what varies" axis)

Spec 05 §1 names two volatile axes (state libraries, user capabilities) over one stable kernel.
This series adds a third structural dimension — **a vertical stack of layers ordered by what each
layer varies with** — so that library volatility is confined to the top.

| Layer | Location | Owns | Varies by |
|---|---|---|---|
| **L0** Kernel IR / LTS | `src/core/ir` | `Model = (S, S₀, A, →)`; `ExprIR` / `EffectIR` / `AbstractDomain` (frozen) | nothing |
| **L1** Language frontend | `src/extract/lang/<lang>` | parse → normalized **Surface IR** (fn/block/if/for/return/assign/expr) + symbol/type port | language |
| **L2** Semantic compiler | `src/extract/compile` | control-flow lowering, numeric/arithmetic, guards, dataflow; **calls L3 for leaf meaning, wraps it in control flow** | nothing (universal) |
| **L3** Use-case SPIs | `src/extract/engine/spi` | purpose-fit adapter contracts | use case |
| **L4** Library plugins | `src/extract/plugins/{state,route,type,framework,effect}/*` | **leaf semantics only**; discovery; domains | library |
| **L5** Model + Checker | `src/check` | consumes L0 `Model` unchanged | nothing |

Dependency arrows point **downward**. The inversion that makes this work: **L2 drives traversal
and dispatches leaf nodes *up* to L4 via L3.** L2 never imports L4; it receives an injected SPI
object and asks it questions. This is the same inversion Spec 05 §7.1 already states for the
pipeline ("the pipeline calls plugins, never the reverse"), extended one level deeper to the
statement compiler.

## 4. The `if (a) { setX(p) }` resolution

The user's worked example is the litmus test for where the boundary sits. A "generic plugin that
takes AST and returns an LTS" would force *every* plugin to re-implement `if`/`for`/sequencing/
arithmetic — the opposite of lowering the barrier. So the boundary is drawn one notch lower:

- **L2 compiles the `if`.** It lowers `if (a) { setX(p) }` to `EffectIR.if { cond: <a>, then:
  <effect>, else: noop }`. This already happens today in the statement driver (`isLoopStatement`,
  statement sequencing, guarded-effect construction).
- **L4 supplies only the leaf.** For the leaf call `setX(p)`, L2 asks the L3 state adapter "what
  does this call mean?" The adapter answers `assign var=local:C.X expr=<p>` — pure existing IR. The
  plugin never sees the `if`, the block, or the guard.

`StateSourcePlugin.summarizeWrite(call, ctx): EffectIR | "unsupported"`
(`src/extract/engine/spi/index.ts`) is *already* exactly this leaf-interpretation hook. The
series generalizes the same shape to framework hooks, effect models, and navigation forms.

## 5. IR policy (the flexibility boundary, restated)

This series does not relax Spec 05 §3's IR-evolution rule; it depends on it. **Plugins emit pure
existing IR.** Imprecision lowers to `havoc` / `choose` / `opaque` plus a loud `ExtractionCaveat`
— never a new node kind. A library whose semantics genuinely don't fit goes through a kernel RFC,
not a plugin patch. Spec `04-ir-policy.md` is the normative statement; it ties directly to the E1
soundness invariant (Spec 02 §5) so that a leaf interpreter that under-approximates taints loudly
rather than dropping behavior silently.

## 6. Relationship to existing specs

- **Spec 05 §4–§5** (the `StateSourcePlugin` contract and source slices) is unchanged; L4 state
  sources keep that exact contract. This series *adds* sibling L4 categories (frameworks, effect
  plugins, route plugins, type plugins) and *deepens* the SPI down into L2.
- **Spec 05 §7** (dependency rules) gains boundaries for `extract/plugins/*`,
  `extract/lang/*`, `extract/compile`. See `05-config-and-registry.md`.
- **Spec 02** (extraction) is the subsystem being refactored; its observable output (the model)
  is held identity-stable through every phase except the capstone (Spec `06-migration-roadmap.md`).
- **Spec 01** (IR) is frozen; nothing here adds an IR node kind.

## 7. Map of the series

- `01-language-frontend.md` — L1 Surface IR and the symbol/type port; TS as implementation #1.
- `02-semantic-compiler.md` — L2 universal modeling rules and the leaf-dispatch contract. **Centerpiece.**
- `03-use-case-spis.md` — the L3 catalogue: `FrameworkPlugin`, `EffectPlugin`,
  `StateSourcePlugin.decodeBinding`, `RoutePlugin.recognizeFormSubmit`.
- `04-ir-policy.md` — pure-IR fragments, over-approximation discipline, kernel-RFC carve-out.
- `05-config-and-registry.md` — config reception, the `modality init` scaffold, registry wiring,
  dependency-cruiser boundaries.
- `06-migration-roadmap.md` — the canonical phase sequence (identity-preserving until the capstone).
