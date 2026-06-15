# Plan: Zustand source plugin for the extract module

## 1. Goal

Add a first-class **Zustand** state-source plugin to the extract module, mirroring the
existing `jotai` plugin, so that `modality extract` discovers Zustand stores, their state
fields, read channels, and action-driven write transitions (`set(...)` effects).

Support every Zustand feature that does **not** require the user to install a third-party
library at runtime:

- Store creators: `create` (`zustand`, `zustand/react`) and `createStore`
  (`zustand`, `zustand/vanilla`), both the curried `create<T>()(creator)` and direct
  `create(creator)` forms.
- The state-creator callback `(set, get, store) => ({ ...state, ...actions })`: non-function
  fields become state vars; function fields become actions whose `set(...)` bodies lower to
  `EffectIR` write transitions.
- `set` merge semantics: shallow partial merge by default; `set(partial, true)` replace form.
- `get()` reads inside action bodies and selectors.
- React read surfaces: `useStore(s => s.field)` selectors, `useStore.getState()`,
  `store.getState()`, direct `useStore.setState(...)` / `store.setState(...)`.
- Middlewares: `persist`, `combine`, `redux`, `subscribeWithSelector`, `devtools` — unwrapped
  to their inner state creator / initial state — and `immer`
  (`zustand/middleware/immer`), which changes `set` to **draft-mutation** semantics: action
  bodies mutate a draft (`state.count += 1`, `state.x = v`, `state.obj.k = v`) instead of
  returning a partial. These draft mutations must be lowered to `EffectIR` assignments.

## 2. Non-goals

- **immer is in scope** (see Step 5b), but only for **statically analyzable scalar/object
  draft mutations** (`state.f = expr`, `state.f += expr`, `state.a.b = expr`). Container
  mutations whose result is not statically determinable (`state.list.push(x)`,
  `.splice`, `.sort`, dynamic index writes, `Object.assign(state, ...)`) are lowered
  best-effort or marked over-approx with a warning — **not** silently dropped.
- Do **not** model `persist` storage backends, migrations, `merge`, `partialize`,
  `onRehydrateStorage`, or rehydration timing — `persist` is unwrapped only to find the
  inner creator; persisted fields get a storage-provenance note + an SSR-safety warning
  (mirror jotai `atomWithStorage`).
- Do **not** model `devtools` time-travel or Redux DevTools integration — treat the wrapper
  as semantically transparent (unwrap inner creator only).
- Do **not** deeply model arbitrary `redux` reducers beyond static `switch (action.type)`
  return-object cases (see Step 6 and stop conditions).
- Do **not** modify the plugin SPI (`src/extract/engine/spi/index.ts`), the extraction
  pipeline (`src/extract/engine/pipeline/index.ts`), the shared react extractor, or the
  existing `jotai` / `swr` / `use-state` / `router` plugins.
- Do **not** change machine model schema, checker, CLI output, or codegen.
- No new runtime dependencies in `package.json`. `typescript` is already available.

## 3. Current-state findings

- Source plugins live under `src/extract/sources/<id>/` and implement
  `StateSourcePlugin` from `src/extract/engine/spi/index.ts` (lines 144-167):
  required `id`, `packageNames`, `discover`, `writeChannels`, `harness.{setup,observe}`;
  optional `version`, `domainHints`, `safetyWarnings`, `extract`, `summarizeWrite`,
  `template`, `conformance`.
- **Jotai is the closest analog** and the template to follow. Its file layout
  (`src/extract/sources/jotai/`): `imports.ts`, `ids.ts`, `domains.ts`, `discover.ts`,
  `writes.ts`, `transitions.ts`, `harness.ts`, `types.ts`, `plugin.ts`, `index.ts`
  (+ `derived-writes.ts`, `hydration.ts`, `stores.ts`, `jsx.ts` for jotai-specific concerns).
- **Plugin registration**: `src/cli/registry/index.ts:36` —
  `const builtins = [useStateSource(), jotaiSource(), swrSource()];`. Plugins are
  dependency-gated by `shouldEnableBuiltin` (registry `index.ts:95-103`) against the app's
  `package.json` deps via `packageNames`.
