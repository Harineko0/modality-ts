# XState v5 Extraction Support

Status: ready for implementation (Cursor Composer 2). Author handoff plan.
Date: 2026-06-15.

This plan adds an XState v5 source plugin to the `extract` module, modeling
`createMachine`/`setup().createMachine` statecharts (bound through
`@xstate/react`) into the existing Transition-System IR. It mirrors the SWR
**library-template** pattern (`src/extract/sources/swr/`), which is the closest
existing precedent: a hand-written `(config) => { vars, transitions }` factory
instantiated per discovered call site.

The four modeling-fidelity decisions below were confirmed with the product owner
(do **not** revisit them without re-asking):

1. **Actor scope** — *single machine per hook*. Model exactly one machine per
   `useMachine` / `useActor` / `createActorContext` binding. Statically-invoked
   **child machines**, `spawn()`, and inter-actor messaging (`sendTo` a sibling,
   `sendParent`, `system`) are **out of scope for v1**: detect and mark
   `unextractable` with an overlay hint. (Invoking **promise/callback/observable**
   actor *logic* — not child machines — is supported; see decision 4.)
2. **Parallel states** — *exact*: one enum state var per region.
3. **History states** — *exact*: a hidden memory var per history node records the
   last active child; history transitions read it.
4. **Time & streams** — *nondeterministic env events*: `after` / delayed
   `sendTo`/`raise`, and callback/observable invoked actors become `env`/`timer`
   transitions that may fire anytime (durations dropped). Promise actors use the
   existing async `enqueue`/`dequeue` CPS pattern (like SWR).

---

## 1. Goal

Add a `StateSourcePlugin` with id `"xstate"` that:

- Discovers XState v5 machine definitions (`createMachine(...)`,
  `setup({...}).createMachine(...)`) and their React bindings (`useMachine`,
  `useActor`, `useActorRef`, `createActorContext`).
- Emits IR state vars for each machine's finite state (top-level + nested +
  parallel regions + history memory) and its context fields.
- Emits IR transitions for events, guarded transitions, entry/exit/transition
  actions (`assign`), eventless `always`, delayed `after`, and `invoke`
  promise actors (`onDone`/`onError`/`onSnapshot`).
- Links `send({type:'E'})` calls inside JSX handlers to `user` transitions with
  locators where resolvable; otherwise emits an always-enabled `library`
  transition for the event (sound over-approximation).
- Surfaces every approximation/unsupported case as an extraction warning,
  consistent with the E1 soundness invariant (Spec 02 §0): over-approximate or
  mark `unextractable`, never silently drop a write to modeled state.

## 2. Non-goals

- **Do not** implement multi-actor systems: no `spawn()`, no invoked **child
  machine** semantics, no `sendTo(sibling)`/`sendParent`/`system` routing. These
  are detected and reported `unextractable`.
- **Do not** add new `AbstractDomain`, `EffectIR`, `ExprIR`, `GuardIR`, or
  `EventLabel` node kinds. The IR is closed (Spec 05 §3 — plugins contribute
  *instances*, not semantics). If a mapping seems to need a new node kind, **stop
  and report** (§11).
- **Do not** model real time/durations. `after(1000)` and `after(5000)` are
  indistinguishable env timers in v1 (decision 4).
- **Do not** modify the checker, exporter, replay generator, or core IR types.
- **Do not** refactor existing source plugins, the pipeline, or the registry
  beyond the single additive registration in §6 Step 8.
- **Do not** edit any existing test, snapshot, or example app's behavior. Add new
  files only.

## 3. Current-state findings

Verified by reading the repo at this commit:

- **Plugin contract**: `src/extract/engine/spi/index.ts` → `StateSourcePlugin`
  (lines 144–167). Required: `id`, `packageNames`, `discover(ctx)`,
  `writeChannels(ctx)`, `harness.setup`/`harness.observe`. Optional:
  `domainHints`, `safetyWarnings`, `extract(ctx)`, `summarizeWrite`,
  `template(decl, options)`, `conformance`.
