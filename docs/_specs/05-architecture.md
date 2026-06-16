# Spec 05 — Software Architecture: Single Package, Slices, and the Plugin Contract

Status: draft for review. Companion to `docs/design.md` and Specs 01–04.

## 1. Architectural drivers

Three forces dominate, and the structure below is derived from them:

1. **Two volatile axes, one stable core.** What changes over the tool's life: (a) supported state libraries (`useState`, Jotai, SWR, Zustand today; TanStack Query, `useReducer` tomorrow) and (b) user-facing capabilities (`extract`, `check`, `replay`, `conform` today; Playwright tier, AI suggestions tomorrow). What must *not* change casually: the IR, abstract domains, trace format, and report schemas — every subsystem communicates through them. Therefore: **vertical slices along both volatile axes; a small, schema-versioned kernel as the only coupling point.**
2. **Three runtime contexts.** Extraction and checking run in Node; the replay harness runs inside the app's test environment (jsdom/Vitest); runtime assertions ship in the app's dev bundle. These have incompatible dependency budgets (TypeScript extraction must never reach the browser; optional app libraries such as `jotai` must never be a dependency of the core). Internal module boundaries follow runtime contexts, not team convenience.
3. **The plugin contract must be real, not decorative.** "Flexible enough for future state libraries" fails in practice when built-in integrations use private hooks that external plugins can't. Hard rule: **the four built-in sources use exactly the public `StateSourcePlugin` contract** — they are the contract's permanent conformance suite.

## 2. Repository layout (single npm package)

This repository implements the package architecture as a **flat TypeScript source
tree**. Earlier sketches used nested `src/<area>/src/` folders to mirror
publishable subpackages; the current layout intentionally drops that extra
directory level because all public surfaces are subpath exports from one npm
package. Treat the folders below as package-like architecture boundaries, not as
separate workspaces:

```
modality-ts/
├── src/
│   ├── core/                    # modality-ts/core — the stable center (§3)
│   │   ├── ir/                  #   domains, state vars, transitions, ExprIR/EffectIR (Spec 01)
│   │   ├── trace/               #   Trace, Step, EventLabel, verdicts
│   │   ├── props/               #   always/leadsToWithin/reachable combinators (user-facing DSL)
│   │   ├── overlay/             #   overlay builder API (user-facing)
│   │   ├── report/              #   report + trust-ledger schemas (versioned)
│   │   └── artifacts/           #   .modality/ artifact IO, schema versioning, model hashing
│   │
│   ├── check/                   # modality-ts/check — Spec 03 adapter (Node-only, thin)
│   │   ├── native.ts            #   in-process native-addon binding (request/response marshal)
│   │   ├── types.ts             #   CheckResult/option types exposed to callers
│   │   └── slicing/             #   model slicing preprocessing (cone-of-influence)
│   │                            #   (BFS core, encoders, monitors, traces live in the Rust crate)
│   │
│   ├── extract/                 # TS/TSX → IR/model extraction boundary
│   │   ├── engine/              # modality-ts/extract — Spec 02 engine; Node-only
│   │   │   ├── pipeline/        #   P0–P7 orchestration; owns phase ordering & fixpoints
│   │   │   ├── ts/              #   shared TS-analysis utilities (symbol resolution, JSX walk,
│   │   │   │                    #   call-graph, M0 expression compiler, escape analysis core)
│   │   │   ├── spi/             #   ★ StateSourcePlugin + RouterPlugin interfaces (§4)
│   │   │   └── report/          #   extraction report assembly
│   │   └── sources/             # ★ vertical slices, axis 1: one module per state library (§5)
│   │       ├── use-state/       # modality-ts/extract/sources/use-state
│   │       ├── jotai/           # modality-ts/extract/sources/jotai      (peerDep: jotai)
│   │       ├── swr/             # modality-ts/extract/sources/swr        (peerDep: swr)
│   │       ├── zustand/         # modality-ts/extract/sources/zustand    (peerDep: zustand)
│   │       └── router/          # modality-ts/extract/sources/router     (peerDep: react-router)
│   │
│   ├── cli/                     # `modality` product shell and generated-test runtimes (§6)
│   │   ├── features/            # ★ vertical slices, axis 2: extract/ check/ replay/ conform/
│   │   ├── registry/            #   plugin registry; built-in source registration; config loading
│   │   ├── codegen/             #   app.model.ts + *.replay.test.tsx emitters
│   │   ├── harness/             #   modality-ts/cli/harness — Spec 04 §3 generated-test runtime
│   │   ├── runtime/             #   modality-ts/cli/runtime — Spec 04 §6 dev-build assertions
│   │   ├── types/               #   ambient declaration shims only; not semantic model types
│   │   └── cli.ts               #   thin commander shell (arg parsing only)
│
├── crates/checker/              # ★ the Rust explicit-state checker (Spec 03); built via napi
├── native/                      # generated Node-API addon (modality-checker.<platform>.node) + loader
├── examples/demo-app/           # MVP demo with the three seeded bugs (design §8)
├── tools/                       # dependency-cruiser config (§7), differential-test runner vs TLC
└── docs/
```