- **Discovery → vars/channels flow** (`src/extract/engine/pipeline/index.ts`):
  - `runExtractionPipeline` calls each `plugin.discover(...)` (lines 110-119) to collect
    `decl.var` → `stateVars`.
  - calls each `plugin.writeChannels(...)` (lines 128-140) → `writeChannels`.
  - calls each `plugin.safetyWarnings?(...)` (141-149).
  - runs the **generic** `extractReactSourceTransitions` (182-196) over the source, fed
    `stateVars`, `writeChannels`, `sourcePlugins` (so `summarizeWrite` is consulted), then
    appends `plugin.extract?.(extractionCtx)` results (197-214).
- **Action-body effects (`setterFixedEffects`)**: the generic pipeline path does **not**
  pass `setterFixedEffects`. Neither jotai nor swr implement the pipeline `plugin.extract`
  hook. Instead each ships a standalone skeleton extractor that wires fixed effects:
  - `src/extract/sources/jotai/transitions.ts` → `extractJotaiSkeleton(...)` calls
    `extractSharedReactTransitions({ ..., setterFixedEffects, resettableVarIds })`
    (`jotai/transitions.ts:61-74`).
  - `extractSharedReactTransitions` lives in
    `src/extract/sources/shared/react-transition-extract.ts`.
  - `extractReactSourceTransitions`
    (`src/extract/engine/ts/react-source-transitions.ts:104`) binds a channel's
    `symbolName` to `binding.fixedEffect` when
    `options.setterFixedEffects?.get(channel.symbolName)` exists (lines 174-187).
  - `pluginWriteTransition` (`src/extract/engine/ts/transition/plugin-calls.ts:15-71`) is the
    other path: it builds a `CallSite` and calls `plugin.summarizeWrite(callSite, ctx)` for
    JSX-handler calls.
- **`SetterBinding`** (`src/extract/engine/ts/types.ts:11-18`) carries optional
  `fixedEffect?: EffectIR`.
- **Domain/initial inference helpers** are re-exported from the SPI:
  `firstValue`, `inferDomainFromTypeNode`, `typeAliasDeclarations`
  (`spi/index.ts:13-17`, originally `src/extract/engine/ts/domains.ts`). Jotai uses these in
  `src/extract/sources/jotai/domains.ts`.
- **Harness pattern**: `src/extract/sources/jotai/harness.ts` — `setup` stashes handles,
  `observe(varId, handles)` reads via `store.get(atom)` or falls back to
  `initialState[varId]`.
- **EffectIR / write-body lowering pattern**: `src/extract/sources/jotai/derived-writes.ts`
  `summarizeDerivedWriteBody(writeFn, { atomNames })` returns `EffectIR | "unsupported"` by
  walking a write function body — the closest model for lowering a Zustand action body's
  `set(...)` calls.
- **Tests** live under `test/sources/<id>/` (e.g. `test/sources/jotai/jotai-source.test.ts`)
  and import from the package entry `modality-ts/extract/sources/jotai` plus the harness file
  directly.
- **Core IR types** (`EffectIR`, `ExprIR`, `StateVarDecl`, `AbstractDomain`, `Value`,
  `Transition`) come from `modality-ts/core`; effect helpers `effectReads`/`effectWrites`
  are used in `plugin-calls.ts`.

## 4. Exact file paths and relevant symbols

New folder `src/extract/sources/zustand/` (mirror jotai), with:

- `imports.ts` — `ZUSTAND_MODULES`, `STORE_CREATOR_SYMBOLS`, `MIDDLEWARE_SYMBOLS`,
  `HOOK_SYMBOLS`, `resolveZustandImports(source)`, `isStoreCreatorCall`,
  `storeCreatorName`, `moduleSpecifierText`.
- `ids.ts` — `storeVarId(storeName, field)`, `fieldFromVarId`, `storeNameFromVarId`
  (varId scheme `zustand:<storeName>.<field>`), `safeId` reuse.
- `domains.ts` — `inferFieldDomain(initializer, typeNode?)` → `{ domain, initial }` using
  `inferDomainFromTypeNode` / `firstValue` / `literalValue`.
- `discover.ts` — `discoverZustandStoresDetailed(sourceText, fileName)` →
  `{ decls, warnings, storeNames, storeFields, storeActions, middlewareUsed }`;
  `discoverZustandStores(...)` thin wrapper returning `decls`.