- **Library-template precedent**: `src/extract/sources/swr/` is the model to
  follow. `plugin.ts` wires `discover`/`template`/`harness`; `discover.ts` parses
  call sites into `SourceDecl[]` carrying `metadata` (including a serialized
  `payloadDomain` and `ExprIR` `activeWhen`); `template.ts` exports
  `createSwrTemplate(options): TemplateFragment` building `{ vars, transitions }`
  with `assign`/`enqueue`/`dequeue` effects and `pending`-guarded `env` resolve
  transitions; `harness.ts` exports `setup`/`observe`/`witness`.
- **Pipeline wiring**: `src/extract/engine/pipeline/index.ts`:
  - line 110–118: `plugin.discover({ sourceText, fileName, route })` per fragment.
  - line 120–126: decls' `var` become `stateVars`.
  - line 150–153: `plugin.template(decl, { route })` → `templateFragments`
    (only invoked when `plugin.template` is defined; emitted decls without a
    `var` are fine — the template supplies vars).
  - line 197–199: `plugin.extract(extractionCtx)` → extra transitions.
  - line 209–210: extracted + template transitions merged.
- **Registration**: `src/cli/registry/index.ts` line 36 —
  `const builtins = [useStateSource(), jotaiSource(), swrSource()];`. Builtins are
  gated by `shouldEnableBuiltin` (line 95) which checks `packageNames` against
  project `dependencies`.
- **Template type**: `src/core/ir/types.ts` line 153 — `TemplateFragment =
  { vars: readonly StateVarDecl[]; transitions: readonly Transition[] }`.
- **IR shapes** (do not change): `AbstractDomain`, `StateVarDecl`, `Transition`,
  `EffectIR`, `ExprIR`, `EventLabel` in `docs/specs/01-ir.md` and
  `src/core/ir/types.ts`.
- **Domain inference helpers** re-exported from the SPI:
  `inferDomainFromTypeNode`, `typeAliasDeclarations`, `firstValue`
  (`src/extract/engine/spi/index.ts` line 13–17), plus `validateValue`,
  `enumerateDomain`, `canonicalJson` from `modality-ts/core`.
- **Architecture rules** (`tools/depcruise.config.cjs`): source slices
  (`src/extract/sources/<name>`) may import only `modality-ts/core`,
  `engine/spi`, `engine/ts`, and `sources/shared`; **may not** import sibling
  source slices, `cli`, `check`, or `engine` internals. A new `sources/xstate`
  folder inherits these rules automatically (pattern-based, no allowlist edit
  needed).
- **Tests** live under `test/sources/<name>/` (e.g.
  `test/sources/swr/swr-template.test.ts`, `test/sources/jotai/jotai-source.test.ts`).
- **No existing XState code**: `rg -i xstate src` returns nothing. This is
  greenfield.

## 4. Exact file paths and symbols

### New files (create)

```
src/extract/sources/xstate/index.ts          // public exports (mirror swr/index.ts)
src/extract/sources/xstate/plugin.ts          // xstateSource(): StateSourcePlugin
src/extract/sources/xstate/config.ts          // parse machine config AST -> MachineConfigIR
src/extract/sources/xstate/discover.ts         // find createMachine/useMachine -> SourceDecl[]
src/extract/sources/xstate/domains.ts          // context-field + event domain inference
src/extract/sources/xstate/template.ts         // createXStateTemplate(opts): TemplateFragment
src/extract/sources/xstate/sends.ts            // link send()/JSX handlers -> event labels (extract hook)
src/extract/sources/xstate/harness.ts          // setup/observe/witness
src/extract/sources/xstate/types.ts            // MachineConfigIR, StateNodeIR, XStateTemplateOptions
test/sources/xstate/xstate-config.test.ts      // config parser unit tests
test/sources/xstate/xstate-template.test.ts    // template -> IR transition/var tests
test/sources/xstate/xstate-source.test.ts      // end-to-end discover+template+warnings
test/sources/xstate/fixtures/*.tsx             // sample machines (toggle, fetch, hierarchical, parallel, history)
```