> **Implementation note.** Earlier drafts placed the entire checker in `src/check/` as a
> single-threaded TypeScript module. The semantic core now lives in the Rust crate
> `crates/checker` (compiled to the `native/` addon and loaded in-process); `src/check/`
> is a thin TypeScript adapter. The package build compiles Rust before `tsc` (`pnpm
> build:rust` then `tsc -b`), and the platform-specific `.node` artifact ships in the
> published package. This is an implementation move, not a boundary change: `check` still
> depends only on `core` (plus the native addon) and is reached only via `checkModel`.

What is deliberately **not** here: a `utils/` package (utilities live in the slice that needs them until two slices prove the need — then they move to the *narrowest* shared home), and a semantic `types/` package (types live with the code that owns their semantics; cross-cutting types are kernel by definition). The existing `src/cli/types/` directory is limited to ambient declarations for external packages missing local typings; it must not grow domain, IR, report, or plugin types.

## 3. The core/kernel: small by policy, versioned by schema

The physical `src/core/` directory publishes the `modality-ts/core` API. It is the only package-like boundary every other boundary may depend on, so it is governed restrictively:

- **Contents test**: a thing enters the kernel only if ≥2 packages in *different runtime contexts* need it, and it has no dependencies of its own (the kernel depends on nothing but TypeScript).
- **Schema versioning**: `model.json`, `trace.json`, `report.json` carry `schemaVersion`; readers reject newer-major artifacts with a "re-run extract" message. Artifact compatibility *is* the tool's compatibility story, because feature slices communicate through artifacts, not function calls (§6).
- **IR evolution rule** (the flexibility boundary, stated honestly): plugins contribute *instances* of IR constructs — they can never introduce new EffectIR/ExprIR node kinds, because the checker, exporter, and replay generator must understand every construct they receive. A future library whose semantics genuinely don't fit (e.g., websocket subscription streams) requires a kernel RFC and a coordinated minor version across checker/exporter — by design a deliberate event, not a plugin patch. This is the trade for keeping "verified" meaningful: an extensible-semantics IR would let a plugin silently change what the checker's answers mean.

## 4. The `StateSourcePlugin` contract (axis 1 extension point)

Defined in `modality-ts/extract/engine/spi`, consumed by the pipeline, the harness, and conformance. One interface, grouped by pipeline phase; every method receives narrow context objects (never the whole pipeline) so the contract stays implementable out-of-tree:

```ts
interface StateSourcePlugin {
  id: string;                                  // 'jotai' | 'swr' | 'zustand' | ...
  packageNames: string[];                      // npm packages whose imports activate this plugin

  // ── extraction side (Node) ──────────────────────────────────────────────
  discover(ctx: DiscoverCtx): SourceDecl[];    // P1: find state declarations; returns proposed
                                               //     StateVarDecls + per-decl metadata
  domainHints?(decl: SourceDecl, ctx: TypeCtx): AbstractDomain | undefined;
                                               // P2: override generic D(τ) where the library
                                               //     implies structure (e.g. SWR key classes)
  writeChannels(ctx: ChannelCtx): WriteChannel[];
                                               // P5: every API through which this source's state
                                               //     is written (setter symbols, store.set, mutate)
                                               //     — the escape analysis treats anything not
                                               //     declared here as an unknown call (E1-safe:
                                               //     omissions cause taints, not silent misses)
  summarizeWrite?(call: CallSite, ctx: M0Ctx): EffectIR | 'unsupported';
                                               // P4: translate a recognized write call into IR
  template?(decl: SourceDecl, options: ResolvedOptions): TemplateFragment;
                                               // library-behavior model (Spec 01 §9); vars +
                                               //     transitions in plain IR. SWR: yes; Jotai: no
  // ── replay side (jsdom; exported from 'modality-ts/extract/sources/*/harness') ───
  harness: {
    setup(ctx: HarnessCtx): HarnessHooks;      // providers/store creation, handles for observation
    observe(varId: string, handles: HarnessHooks): ObservedRead | 'unobservable';
    witness?(domain: AbstractDomain, varId: string): WitnessFactory | undefined;
  };
  // ── conformance (Node + jsdom) ───────────────────────────────────────────
  conformance?: {
    templateProbes?: ProbeWalk[];              // walks validating template vs real library
    testedVersions: string;                    // semver range checked against the app lockfile
  };
}
```