- `effects.ts` (zustand-local; analogous to jotai `derived-writes.ts`) —
  `lowerActionBody(actionFn, { storeName, fieldVarIds }) : EffectIR | "unsupported"` and
  `lowerSetCall(call, ctx)`.
- `writes.ts` — `discoverZustandWriteChannels(sourceText, fileName)`,
  `discoverZustandWritesDetailed(...)` →
  `{ channels, warnings, setterFixedEffects, resettableVarIds }`.
- `transitions.ts` — `extractZustandSkeleton(sourceText, options)` calling
  `extractSharedReactTransitions({ ..., setterFixedEffects, resettableVarIds })`.
- `harness.ts` — `setup`, `observe`, `witness` (clone jotai shape; observe via
  `store.getState()[field]` and `initialState[varId]` fallback).
- `types.ts` — `ZustandStoreMetadata`, `metadataToRecord`/`metadataFromRecord`.
- `plugin.ts` — `zustandSource(): StateSourcePlugin` with `id: "zustand"`,
  `packageNames: ["zustand"]`, `discover`, `writeChannels`, `safetyWarnings`,
  `summarizeWrite`, `harness`, `conformance: { testedVersions: "zustand>=4" }`;
  `export default zustandSource`.
- `index.ts` — re-export `zustandSource`, `default`, `extractZustandSkeleton`, and its
  options type (mirror `jotai/index.ts`).

Edit:

- `src/cli/registry/index.ts` — import `zustandSource` and add to `builtins`.

Tests:

- `test/sources/zustand/zustand-source.test.ts` (new).

## 5. Existing patterns to follow

- **Import resolution**: copy the structure of
  `src/extract/sources/jotai/imports.ts` (`resolveJotaiImports`): scan `import` declarations,
  match module specifier against a module set, map local→imported names for creators,
  hooks, middlewares.
- **Discovery walk**: copy `discoverJotaiAtomsDetailed`
  (`jotai/discover.ts:37-196`) AST-visitor style; emit `SourceDecl` with
  `{ id, kind: "zustand/state", var, origin, metadata }`.
- **Write-body → EffectIR**: model `lowerActionBody` on
  `summarizeDerivedWriteBody` (`jotai/derived-writes.ts`) and the `assign`/`seq` effect
  shapes; use `callArgumentValue` semantics from
  `src/extract/engine/ts/transition/plugin-calls.ts:73-88` for argument literalization.
- **Fixed-effect wiring**: copy `extractJotaiSkeleton`
  (`jotai/transitions.ts`) — build `vars`, `writeChannels`, `setterFixedEffects`,
  `resettableVarIds`, then call `extractSharedReactTransitions`.
- **Harness**: copy `jotai/harness.ts` verbatim in shape; swap atom/store lookup for
  `store.getState()[field]`.
- **Plugin object**: copy `jotai/plugin.ts` shape.
- **Anchor/`SourceAnchor`** helper: copy the `anchor(source, fileName, node)` helper used in
  `jotai/discover.ts:222-229`.
- Style: 2-space indent, double quotes, semicolons, `.js` NodeNext import suffixes,
  `import * as ts from "typescript"`, kebab-case folder name (`zustand`), `camelCase`
  functions, `PascalCase` types.

## 6. Atomic implementation steps

> Each step must keep `pnpm typecheck` green. Land steps in order.

### Step 1 — Scaffold + registration (discovery returns empty)

- Create `src/extract/sources/zustand/imports.ts` with module sets and
  `resolveZustandImports`:
  - `ZUSTAND_CORE_MODULES = { "zustand", "zustand/react", "zustand/vanilla" }`
  - `ZUSTAND_MIDDLEWARE_MODULES = { "zustand/middleware", "zustand/middleware/immer" }`
  - `STORE_CREATOR_SYMBOLS = { "create", "createStore" }`
  - `MIDDLEWARE_SYMBOLS = { "persist", "combine", "redux", "subscribeWithSelector",
    "devtools", "immer" }`; track which middleware wraps each store so `immer`-wrapped
    actions use draft-mutation lowering (Step 5b).
  - `HOOK_SYMBOLS` not needed (Zustand hooks are the returned `useStore` bindings, resolved
    by usage, not by import name).