### Existing files (edit — additive only)

```
src/cli/registry/index.ts                      // import + add xstateSource() to builtins (Step 8)
docs/specs/02-extraction.md                    // §9 "Library templates": add XState paragraph (Step 9)
```

Relevant existing symbols to reuse (import, do not copy):

- `StateSourcePlugin`, `SourceDecl`, `WriteChannel`, `ExtractionWarning`,
  `DiscoverCtx`, `ExtractCtx`, `ResolvedOptions`, `TemplateFragment`,
  `inferDomainFromTypeNode`, `typeAliasDeclarations`, `firstValue` — from
  `modality-ts/extract/engine/spi`.
- `AbstractDomain`, `ExprIR`, `EffectIR`, `Transition`, `StateVarDecl`, `Value`,
  `enumerateDomain`, `validateValue`, `canonicalJson` — from `modality-ts/core`.

## 5. Existing patterns to follow

- **Plugin shape**: copy the structure of `src/extract/sources/swr/plugin.ts`
  (factory returning the object literal; `conformance.testedVersions`).
- **AST parsing**: use `ts.createSourceFile(fileName, text, ScriptTarget.Latest,
  true, ScriptKind.TSX)` and a recursive `visit` walker, exactly as
  `swr/discover.ts` and `use-state/index.ts` do. Resolve imported names through
  import aliases (see `useSwrImportNames` in `swr/discover.ts`) — match `xstate`
  and `@xstate/react` specifiers, not bare callee names.
- **Decl metadata carrying serialized IR**: SWR stores `payloadDomain` (an
  `AbstractDomain` cast to `Value`) and `activeWhen` (an `ExprIR`) in
  `decl.metadata`; `template.ts` reads them back with type guards
  (`isDomain`/`isExpr`). Follow the same serialize-in-discover /
  rehydrate-in-template pattern so `discover` stays AST-only and `template` stays
  IR-only.
- **Transition construction**: copy idioms from `swr/template.ts` — `lit()`,
  `pendingIs(op)`, `exprReadList(expr)`, `enqueue`/`dequeue` for async,
  `enumerateDomain(domain).map(...)` to fan a resolve over outcome values, and
  always set explicit `reads`/`writes` that over-approximate the effect (Spec 01
  §7.2).
- **Var ids & scoping**: follow the `<plugin>:<id>:<field>` convention
  (`swrVarId`). Use `origin: "library-template"` for template-supplied vars and
  `scope: { kind: "global" }` (machines created at module scope) or
  `{ kind: "route-local", route }` when the machine is created inside a
  route-local component via `useMachine` (mirror the `use-state` route-local
  decision in `use-state/index.ts`).
- **Stabilization for `always`/entry actions**: emit `internal` transitions with
  the existing semantics (Spec 01 §5) — set `cls: "internal"`; the checker's
  macro-step loop runs them to completion. Do **not** invent a new class.

## 6. Atomic implementation steps

Each step is independently compilable (`pnpm typecheck`) and testable. Keep diffs
minimal; do not touch unrelated code.

### Step 1 — Types (`types.ts`)

Define the internal parsed-machine IR (plain data, no `ts` nodes leaking out):