Design notes on why this shape:

- **The E1 invariant survives plugin authorship errors in only one direction.** `writeChannels` omissions make the escape analysis treat writes as unknown calls → taint → loud over-approximation (Spec 02 §5). A plugin *cannot* cause a silent missed write by under-declaring; it can only cause noise. The one place a plugin can lie dangerously is `summarizeWrite` returning wrong IR — which is exactly what the conformance probes and `modality conform` per-transition pass-rates exist to catch (Spec 04 §5). The contract's safety story is stated in its doc comments, because plugin authors are part of the trusted base and should know it.
- **Extraction/harness split inside one package.** Each source package has two entry points via `exports`: `"."` (Node, may import ts-morph types) and `"./harness"` (jsdom, may import the library itself as a peer dependency). The pipeline loads `"."`; generated tests import `"./harness"`. This keeps heavy static-analysis deps out of test bundles and app-facing deps out of the CLI — enforced by the dependency rules (§7), not convention.
- **Routers are a sibling contract** (`NavigationAdapter` / `RouterPlugin`): they own `sys:route`/`sys:history` semantics, navigation transition synthesis, route discovery, and the harness `MemoryRouter`-equivalent. Optional module-context methods (`classifyModule`, `moduleEntryExports`, `classifyImportEdge`, `isServerOnlyModule`) let adapters describe server/client module boundaries without CLI framework checks. Kept separate from `StateSourcePlugin` because exactly one router is active per app, while state sources compose.
- **Registration**: `modality.config.ts` lists plugins (`plugins: [jotai(), swr(), zustand()]`); built-ins are auto-registered when `packageNames` match the app's dependencies, with config able to disable. Third-party plugins are ordinary npm packages exporting a `StateSourcePlugin`; the registry validates the contract shape at load and stamps plugin id + version into the trust ledger (a plugin is trusted code — the report must say which ones produced the model).

## 5. Source packages as vertical slices (axis 1)

Each source package owns its concern end-to-end — discovery to replay to conformance — so adding a library never fans out across the repo:

```
src/extract/sources/jotai/
├── imports.ts               # Jotai module + alias resolution
├── types.ts                 # internal atom metadata shapes
├── ids.ts                   # store/family-qualified var IDs
├── discover.ts              # P1: atom + utility creators + family instances
├── domains.ts               # P2 classification and domain inference
├── derived-writes.ts        # derived atom write summarization
├── hydration.ts             # useHydrateAtoms initial overrides
├── writes.ts                # P3/P5 channels (useAtom, useSetAtom, useResetAtom,
│                            #   store.set, Provider scoping) + safety warnings
├── plugin.ts                # summarizeWrite hook for cache lifecycle no-ops
├── harness.ts               # store-qualified observation handles
├── transitions.ts           # shared React transition adapter entry
└── index.ts                 # assembles and exports the plugin object
```

The litmus test the architecture must keep passing: **supporting a new library = writing one new package in `src/extract/sources/`, zero diffs elsewhere.** Zustand has since been added exactly this way — a new `src/extract/sources/zustand/` slice with no changes to the SPI, pipeline, shared React extractor, or other plugins — which is the contract's first out-of-the-gate confirmation. Projected mapping for the remaining likely sources, as a design check that the contract is sufficient:

| Source | discover | writeChannels / summarize | template | harness.observe | Verdict |
|---|---|---|---|---|---|
| Zustand | `create()`/`createStore` stores | actions = store methods; `set`/`setState` (incl. immer drafts) | none | store handle, direct | **implemented (built-in)** |
| `useReducer` | hook calls | `dispatch` symbol; reducer body is *good* M0 material (pure, switch-shaped) | none | DOM projection / probe (like `useState`) | fits cleanly |
| TanStack Query | `useQuery/useMutation` | `mutate`, cache APIs | yes — heavier than SWR (mutation lifecycle, retries) | queryClient handle | fits; template effort is the cost |
| XState | explicit machines | n/a — machines *are* transition systems | direct machine→IR import (bypasses M0 entirely — the design.md §8 pivot target drops out of this contract for free) | actor snapshot | fits, easiest of all |
| React Context as state | — | — | — | — | does not fit (writes unanalyzable); stays a documented taint, not a plugin |

## 6. Feature slices (axis 2) and artifact-mediated coupling

Inside `src/cli/`, each user capability is a self-contained slice:

```
src/cli/features/
├── extract/    # orchestrates extraction pipeline + registry → .modality/model.json,
│               #   app.model.ts (via codegen/), extraction report; --explain-drift
├── check/      # loads model + props → modality-ts/check → traces, report rendering,
│               #   replay-test emission (via codegen/)
├── replay/     # runs one generated test file, classifies the Spec 04 §1 verdict
├── conform/    # MBT walks (Spec 04 §5), per-transition pass-rate aggregation
└── export/     # (post-MVP) IR → TLA+/SMV; also used by tools/ differential testing
```

Rules that keep these vertical rather than layered:

- **Slices never import each other.** They communicate only through `.modality/` artifacts (schema-versioned kernel types): `extract` writes `model.json`; `check` reads it and writes `traces/*.json`; `replay` reads a trace. This is the same boundary the CLI user sees, so every feature is independently scriptable and independently testable with fixture artifacts — and a crashed `check` can be re-run without re-extracting. The one current exception is `ci`, which is an orchestration slice and may call the public command wrappers for `check` and `conform`; it still must not reach into sibling feature internals.
- **Each slice owns its full stack**: argument schema, orchestration, rendering (terminal + JSON), and its tests. `cli/` is a dispatch table mapping command names to slice entry points — it contains no logic, so no slice change ever touches it beyond one registration line.
- Shared *mechanisms* used by multiple slices but owned by none (codegen emitters, the plugin registry, config loading) sit beside `features/` as named modules — pulled out only because ≥2 slices demonstrably use them, mirroring the kernel policy at package-internal scale.

## 7. Dependency rules (enforced, not advised)

```
core                 → (nothing)
check                → core (+ the native Rust checker addon in native/)
extract/engine       → core
extract/sources/*    → core, extract/engine(spi only); never each other; never cli features
cli/harness          → core
cli/runtime          → core/props subpath only
cli/features         → everything above (features/* additionally: never each other)
examples/*           → cli, runtime, harness (as a real app would)
```

Enforced by dependency-cruiser in CI (`tools/depcruise.config.cjs`) and focused architecture tests, including the subpath rules (`extract/sources/*` main entry must not import RTL/MSW; `/harness` entries must not import ts-morph), source plugins only importing the public extraction SPI, ambient-only `src/cli/types/`, and the "features don't import features" rule. Violations fail the build — architecture that is only documented decays in months.

Two asymmetries worth stating explicitly:

- `extract/sources/*` depend on extraction's **SPI module only**, not its pipeline — the pipeline calls plugins, never the reverse (standard inversion; keeps plugins implementable out-of-tree against a small, stable surface).
- `runtime` (in the app's dev bundle) must stay dependency-free and kernel-light; it gets the property-combinator types through a dedicated subpath export so bundlers tree-shake everything else. A bloated runtime package is an adoption killer (Spec 04 §6 is the on-ramp feature).

## 8. Testing strategy per slice kind

| Slice kind | Test style | Lives where |
|---|---|---|
| source package | golden extraction snapshots over `fixtures/` mini-apps; harness tests in jsdom; conformance probes against pinned library versions (CI matrix per `testedVersions`) | inside the package |
| checker | the Spec 03 §9 suite: differential vs TLC, metamorphic, oracle models, canonicalization property tests | inside `check`; TLC corpus runner in `tools/` |
| feature slice | artifact-in/artifact-out tests with fixture `model.json`/traces — no TS analysis or React involved | inside the slice |
| cross-cutting | `examples/demo-app` end-to-end: extract → check → replay finds the three seeded bugs (design §8 PoC criteria, automated) | repo-level CI job |

The demo app doubles as the living acceptance test for the *architecture* itself: its CI job is the only place all packages meet, so a dependency-rule breach or contract regression that unit tests miss surfaces there.

## 9. Decisions log (for future re-litigation)

| Decision | Alternative rejected | Why |
|---|---|---|
| Packages per runtime context; slices as folders within | one package per slice everywhere | publishing/bundling constraints are real boundaries; folder-slices keep refactoring cheap where constraints don't differ |
| Source plugins as source slices under `extract/` | folders inside the extraction engine | peer-dependency isolation (jotai/swr never burden the core) and proof the public contract suffices |
| Artifact-mediated feature coupling | in-process pipeline objects | reproducibility, independent re-runs, scriptability; matches the CLI's user model |
| Plugins contribute IR instances, never IR semantics | extensible IR node kinds | preserves the meaning of "verified" across the plugin ecosystem (§3) |
| Built-ins on the public SPI | privileged built-ins | the contract rots the day the first private hook lands |