- Create `harness.ts`, `types.ts`, `ids.ts`, `domains.ts` (helpers, may be minimal).
- Create `plugin.ts` exporting `zustandSource()` where `discover`/`writeChannels`/
  `safetyWarnings` return `[]` for now; `harness` wired; `conformance.testedVersions`.
- Create `index.ts` re-exports.
- Edit `src/cli/registry/index.ts`: import `zustandSource` from
  `modality-ts/extract/sources/zustand` and add to `builtins` array (registry `index.ts:36`).
- Files: `imports.ts`, `ids.ts`, `domains.ts`, `types.ts`, `harness.ts`, `plugin.ts`,
  `index.ts`, `src/cli/registry/index.ts`.

### Step 2 — Core store discovery (`create`/`createStore`, plain creator)

- Implement `discoverZustandStoresDetailed` in `discover.ts`:
  - Find `VariableDeclaration` whose initializer is a store-creator call. Handle both:
    - direct: `create(creatorFn)` / `createStore(creatorFn)`
    - curried: `create<T>()(creatorFn)` / `create()(creatorFn)` — i.e. a `CallExpression`
      whose `expression` is itself a `CallExpression` to the creator symbol.
  - Resolve the **state-creator callback** (arrow/function expr). Its return object literal
    (direct expression body `=> ({...})` or `return {...}` in a block) gives properties.
  - For each property: if initializer is a function (arrow/function/method) → **action**
    (record in `storeActions: Map<storeName, Map<actionName, fn>>`). Otherwise → **state
    field**: emit a `SourceDecl` with `var: StateVarDecl` (`id: storeVarId(storeName, field)`,
    `domain` + `initial` from `domains.inferFieldDomain`, `scope: { kind: "global" }`,
    `origin: anchor`).
  - Record `storeFields: Map<storeName, Set<field>>`.
  - Spread members (`...slice`) and computed keys → push warning
    `"Zustand dynamic store field unsupported"`, skip.
- Wire `plugin.discover` → `discoverZustandStoresDetailed(ctx.sourceText, ctx.fileName).decls`.
- Files: `discover.ts`, `domains.ts`, `ids.ts`, `plugin.ts`.

### Step 3 — Read channels (selectors, getState, setState)

- In `writes.ts` `discoverZustandWritesDetailed`, detect the bound store hook:
  - `const useX = create(...)` / `createStore(...)` registers `useX` as a store handle bound
    to `storeName = useX` (the variable name **is** the store identity for varId purposes).
  - Selector read: `const v = useX(s => s.field)` → read channel
    `{ id: "zustand:useX.field.read", varId: storeVarId("useX","field"), symbolName: v }`.
    Also object/array selectors `useX(s => ({a: s.a}))` → one read channel per referenced
    field (best-effort; non-trivial selectors → warning, skip).
  - `useX.getState().field` / `useX.getState()` and `store.getState()` → read channel for
    referenced field(s).
  - Action binding: `const inc = useX(s => s.inc)` → bind symbol `inc` as a setter channel
    for the var(s) the action writes (effect from Step 4), or `useX.getState().inc`.
- Files: `writes.ts`, `ids.ts`.

### Step 4 — Action body → `EffectIR` lowering + fixed effects + skeleton