```ts
export interface MachineConfigIR {
  machineId: string;              // from config `id` or a stable hash of the var name
  initial: string;                // initial state key (top region)
  type?: "parallel";              // top-level parallel marker
  context: Record<string, AbstractDomain>;  // field -> domain (D(TContext))
  contextInitial: Record<string, Value>;
  states: Record<string, StateNodeIR>;
  warnings: ParseWarning[];       // unsupported constructs found while parsing
}

export interface StateNodeIR {
  key: string;
  kind: "atomic" | "compound" | "parallel" | "final" | "history";
  initial?: string;               // compound/parallel
  history?: "shallow" | "deep";   // history nodes
  states?: Record<string, StateNodeIR>;
  entry?: ActionIR[];
  exit?: ActionIR[];
  on?: Record<string, EventTransitionIR[]>;  // event type -> candidate transitions
  always?: EventTransitionIR[];
  after?: EventTransitionIR[];    // delay value dropped; ordering nondeterministic
  invoke?: InvokeIR[];
}

export interface EventTransitionIR {
  target?: string;                // resolved leaf/relative target
  guardExpr?: ExprIR;             // null => unguarded
  actions: ActionIR[];
  internal: boolean;              // targetless or {internal:true} => no entry/exit re-run
  unsupportedGuard?: boolean;     // guard not M0-expressible -> over-approx
}

export type ActionIR =
  | { kind: "assign"; field: string; expr: ExprIR | "havoc" }
  | { kind: "raise"; event: string }
  | { kind: "unsupported"; reason: string };  // sendTo/sendParent/spawn/log/etc.

export interface InvokeIR {
  id: string;
  logic: "promise" | "callback" | "observable" | "machine" | "unknown";
  onDone?: EventTransitionIR[];
  onError?: EventTransitionIR[];
  onSnapshot?: EventTransitionIR[];
  payloadDomain: AbstractDomain;  // D(promise/observable result type) or tokens(1)
}

export interface XStateTemplateOptions {
  machine: MachineConfigIR;
  eventLabels: Record<string, readonly EventLabelBinding[]>; // from sends.ts
  route: string;
  sourceFile?: string;
  scope: "global" | "route-local";
}
```

(`ParseWarning`, `EventLabelBinding` are small local interfaces — define them here
too.)

**Files:** `src/extract/sources/xstate/types.ts`.

### Step 2 — Config parser (`config.ts`)

`parseMachineConfig(callExpr, source, typeAliases): MachineConfigIR`.

- Accept both `createMachine({...})` and `setup({ types, actions, guards, actors
  }).createMachine({...})`. When `setup(...)` is used, resolve named
  actions/guards/actors referenced by string in the config to their `setup`
  definitions.
- Recursively walk `states`, classifying each node (`atomic`/`compound`/
  `parallel`/`final`/`history` via `type`/`history`/presence of `states`).
- Parse `on`, `always`, `after`, `invoke`, `entry`, `exit`.
- **Guards**: reuse the M0 condition translator pattern from
  `swr/discover.ts` `exprFromCondition` (identifiers, `===`/`!==` vs literals,
  `!`, `&&`/`||`). Add `and([...])`/`or([...])`/`not(g)`/`stateIn('s')` →
  `ExprIR` (`stateIn` reads the relevant state var: `eq(read state-var, 'S')`).
  Anything else → `unsupportedGuard: true` (guard becomes `true`, condition
  pushed into effect `if` with identity else — Spec 01 §3.1).
- **Actions**: `assign({...})` where each field maps to an M0 expression over
  `context`/`event` → `ActionIR{assign, expr}`; non-M0 RHS (arithmetic, calls) →
  `expr: "havoc"`. `raise` → `ActionIR{raise}`. `sendTo`/`sendParent`/`spawnChild`/
  `enqueueActions`/`log`/`cancel`/`stopChild` → `ActionIR{unsupported}` + a
  ParseWarning (and, for `sendTo`-sibling/`sendParent`/`spawn`, mark the whole
  machine `unsupported` per decision 1 — see Step 7).
- **Targets**: resolve relative/absolute (`'#id.state'`, `'.child'`, `'sibling'`)
  to the canonical region+leaf addressing used by the var scheme (Step 4). Keep a
  helper `resolveTarget(node, raw)`.
- Collect every unhandled construct into `warnings` rather than throwing.

**Files:** `src/extract/sources/xstate/config.ts`, reading `types.ts`.

### Step 3 — Domain inference (`domains.ts`)