- Implement `effects.ts`. `ctx` carries `{ storeName, fieldVarIds, fieldInitials, immer:
  boolean }`; when `immer` is true, `set` callbacks are lowered as draft mutations (Step 5b)
  instead of returned partials.
  - **IR constraints (verified against `src/core/ir/types.ts`):** the `assign` effect is
    `{ kind: "assign"; var: string; expr: ExprIR }` — it has an **`expr`** field (not
    `value`) and **no `path`**. `ExprIR` supports `lit`, `read` (`{ var, path? }`),
    `eq`/`neq`/`and`/`or`/`not`, `cond`, and `updateField`
    (`{ target, path, value }`) — **but no arithmetic** (`+`/`-`/`*`). Reuse the engine's
    existing value lowering (`valueExpr` in
    `src/extract/engine/ts/transition/expressions.ts`) wherever possible instead of
    reimplementing, mirroring how jotai's `summarizeDerivedWriteBody` builds effects.
  - `lowerSetCall(call, ctx)` (non-immer / default merge semantics):
    - `set({ f: expr, ... })` → `seq` of `{ kind: "assign", var: storeVarId(store,f),
      expr: lowerExpr(expr) }` for each property (shallow partial merge).
    - `set(state => ({ f: expr }))` → same, with `lowerExpr` resolving `state.f` /
      destructured `state` to `{ kind: "read", var: storeVarId(store,f) }`.
    - replace form `set(x, true)` → assign listed fields **and** emit reset assignments for
      omitted store fields to their initial values; if initial unknown, push warning
      `"Zustand set(replace=true) partial fields not fully modeled"` and mark the action
      `confidence`/effect best-effort.
    - `get()` / `get().f` → `read` of the field var.
    - **Arithmetic / non-representable RHS** (e.g. `count + 1`, `n * 2`, string concat) →
      `lowerExpr` returns no expr; lower that property to `"unsupported"` or, when the action
      otherwise has modelable effects, drop the property and warn
      `"Zustand non-representable update for <field>"`. Do **not** invent an arithmetic
      `ExprIR`.
    - unsupported expression → return `"unsupported"` (do not emit a fixed effect).
  - `lowerActionBody(actionFn, ctx)` → walk body statements, collect `set` calls in order →
    `seq`. Conditionals/loops around `set` → warning + best-effort or `"unsupported"`.
- In `writes.ts`, for every action build `setterFixedEffects: Map<actionSymbol, EffectIR>`
  and a write channel `{ id: "zustand:<store>.<action>.action", varId: <primary written
  var>, symbolName: <action> }`. Track `resettableVarIds` if a `reset`-style action assigns
  all fields to initials.
- Implement `extractZustandSkeleton` in `transitions.ts` mirroring `extractJotaiSkeleton`:
  gather `vars`, `writeChannels`, call `extractSharedReactTransitions({ sourceText, fileName,
  route, effectApis, routePatterns, stateVars: vars, writeChannels, sourcePlugins:
  [zustandSource(), ...], setterFixedEffects, resettableVarIds, ...router })`.
- Export `extractZustandSkeleton` from `index.ts`.
- Optionally implement `plugin.summarizeWrite` for direct `useX.setState(...)` /
  `store.setState(...)` JSX-handler calls (parallels jotai store-set), returning an
  `assign`/`seq` `EffectIR`; otherwise `"unsupported"`.
- Files: `effects.ts`, `writes.ts`, `transitions.ts`, `index.ts`, `plugin.ts`.

### Step 5 — Middleware unwrapping (no-extra-install set)

- In `discover.ts` + `writes.ts`, before resolving the creator callback, **unwrap** a
  middleware call chain when the creator argument is a `CallExpression` to a resolved
  middleware symbol:
  - `subscribeWithSelector(creatorFn)` → inner `creatorFn` (transparent).
  - `devtools(creatorFn, opts?)` → inner `creatorFn` (transparent; optional info note).
  - `persist(creatorFn, opts)` → inner `creatorFn`; mark discovered fields with
    `storageKind: "localStorage"` metadata; emit SSR-safety warning when unguarded (mirror
    jotai `discoverJotaiSafetyWarnings` localStorage check).
  - `combine(initialState, creatorFn)` → state fields from the `initialState` **object
    literal**; actions from `creatorFn`.
  - `redux(reducerFn, initialState)` → state fields from `initialState`; implicit `dispatch`
    action; see stop conditions for reducer depth.
  - Nested chains (e.g. `devtools(persist(creatorFn, opts))`) → unwrap recursively.
  - `immer(creatorFn)` (from `zustand/middleware/immer`) → unwrap inner `creatorFn`; discover
    fields/actions normally, but **mark the store `immer: true`** so its action bodies are
    lowered with draft-mutation semantics (Step 5b). Nested chains like
    `devtools(immer(persist(creatorFn, opts)))` set the flag on the enclosed store.
- Files: `imports.ts`, `discover.ts`, `writes.ts`.

### Step 5b — immer draft-mutation lowering

- In `effects.ts`, add `lowerImmerSetCall(call, ctx)` used when `ctx.immer` is true. The
  `set` argument is a callback `(state) => { ...mutations... }` (block body, no return value,
  or `(state) => void expr`). Walk its statements and lower each draft mutation against
  `state` (the draft param identifier). Honor the same IR constraints as Step 4 (`assign`
  uses `expr`; no arithmetic `ExprIR`):
  - `state.f = expr` → `{ kind: "assign", var: storeVarId(store, f), expr: lowerExpr(expr) }`
    when `expr` is representable (lit/read/cond/boolean/object-spread); otherwise
    `"unsupported"` + warning.
  - `state.a.b = expr` → `{ kind: "assign", var: storeVarId(store, "a"), expr: { kind:
    "updateField", target: { kind: "read", var: storeVarId(store, "a") }, path: ["b"],
    value: lowerExpr(expr) } }` (use the `updateField` ExprIR; **not** an `assign.path`,
    which does not exist). Deeper paths extend the `path` array.
  - `state.f += expr` / `-=` / `*=`, `state.f++` / `++state.f` / `--` → arithmetic is **not
    representable** in `ExprIR`. Lower to `"unsupported"` for that mutation and warn
    `"Zustand non-representable update for <field>"` (or mark the action over-approx — see
    stop conditions). Do **not** emit a fabricated `read(f)+1`.
  - `lowerExpr` resolves `state.f` reads to `{ kind: "read", var: storeVarId(store, f) }`,
    matching `lowerSetCall`'s updater-function form.
  - Multiple mutations → `seq` in source order.
  - Container/dynamic mutations (`state.list.push(...)`, `.splice`, `.sort`, computed
    `state[k] = v`, `Object.assign(state, ...)`, reassigning the whole `state`) → emit
    warning `"Zustand immer container mutation not precisely modeled for <field>"` and either
    mark the action transition `confidence: "over-approx"` or fall back to `"unsupported"`
    for that mutation (see stop conditions).
  - A callback that **returns** an object while `ctx.immer` is true (valid immer escape
    hatch: returning replaces the draft) → lower via the non-immer `lowerSetCall` return-form
    path.
- `lowerActionBody` dispatches to `lowerImmerSetCall` vs `lowerSetCall` based on `ctx.immer`;
  the resulting `setterFixedEffects` wiring (Step 4) is unchanged.
- Files: `effects.ts`, `writes.ts`.

### Step 6 — Safety warnings, metadata, conformance polish

- `plugin.safetyWarnings` → persist/localStorage SSR-unsafe warnings + any discovery
  warnings (mirror `discoverJotaiSafetyWarnings`).
- Populate `ZustandStoreMetadata` (`storeName`, `field`, `middleware`, `storageKind`) via
  `metadataToRecord`.
- Confirm `conformance.testedVersions = "zustand>=4"`.
- Files: `plugin.ts`, `types.ts`, `writes.ts`.

## 7. Per-step files to edit

| Step | Files |
|------|-------|
| 1 | `src/extract/sources/zustand/{imports,ids,domains,types,harness,plugin,index}.ts`, `src/cli/registry/index.ts` |
| 2 | `src/extract/sources/zustand/{discover,domains,ids,plugin}.ts` |
| 3 | `src/extract/sources/zustand/{writes,ids}.ts` |
| 4 | `src/extract/sources/zustand/{effects,writes,transitions,index,plugin}.ts` |
| 5 | `src/extract/sources/zustand/{imports,discover,writes}.ts` |
| 5b | `src/extract/sources/zustand/{effects,writes}.ts` |
| 6 | `src/extract/sources/zustand/{plugin,types,writes}.ts` |
| Tests | `test/sources/zustand/zustand-source.test.ts` |

## 8. Acceptance criteria

- `zustandSource()` validates against `validateStateSourcePlugin`
  (`src/cli/registry/index.ts:105-124`) and appears in `createBuiltinModalityRegistry` output
  when `zustand` is a dependency; absent when not (dependency gating works).
- Given a store
  `const useGate = create<{open:boolean; status:'idle'|'done'; openIt:()=>void; finish:()=>void}>()((set)=>({open:false, status:'idle', openIt:()=>set({open:true}), finish:()=>set(s=>({status:'done'}))}))`:
  - discovery yields state vars `zustand:useGate.open` (initial `false`, boolean domain) and
    `zustand:useGate.status` (initial `'idle'`, enum/token domain);
  - `openIt`/`finish` are recognized as actions, not state vars;
  - a JSX handler `onClick={openIt}` (with `const openIt = useGate(s => s.openIt)`) produces a
    `user` transition whose effect is `assign open = lit(true)`.