- `inferContextDomains(typeArg | contextInitializer, typeAliases)`: derive
  `D(TContext)` field-by-field. Prefer the `types: {} as { context: ... }` type
  argument (XState v5 `setup`) via `inferDomainFromTypeNode`; fall back to the
  `context` initializer literal using the same literal→domain rules as
  `use-state/index.ts` `inferUseStateDomain` (`true/false`→bool, string→enum,
  number→`boundedInt[n,n]` only as an initial witness but **default numeric
  fields to `tokens(1)`** per Spec 01 §1 — never infer `boundedInt` from a
  `number` type).
- `inferEventPayloadDomain` / `inferInvokeResultDomain`: `D(return type)` of the
  invoked promise/observable, else `tokens(1)`.
- The set of state keys per region → `enum` domain values; add `"final"` leaf
  keys as enum members.

**Files:** `src/extract/sources/xstate/domains.ts`.

### Step 4 — State var scheme + template (`template.ts`)

`createXStateTemplate(options: XStateTemplateOptions): TemplateFragment`.

Var id scheme (stable, canonical):

- Top atomic/compound region: `xstate:<machineId>:state` (enum of that region's
  child keys). Compound children that are themselves compound get a nested region
  var `xstate:<machineId>:<path>:state`, **only materialized when the parent is in
  the owning state** (use `⊥`-style: include an explicit `"#inactive"` enum member
  so the var is total; a region var holds `"#inactive"` while its parent state is
  not active — mirrors the route-local `⊥` idea in Spec 01 §2 without new IR).
- Parallel regions (decision 2): one `...:<region>:state` enum var per region,
  all active simultaneously when the parallel parent is active.
- History (decision 3): `xstate:<machineId>:<path>:history` enum var (same domain
  as the region it remembers) updated on every exit of that region; the history
  transition's target reads it (`assign region := read history`).
- Context: `xstate:<machineId>:ctx:<field>` with the inferred domain.

Transition generation per state node:

- **`on[E]` candidates**: for each source leaf state S that handles E, emit one
  transition per candidate (first-match order encoded as guard conjunction with
  the negation of earlier candidates' guards — preserve XState's
  first-enabled-wins by `and(thisGuard, not(or(earlierGuards)))`). Guard also
  includes `eq(state-var, S)`. Effect = exit actions of left states (external
  transitions only) ⨾ transition actions ⨾ entry actions of entered states ⨾
  state-var `assign`(s) ⨾ history updates. Classify:
  - if `eventLabels[E]` has bindings → emit one `user` transition **per binding**
    (each with that binding's `EventLabel` locator); 
  - else → one `library` transition, `label: { kind: "internal", text: "send "+E }`,
    guard unchanged (always enabled when in S — over-approx, reported).
- **`always`**: `cls: "internal"` transition; guard = source-state ∧ candidate
  guard; participates in stabilization (Spec 01 §5). 
- **`after`** (decision 4): `cls: "env"`, `label: { kind: "timer", key:
  <machineId>:<state>:<i> }`, guard = source-state ∧ candidate guard, always
  fireable; duration ignored.
- **`invoke` promise** (decision 4): on entering the invoking state, `enqueue(op,
  continuation, args)` where `op = <machineId>:<state>:<invokeId>`; emit `env`
  resolve transitions guarded by `pendingIs(op)` that `dequeue` then apply
  `onDone` (fanned over `enumerateDomain(payloadDomain)`) / `onError` candidates —
  copy `successTransitions`/`resolve:error` from `swr/template.ts`. `onSnapshot`
  (observable) → `env` emit transition that may fire repeatedly while in-state.
- **`invoke` callback/observable** (decision 4): `env` transition(s) emitting the
  declared events nondeterministically while the state is active.
- **`invoke` machine** (decision 1): do **not** expand. Emit a ParseWarning and an
  always-enabled `env` `onDone`/`onError` resolve over a havoc'd payload so
  outgoing transitions are not lost (over-approx), and add the machine to the
  trust-ledger `unextractable`-adjacent list via a warning.

Every transition: explicit `reads`/`writes` (state vars touched + ctx fields
assigned + `sys:pending` for async), and `confidence`:
`"exact"` when all actions/guards were M0 and no unsupported construct was hit on
that path; otherwise `"over-approx"`.

**Files:** `src/extract/sources/xstate/template.ts`, reading `types.ts`,
`domains.ts`. Export `createXStateTemplate`, `xstateStateVarId`,
`xstateCtxVarId`, and an `xstateView(state, machineId)` helper (mirror `swrView`)
returning `{ value, matches(path), context }` so property predicates read the
same projection the component reads via `state.matches(...)`/`snapshot.context`.

### Step 5 — Send/JSX linking (`sends.ts`, the `extract` hook)

`linkSends(ctx: ExtractCtx): { labels, warnings }` — find, within modeled
components, JSX event props whose handler calls the machine's `send(...)`
(resolved from `useMachine`/`useActor`/`useActorRef` tuples or
`SomeContext.useActorRef()`):

- `send({ type: 'E', ... })` or `send('E')` → bind event `E` to the enclosing
  intrinsic element's `EventLabel` (reuse the existing JSX locator extraction —
  `data-testid` / role+name — from `engine/ts`; import via the SPI surface, do
  **not** reach into engine internals). Follow Spec 02 §4 resolution rules
  (inline arrow, identifier decl, one level of prop drilling); deeper → warning,
  event falls back to the `library` always-enabled transition.