- Selector `const open = useGate(s => s.open)` yields a read channel for
  `zustand:useGate.open`.
- A non-representable update (`set(s => ({ count: s.count + 1 }))`) does **not** fabricate
  arithmetic: the property is dropped/`unsupported` with the documented warning (arithmetic is
  not expressible in `ExprIR`).
- `createStore` (vanilla) is discovered identically to `create`.
- `persist`, `combine`, `redux`, `subscribeWithSelector`, `devtools` wrappers are unwrapped:
  state fields + actions are still discovered; `persist` adds an SSR-safety warning when
  localStorage is unguarded.
- `set(partial, true)` replace form produces assignments and (when initials are known) resets
  omitted fields; otherwise emits the documented warning.
- An `immer`-wrapped store
  `create(immer<{open:boolean; profile:{name:string}; openIt:()=>void; rename:()=>void}>((set)=>({open:false, profile:{name:'a'}, openIt:()=>set(s=>{s.open=true}), rename:()=>set(s=>{s.profile.name='b'})})))`
  discovers `zustand:useStore.open`/`zustand:useStore.profile` and lowers `openIt` to
  `assign open = lit(true)` and `rename` to `assign profile = updateField(read(profile),
  ["name"], lit('b'))`; `s.count += 1` lowers to `unsupported`/warning (no fabricated
  arithmetic); container mutations emit the documented warning without crashing.
- No existing test regresses: `pnpm test`, `pnpm architecture`, `pnpm phase7` stay green.

## 9. Tests to add or update

New `test/sources/zustand/zustand-source.test.ts` (mirror
`test/sources/jotai/jotai-source.test.ts`), covering:

- plugin shape: `id === "zustand"`, `packageNames === ["zustand"]`, empty-source
  `discover`/`writeChannels`/`safetyWarnings` return `[]`, `conformance.testedVersions`.
- harness `observe` via `store.getState()` handle and `initialState` fallback /
  `"unobservable"`.
- discovery of primitive state fields (number/string/boolean/union) with correct `varId`,
  `initial`, and inferred domain; actions excluded from vars.
- curried `create<T>()(...)` and direct `create(...)` and `createStore(...)` forms.
- `extractZustandSkeleton`: a gate store + `onClick={openIt}` handler yields a transition
  whose effect `assign open = lit(true)`; assert `reads`/`writes` arrays.
- selector read channels; `useStore.getState()` read.
- `set({field: value})` vs `set(s => ({field: ...}))` vs `set(x, true)` lowering; a
  `set(s => ({count: s.count + 1}))` arithmetic case → property dropped/`unsupported` + warning
  (assert no fabricated expr).
- middleware unwrapping: `persist`, `combine`, `redux`, `subscribeWithSelector`, `devtools`
  each still discover fields/actions; `persist` SSR warning; nested
  `devtools(persist(...))`.
- `immer` lowering: `s.f = v` → `assign f = lit(v)`; `s.a.b = v` → `assign a =
  updateField(read(a), ["b"], lit(v))`; `s.count += 1`/`s.count++` → warning +
  unsupported/over-approx (no fabricated arithmetic, no throw); `s.list.push(x)` → warning +
  over-approx/unsupported; nested `devtools(immer(...))` keeps draft semantics; immer callback
  that returns an object uses the return-form path.

Do **not** modify existing jotai/swr/use-state tests. If a snapshot/registry test asserts the
exact builtin plugin set (search `test/` for `sourcePluginIds` / registry summaries), update
that single expectation to include `"zustand"` — **stop and confirm** before editing a
golden/differential fixture (see Step-7 stop condition).

## 10. Verification commands

Prefix with `rtk`:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm fix
```

Targeted during development:

```bash
rtk pnpm vitest run test/sources/zustand/zustand-source.test.ts
```

## 11. Risks, ambiguities, and stop conditions

- **Pipeline vs skeleton wiring (decision):** the generic pipeline
  (`runExtractionPipeline`) does not thread `setterFixedEffects`, and jotai/swr deliberately
  expose action effects only through their standalone `extractXSkeleton` entry, not through
  `plugin.extract`. **Follow that pattern**: ship `extractZustandSkeleton` and keep
  `plugin.extract` unset (rely on `summarizeWrite` for JSX-handler `setState` calls in the
  pipeline). If you discover the pipeline is the only consumer in the target extract flow and
  action effects are silently dropped there, **stop and report** rather than refactoring the
  pipeline or SPI.
- **`redux` reducer depth (ambiguity):** fully lowering arbitrary reducers is open-ended.
  Scope to static `switch (action.type)` arms returning object spreads
  (`{ ...state, f: action.x }`) → per-action-type effects; anything else → a single
  over-approx `dispatch` transition + warning. If the repo has no precedent for over-approx
  confidence on plugin transitions, **stop and ask** how to mark it (`confidence:
  "over-approx"` exists on `Transition`).
- **`set(partial, true)` replace semantics:** replacing drops unlisted fields. Modeling a
  reset to initials is only sound when initials are statically known. When not, emit the
  documented warning and prefer a conservative (no-op on unknown fields) assignment; **do not
  silently assume undefined**.
- **`devtools` / `createWithEqualityFn` classification:** both are part of Zustand but their
  runtime needs a peer lib (`@redux-devtools/extension`, `use-sync-external-store`). They are
  **semantically transparent** to state, so this plan unwraps them (and treats
  `createWithEqualityFn` from `zustand/traditional` as an alias of `create` if encountered).
  This plan assumes **no hard exclusions** — `immer` is now supported via draft-mutation
  lowering (Step 5b). If the maintainer wants any of these excluded entirely, **stop and
  confirm**.
- **immer container mutations (ambiguity):** `state.list.push(x)`, `.splice`, `.sort`,
  computed-key writes, and whole-`state` reassignment are not precisely expressible as scalar
  `assign` effects. Default to a warning + `confidence: "over-approx"` on the action
  transition. If the repo has no precedent for over-approx confidence on plugin transitions
  (search `src/extract/sources/*` and `Transition.confidence` usage), **stop and ask**
  whether to mark over-approx or treat the mutation as `"unsupported"`.
- **IR shape is fixed (already verified):** `assign` is
  `{ kind: "assign"; var; expr }` (no `path`); nested writes use the `updateField` ExprIR
  (`{ target, path, value }`); there is **no arithmetic `ExprIR`**. The plan reflects this —
  do not add an `assign.path` or invent a `+`/`-` expr kind. If a future core change adds an
  arithmetic expr, increments could be modeled precisely; until then they are
  `unsupported`/over-approx.
- **Arithmetic-heavy stores degrade:** numeric counters that increment via `+`/`++` are the
  common Zustand example yet are not precisely modelable here (matching the engine's existing
  `valueExpr`, which also omits arithmetic). Confidence: such transitions are dropped or
  over-approx. If the maintainer expects precise counter modeling, **stop and confirm** scope
  before attempting to extend the core IR (out of scope for this plan).
- **varId scheme collision:** `zustand:<storeName>.<field>` uses the binding variable name as
  store identity. Two stores with the same field names in different files share a route-scoped
  model; if the existing models assume globally unique var ids across files, confirm the
  `storeName` prefix is sufficient. If a different id convention is mandated (search
  `src/extract/sources/*/ids.ts`), align to it.
- **Dependency gating:** `packageNames: ["zustand"]` means the plugin only activates when the
  app depends on `zustand`. Confirm example apps under `examples/` that should exercise
  Zustand actually list it; otherwise `pnpm ci:examples` won't cover it (out of scope to add
  an example unless requested).
- **If `src/cli/registry/index.ts` builtins list has changed shape** (e.g. moved to a
  data-driven registry), add `zustandSource()` following the new convention instead of the
  literal array at line 36; if the structure differs materially, **stop and report**.
- **Architecture rules (`pnpm architecture`)**: the new folder must only import from
  `modality-ts/core`, `modality-ts/extract/engine/spi`, `../shared/*`, `../../engine/ts/*`
  (as jotai does) and `typescript`. If dependency-cruiser flags an edge, mirror exactly which
  modules jotai imports — do not add new cross-layer edges.