- Multiple distinct send sites for the same `E` → multiple bindings (one user
  transition each), exactly the SWR/handler multi-pass rule.

This data is passed into the template via `XStateTemplateOptions.eventLabels`.
Implement `linkSends` as the plugin's `extract(ctx)` returning `{ transitions: []
}` but stashing labels — **or** simpler: compute labels inside `discover` and put
them in `decl.metadata`, then `template` reads them (preferred: keeps the pipeline
ordering trivial, matches SWR's metadata pattern). Pick the metadata route unless
locator extraction needs the full `ExtractCtx` (route patterns) — if it does, use
`extract`. **Stop and report** if neither path can see JSX (it can:
`discover` receives `sourceText`).

**Files:** `src/extract/sources/xstate/sends.ts`.

### Step 6 — Discover (`discover.ts`)

`discoverXStateMachines(sourceText, fileName, route): SourceDecl[]`:

- Resolve `createMachine`/`setup` import names from `xstate`, and
  `useMachine`/`useActor`/`useActorRef`/`createActorContext` from `@xstate/react`.
- For each machine bound to a hook/context, build `MachineConfigIR` (Step 2),
  compute domains (Step 3), event labels (Step 5), and emit a single `SourceDecl`:
  `{ id: "xstate:"+machineId, kind: "xstate/machine", origin, metadata: {
  machineConfig, eventLabels, scope } }` with `machineConfig`/`eventLabels`
  serialized as `Value` (plain JSON — they already are, by construction).
- Module-scope machines never bound to React (library-only) are still emitted with
  `scope: "global"` and no event labels (all events become `library`
  always-enabled — over-approx) plus a warning.

`writeChannels`: return `[]` — XState state is written only through `send`, which
this plugin models internally as transitions, not as setter symbols the escape
analysis must track. (Confirm: there is no setter symbol to taint; `send` does not
write modeled non-XState vars.) Add a code comment explaining why it is empty so a
future reader does not think it is a stub.

**Files:** `src/extract/sources/xstate/discover.ts`.

### Step 7 — Plugin + harness + index

- `plugin.ts`: `xstateSource(): StateSourcePlugin` with
  `id: "xstate"`, `version: "0.1.0"`,
  `packageNames: ["xstate", "@xstate/react"]`,
  `discover`, `writeChannels` (empty), `template` (calls `createXStateTemplate`
  rehydrating from `decl.metadata`), `safetyWarnings` (surface parse warnings +
  the decision-1 `unsupported` machines), `harness`, and
  `conformance: { testedVersions: "xstate>=5 @xstate/react>=4" }`.
- `harness.ts`: `setup(ctx)` returns `{ initialState }`; `observe(varId, handles)`
  reads from a provided snapshot map (state-var → value) — copy the shape of
  `swr/harness.ts`; `witness` returns `undefined` for v1.
- `index.ts`: re-export `xstateSource`/`default`, `createXStateTemplate`,
  `xstateView`, var-id helpers, and option/type interfaces (mirror
  `swr/index.ts`).

**Files:** `plugin.ts`, `harness.ts`, `index.ts`.

### Step 8 — Registry registration (the only product edit)

In `src/cli/registry/index.ts`:
- Add `import { xstateSource } from "modality-ts/extract/sources/xstate";`
  (alongside line 6–9).
- Change line 36 to
  `const builtins = [useStateSource(), jotaiSource(), swrSource(), xstateSource()];`.

Gating is automatic via `shouldEnableBuiltin` (it activates only when `xstate` or
`@xstate/react` is a project dependency). **Do not** change `validate*` or any
other registry logic.

### Step 9 — Spec note

Append one paragraph to `docs/specs/02-extraction.md` §9 (Library templates) and a
row to the §11 "Known hard cases" table:
`| XState child machines / spawn / inter-actor messaging | out of scope v1
(detected, machine reported unextractable) |`. Keep it short; do not restructure
the doc.

## 7. Per-step → files to edit

| Step | Create | Edit |
|---|---|---|
| 1 | `xstate/types.ts` | — |
| 2 | `xstate/config.ts` | — |
| 3 | `xstate/domains.ts` | — |
| 4 | `xstate/template.ts` | — |
| 5 | `xstate/sends.ts` | — |
| 6 | `xstate/discover.ts` | — |
| 7 | `xstate/plugin.ts`, `xstate/harness.ts`, `xstate/index.ts` | — |
| 8 | — | `src/cli/registry/index.ts` |
| 9 | — | `docs/specs/02-extraction.md` |
| tests | `test/sources/xstate/*.test.ts`, `fixtures/*.tsx` | — |

## 8. Acceptance criteria

1. A `createMachine` toggle (`inactive`/`active`, event `TOGGLE`) bound via
   `useMachine` with a `<button onClick={() => send({type:'TOGGLE'})}>` yields:
   one enum var `xstate:<id>:state` with values `["inactive","active"]`, initial
   `"inactive"`; two `user` transitions (TOGGLE from each state) with the button's
   locator; `confidence: "exact"`.
2. A machine with `context: { count: 0 }` and `assign({ count: ({context}) =>
   context.count + 1 })` yields a `tokens`/`boundedInt`-defaulted ctx var written
   with `havoc` (arithmetic not M0) and `confidence: "over-approx"`, plus a
   warning naming the field.
3. A `invoke` promise (`src: fromPromise`, `onDone`→`success`, `onError`→`failure`)
   yields `enqueue`/`dequeue` `env` resolve transitions guarded by `pendingIs`,
   structurally matching the SWR resolve pattern (assert on transition `cls`,
   `label.kind === "resolve"`, and `sys:pending` reads/writes).
4. A hierarchical machine produces nested region vars with an `"#inactive"` member;
   a parallel machine produces one enum var **per region**; a history node produces
   a `:history` memory var that the history transition reads.
5. `after(1000)` produces an `env` transition with `label.kind === "timer"` and no
   reference to `1000`.
6. A machine using `sendParent`/`spawn`/invoked child machine is reported via
   `safetyWarnings` and its affected transitions are `over-approx`/flagged; no
   crash, no silently-dropped event.
7. Registry: with `xstate` in dependencies, `createBuiltinModalityRegistry`
   includes a plugin with `id: "xstate"`; without it, it does not.
8. `pnpm typecheck`, `pnpm test`, `pnpm architecture`, and `pnpm fix` (no diff)
   all pass. No existing test changes.

## 9. Tests to add or update

Add only (no edits to existing tests):

- `test/sources/xstate/xstate-config.test.ts`: parser unit tests — state
  classification, guard `and/or/not/stateIn` → `ExprIR`, `assign` M0 vs havoc,
  unsupported-action warnings, target resolution.
- `test/sources/xstate/xstate-template.test.ts`: `createXStateTemplate` →
  vars/transitions for toggle, context-assign, invoke-promise, hierarchical,
  parallel, history, `always`, `after`. Assert var ids/domains/initials and
  transition `cls`/`guard`/`effect`/`reads`/`writes`/`confidence`.
- `test/sources/xstate/xstate-source.test.ts`: end-to-end `discoverXStateMachines`
  + plugin `template` on `.tsx` fixtures incl. `useMachine` send-linking →
  `user` transitions with locators; library-only machine → `library`
  transitions; decision-1 machine → warnings.
- `test/sources/xstate/fixtures/`: `toggle.tsx`, `fetch-promise.tsx`,
  `hierarchical.tsx`, `parallel.tsx`, `history.tsx`, `unsupported-spawn.tsx`.
- Registry: add a case to `src/cli/registry/index.test.ts` **only if** an
  existing pattern there is additive (it currently constructs registries with
  `sourcePlugins: []`); prefer a fresh assertion in the xstate source test that
  calls `createBuiltinModalityRegistry({ dependencies: { xstate: "^5" } })` rather
  than editing the existing registry test.

## 10. Verification commands

Run in order; all must pass:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm fix            # then: git diff --quiet  (no formatting drift)
rtk pnpm phase7         # semantics-sensitive: confirm no differential regression
```

Targeted during development:

```bash
rtk pnpm vitest run test/sources/xstate
```

## 11. Risks, ambiguities, and stop conditions

- **STOP and report** if any XState→IR mapping appears to require a new
  `AbstractDomain`/`EffectIR`/`ExprIR`/`EventLabel` kind. The IR is closed
  (Spec 05 §3); the correct move is over-approximation (`havoc`/`choose`/always-
  enabled transition) + a warning, not an IR change. If over-approximation is
  genuinely impossible for a construct, mark the machine `unextractable` and
  report — do not extend core types.
- **STOP and report** if `tools/depcruise.config.cjs` flags a forbidden import
  from `sources/xstate` (it should not — the slice rules are pattern-based and
  permit `core` + `engine/spi` + `engine/ts` + `sources/shared`). If JSX locator
  extraction is only reachable through `engine/ts` internals **not** re-exported
  by the SPI, surface a request to widen the SPI re-export rather than importing
  engine internals.
- **Ambiguity — state-config var explosion**: nested-region vars with an
  `"#inactive"` member keep the IR closed but enlarge the vector. If a real
  fixture's state space becomes impractical, report the count; do **not**
  unilaterally switch to a single flattened leaf enum (it loses parallel-region
  fidelity confirmed in decision 2).
- **Ambiguity — first-match guard encoding**: XState picks the first enabled `on`
  candidate; the plan encodes this as `and(guard_i, not(or(guard_<i)))`. If
  earlier guards are non-M0 (`unsupportedGuard`), their negation is not
  expressible → fall back to nondeterministic `choose` among candidates
  (over-approx, reported). Confirm this is acceptable in the template tests; do
  not silently pick one branch.
- **Ambiguity — send resolution depth**: matches Spec 02 §4 (one level of prop
  drilling). Deeper drilling → event downgrades to a `library` always-enabled
  transition with a warning. Do not extend the depth without asking.
- **Assumption — `writeChannels` is empty**: predicated on XState state being
  unreachable except via `send` (modeled internally). If a fixture shows
  `assign` writing a **non-XState** modeled var (e.g. a `useState` setter called
  from an action), that is out of the supported channel set — report it; do not
  silently model it.
- **Version**: targets XState **v5** / `@xstate/react` v4+ only. v4 `Machine`/
  `interpret`/`useService` APIs are out of scope; detect and warn.
