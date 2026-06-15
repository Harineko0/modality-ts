# Complete Jotai Core And Utilities Support

## 1. Goal

Improve `modality-ts` Jotai extraction so it recognizes and models the official Jotai syntax in this scope:

- Core: `atom`, `useAtom`, `createStore`, `getDefaultStore`, `Store`, `Provider`, `useStore`
- Utilities: Storage, SSR, Async, Lazy, Resettable, Family

Use the official Jotai docs as the feature baseline:

- Core index: https://jotai.org/docs
- `atom`: https://jotai.org/docs/core/atom
- `useAtom`: https://jotai.org/docs/core/use-atom
- Store: https://jotai.org/docs/core/store
- Provider: https://jotai.org/docs/core/provider
- Storage: https://jotai.org/docs/utilities/storage
- SSR: https://jotai.org/docs/utilities/ssr
- Async: https://jotai.org/docs/utilities/async
- Lazy: https://jotai.org/docs/utilities/lazy
- Resettable: https://jotai.org/docs/utilities/resettable
- Family: https://jotai.org/docs/utilities/family

The implementation should be incremental and conservative: prefer exact modeling for statically proven simple cases, and emit clear extraction warnings or global/per-var taints for syntax that can mutate atom state but cannot be summarized safely.

## 2. Non-goals

- Do not add support for Jotai extensions outside the requested utilities, such as Query, Effect, Immer, XState, Scope, Optics, Location, or Cache.
- Do not rewrite the extraction pipeline or checker.
- Do not change the public core IR schema unless store-qualified atom IDs cannot represent scoped Provider stores adequately. Start with store-qualified IDs.
- Do not attempt to execute arbitrary storage, observable, async read, or atom family initializer code during extraction.
- Do not make `jotai` a runtime dependency of `modality-ts` core. Keep Jotai knowledge inside `src/extract/sources/jotai/` and the harness boundary.
- Do not claim exact support for nested/dynamic Providers, dynamic atom creation in render, non-literal atom family params, or custom storage behavior unless the implementation proves those cases statically.

## 3. Current-state Findings

- `src/extract/sources/jotai/discover.ts` only discovers identifier variable declarations initialized by named `atom` imports from `"jotai"`. It misses `jotai/utils` atom creators and aliased module paths, and it does not classify primitive, read-only, read-write, or write-only atoms.
- `discoverJotaiAtoms` currently treats any `atom(...)` call as a state variable. That means `atom((get) => ...)` and `atom(null, write)` are modeled as primitive slots instead of derived projections or action atoms.
- `src/extract/sources/jotai/writes.ts` supports `useAtom` and `useSetAtom` from `"jotai"` plus simple `const store = getDefaultStore(); store.set(atom, value)`. It misses `createStore`, `useStore`, Provider store props, `useAtom(atom, { store })`, `store.get`, `store.sub`, `useHydrateAtoms`, `useResetAtom`, `RESET`, resettable utilities, and utility-created atoms.
- Store scoping is not modeled. All discovered atom vars use IDs like `atom:authAtom` and `scope: { kind: "global" }`, while official Jotai stores values in stores, and Providers can create separate stores for subtrees.
- `src/extract/sources/jotai/harness.ts` can observe an atom through a supplied `store.get(atom)` handle, but `setup` does not create or wire Jotai stores/Providers itself.
- `src/extract/engine/ts/react-source-transitions.ts` already binds source plugin write channels into the shared handler summarizer. This is the main integration point to preserve.
- `src/extract/engine/ts/transition/statement-summary.ts` and `src/extract/engine/ts/transition/expressions.ts` already summarize setter calls and functional updates. Jotai work should feed richer `WriteChannel`s and derived write summaries into this machinery instead of adding parallel transition logic.
- `src/core/ir/types.ts` only supports `global` and `route-local` state scopes. Store-specific atom values should initially be represented through deterministic var IDs such as `atom:authAtom@store:settingsStore` while keeping `scope: { kind: "global" }`.
- Tests already exist in `test/sources/jotai/jotai-source.test.ts` and `src/cli/features/extract/command.test.ts` for basic atom discovery, `useAtom`, `useSetAtom`, and default-store writes.

## 4. Exact File Paths And Relevant Symbols

- `src/extract/sources/jotai/discover.ts`
  - `discoverJotaiAtoms`
  - `atomImportNames`
  - `isAtomCall`
- `src/extract/sources/jotai/domains.ts`
  - `inferAtomDomain`
  - `initialValueForAtom`
  - `typeAliasDeclarations`
- `src/extract/sources/jotai/writes.ts`
  - `discoverJotaiWriteChannels`
  - `discoverJotaiSafetyWarnings`
  - `setAtomImportNames`
  - `getDefaultStoreImportNames`
  - `isUseAtomLikeCall`
- `src/extract/sources/jotai/plugin.ts`
  - `jotaiSource`
- `src/extract/sources/jotai/harness.ts`
  - `setup`
  - `observe`
  - `JotaiHarnessHooks`
- `src/extract/sources/jotai/transitions.ts`
  - `extractJotaiSkeleton`
- `src/extract/engine/spi/index.ts`
  - `SourceDecl`
  - `WriteChannel`
  - `StateSourcePlugin`
  - `M0Ctx`
  - `CallSite`
- `src/extract/engine/ts/react-source-transitions.ts`
  - `extractReactSourceTransitions`
  - write channel binding loop near `for (const channel of options.writeChannels ?? [])`
- `src/extract/engine/ts/context.ts`
  - `setterBindingFromDecl`
  - `bindSetter`
  - `settersForComponent`
- `src/extract/engine/ts/transition/statement-summary.ts`
  - `setterCallFrom`
  - `summarizeSetterWrite`
  - `settersWrittenIn`
  - `escapedSetters`
- `src/extract/engine/ts/transition/expressions.ts`
  - `setterArgumentExpr`
  - `valueExpr`
  - `modeledReadExpr`
- `src/cli/features/extract/command.ts`
  - `runExtractCommand`
  - `createExtractionReport`
  - plugin warning/caveat reporting
- Tests:
  - `test/sources/jotai/jotai-source.test.ts`
  - `src/cli/features/extract/command.test.ts`
  - Add focused fixtures under `test/sources/jotai/` if the test file becomes too large.

## 5. Existing Patterns To Follow

- Keep each state library as a vertical source slice under `src/extract/sources/<source>/`.
- Prefer `StateSourcePlugin.discover`, `writeChannels`, `safetyWarnings`, `summarizeWrite`, and `harness` over special-casing Jotai in the generic extractor.
- Reuse shared TS extraction helpers and transition summarization instead of duplicating React handler traversal.
- Use deterministic IDs, sorted output, and stable transition IDs.
- When exactness is uncertain, emit warnings that flow into `ExtractionReport.metadata.extractionCaveats`, not silent omissions.
- Preserve the existing `"jotai"` plugin id and version semantics; bump `version` only if tests intentionally assert the new plugin provenance.
- Keep test cases narrow and behavior-oriented, using small TSX snippets like the current Jotai tests.

## 6. Atomic Implementation Steps

### Step 1: Introduce Jotai import and symbol resolution helpers

Create a small helper module in `src/extract/sources/jotai/imports.ts` or similar.

Support named imports and aliases from:

- `"jotai"`
- `"jotai/react"` for React hooks if encountered
- `"jotai/vanilla"` for `atom`, `createStore`, `getDefaultStore` if encountered
- `"jotai/utils"` for utilities in this plan
- `"jotai/vanilla/utils"` only for vanilla utility creators if local tests prove users commonly import them
- `"jotai-family"` for `atomFamily`, because the official Family page says `atomFamily` from `jotai/utils` is deprecated and the replacement has the same API

Files to edit:

- `src/extract/sources/jotai/imports.ts` new
- `src/extract/sources/jotai/discover.ts`
- `src/extract/sources/jotai/writes.ts`

Acceptance criteria:

- Existing Jotai tests still pass.
- Aliased imports such as `import { atom as jotaiAtom, useAtom as useJ } from "jotai"` work.
- Unsupported imported Jotai symbols do not create false positives.

### Step 2: Add an internal Jotai atom metadata model

Add internal-only metadata types for discovered atom configs.

Represent:

- `primitive`: `atom(initialValue)`
- `readOnlyDerived`: `atom(read)`
- `readWriteDerived`: `atom(read, write)`
- `writeOnlyDerived`: `atom(null, write)` or `atom(initialValue, write)` when the first arg is not a read function
- `storage`: `atomWithStorage(key, initialValue, storage?, options?)`
- `lazy`: `atomWithLazy(init)`
- `resettable`: `atomWithReset(initialValue)`, `atomWithDefault(read)`, `atomWithRefresh(read, write?)`
- `asyncWrapper`: `loadable(atom)`, `unwrap(atom, fallback?)`, `atomWithObservable(createObservable, options?)`
- `family`: `atomFamily(initializeAtom, areEqual?)` declarations

Files to edit:

- `src/extract/sources/jotai/discover.ts`
- `src/extract/sources/jotai/domains.ts`
- Optional new `src/extract/sources/jotai/types.ts`

Acceptance criteria:

- `SourceDecl.metadata` records enough information to bind utility-created atom vars and warnings later.
- Write-only atoms are no longer emitted as ordinary state vars unless a concrete stored value is actually present.
- Derived read-only atoms are either represented as read-only derived expressions when statically simple, or as warnings plus token domains if they are consumed by modeled UI.

### Step 3: Expand atom discovery for official utility atom creators

Update `discoverJotaiAtoms` to recognize top-level variable declarations initialized by these utility calls:

- Storage: `atomWithStorage`, `createJSONStorage` as a storage helper only
- Lazy: `atomWithLazy`
- Resettable: `atomWithReset`, `atomWithDefault`, `atomWithRefresh`
- Async: `loadable`, `unwrap`, `atomWithObservable`
- Family: `atomFamily`

Modeling rules:

- `atomWithStorage(key, initialValue, ...)`: emit a normal writable atom var with the domain and initial value from `initialValue`; metadata should include `storageKey`, `getOnInit` when statically literal, and `storageKind` if inferable.
- `atomWithLazy(init)`: emit a writable atom var only if the initializer return can be statically represented; otherwise emit a token-domain var with a warning like `Jotai lazy initializer <atomName> not statically evaluated`.
- `atomWithReset(initialValue)`: emit a normal writable atom var and mark `resettableInitial`.
- `atomWithDefault(read)`: emit a resettable derived/default atom. For simple reads over known atoms, derive its domain and initial expression; otherwise use tokens with a warning.
- `atomWithRefresh(read, write?)`: model zero-arg refresh as an env/internal re-evaluation only for simple static reads; otherwise warn and treat explicit writes through the write function conservatively.
- `loadable(asyncAtom)`: emit a wrapper var with domain `{ loading | hasData | hasError }` plus a coarse `data` token when needed, or document why this is represented as a derived projection.
- `unwrap(asyncAtom, fallback?)`: emit a derived projection that reads the wrapped atom, using fallback when statically literal; otherwise warn.
- `atomWithObservable`: emit a library/env transition source only if `initialValue` is supplied; otherwise warn that first value may suspend and model the data as token/length category.
- `atomFamily`: discover the family declaration as a factory, but instantiate vars only for statically visible calls such as `todoFamily("foo")` or `todoFamily({ id: "a" })` in reachable source. Dynamic params must warn and not silently collapse all family instances into one var.

Files to edit:

- `src/extract/sources/jotai/discover.ts`
- `src/extract/sources/jotai/domains.ts`
- `test/sources/jotai/jotai-source.test.ts`

Acceptance criteria:

- Each utility category has at least one discovery test.
- Family instances get deterministic IDs like `atom-family:todoFamily:"foo"` or a sanitized equivalent.
- Dynamic family params produce an extraction warning, not a bogus single state var.

### Step 4: Model derived atom reads and writes

Support simple derived atom read/write functions without executing arbitrary code.

Read support:

- Parse `get(baseAtom)` and simple expressions already supported by `valueExpr`/`booleanExpr` where possible.
- Track read dependencies in metadata.
- Treat read-only derived atoms as read aliases/projections when used in guards or rendered expressions.

Write support:

- For `atom(read, write)` and `atom(null, write)`, summarize the write body when it only uses M0-supported statements and `set(targetAtom, value)` calls.
- Bind `useAtom(derivedWritableAtom)[1]` and `useSetAtom(derivedWritableAtom)` to the derived write summary, not to a synthetic stored var.
- If a derived write can set multiple atoms, emit a `seq` effect with multiple assigns/havocs.
- If the write body receives arbitrary `...args`, support the common single-argument case by binding the argument name to the setter call argument; warn for multi-arg or destructured cases.

Files to edit:

- `src/extract/sources/jotai/discover.ts`
- `src/extract/sources/jotai/writes.ts`
- `src/extract/sources/jotai/plugin.ts` for `summarizeWrite`
- `src/extract/engine/spi/index.ts` only if current `CallSite.arguments: readonly unknown[]` is insufficient to preserve expression structure. Prefer avoiding SPI changes.
- `src/extract/engine/ts/transition/statement-summary.ts` if direct `set(atom, value)` support needs a small generic extension.

Acceptance criteria:

- `const incAtom = atom(null, (get, set) => set(countAtom, get(countAtom) + 1))` through `useSetAtom(incAtom)` produces a transition writing `atom:countAtom`.
- Read-write derived atoms used by `useAtom` bind both value reads and setter writes correctly.
- Unsupported derived write bodies produce per-handler over-approx warnings or global taints as appropriate.

### Step 5: Add store and Provider scoping

Represent Jotai store identity without changing `StateVarDecl.scope`.

Implementation approach:

- Discover store declarations: `const myStore = createStore()` and `const defaultStore = getDefaultStore()`.
- Discover `Provider` imports and JSX usages:
  - `<Provider>` means anonymous Provider store for the subtree.
  - `<Provider store={myStore}>` means the subtree reads/writes store-qualified atom vars.
  - Nested Providers are supported only if the store expression is a statically known identifier or absent.
- Discover `useStore()` as a read of the nearest Provider/default store and bind `store.set(atom, value)`, `store.get(atom)`, and `store.sub(atom, callback)` when statically visible.
- Support `useAtom(atom, { store: myStore })` by binding to store-qualified atom vars.
- Create deterministic var IDs:
  - Default/provider-less: preserve existing `atom:authAtom`.
  - Named store: `atom:authAtom@store:myStore`.
  - Anonymous Provider component: `atom:authAtom@provider:<ComponentName>` or another stable sanitized ID.
- Duplicate base atom declarations per statically referenced store, copying domain/initial metadata.

Files to edit:

- `src/extract/sources/jotai/discover.ts`
- `src/extract/sources/jotai/writes.ts`
- `src/extract/sources/jotai/harness.ts`
- `src/extract/engine/ts/react-source-transitions.ts` only if subtree Provider context must be threaded through write channel binding.
- `test/sources/jotai/jotai-source.test.ts`
- `src/cli/features/extract/command.test.ts`

Acceptance criteria:

- `<Provider store={myStore}><Button /></Provider>` and `useAtom(countAtom)` inside `Button` write `atom:countAtom@store:myStore`.
- Provider-less usage still writes `atom:countAtom`.
- `store.set(countAtom, 1)` writes the same var ID that `useAtom(countAtom, { store })` reads.
- Dynamic store expressions warn with `Jotai dynamic Provider store unsupported` or equivalent.

### Step 6: Add SSR hydration support

Implement `useHydrateAtoms(values, options?)` from `jotai/utils`.

Modeling rules:

- Recognize array tuple literals and `new Map([[atom, value], ...])`.
- Apply initial values to the target store-qualified atom vars before model emission when the call is top-level in a component that is part of the extracted tree.
- Respect `{ store: myStore }` by hydrating the store-qualified var.
- Ignore repeated hydration after first hydrate per store/atom unless `dangerouslyForceHydrate: true` is statically present; if force hydrate is present, warn because concurrent rendering semantics are intentionally dangerous in the official docs.

Files to edit:

- `src/extract/sources/jotai/writes.ts` or new `src/extract/sources/jotai/hydration.ts`
- `src/extract/sources/jotai/discover.ts` if hydration needs to patch discovered `initial`
- `src/extract/engine/pipeline/index.ts` only if plugin-discovered initial overrides need a formal pipeline hook. Prefer representing hydration as plugin metadata consumed inside the Jotai slice first.
- Tests in `test/sources/jotai/jotai-source.test.ts`

Acceptance criteria:

- `useHydrateAtoms([[countAtom, 42]])` changes the modeled initial value for `atom:countAtom` to `42`.
- `useHydrateAtoms(new Map([[countAtom, 42]]), { store: myStore })` hydrates `atom:countAtom@store:myStore`.
- Dynamic hydration values warn and fall back to current initial/domain behavior.

### Step 7: Add reset semantics and `RESET`

Recognize `RESET` from `jotai/utils` and resettable APIs.

Modeling rules:

- `setAtom(RESET)` resets `atomWithReset`, `atomWithDefault`, and `atomWithStorage` vars to their original initial/default value.
- `useResetAtom(atom)` creates a no-arg write channel that resets the target atom.
- Functional updates returning `RESET`, such as `setAtom((prev) => prev ? RESET : true)`, should be exact when the condition can be summarized; otherwise havoc the target var.
- `atomWithStorage(...).set(RESET)` should reset the model var and include a warning that external storage removal/subscription side effects are abstracted unless cross-tab env transitions are implemented.

Files to edit:

- `src/extract/sources/jotai/writes.ts`
- `src/extract/sources/jotai/plugin.ts`
- `src/extract/engine/ts/transition/expressions.ts` if `RESET` must become a first-class expression sentinel before lowering to the initial value.
- Tests in `test/sources/jotai/jotai-source.test.ts`

Acceptance criteria:

- `const reset = useResetAtom(countAtom); reset()` emits an assignment to the atom initial value.
- `setCount(RESET)` emits the same assignment for resettable/storage atoms.
- `RESET` applied to a non-resettable atom warns and falls back to havoc or unextractable behavior.

### Step 8: Add storage-specific behavior

Implement static support for Storage utilities.

Modeling rules:

- `atomWithStorage(key, initialValue, storage?, options?)` should be a normal writable atom with metadata.
- `getOnInit: true` may use stored values unknown at extraction time. Model this as the union/domain of `initialValue` plus a token or a warning unless a test harness supplies concrete storage.
- Custom `createJSONStorage(() => window.localStorage | window.sessionStorage)` is recognized only for metadata and SSR warnings; do not execute the getter.
- Async storage makes atom values async according to official docs. For async storage, either model through the Async wrapper rules or warn `Jotai async storage value abstracted`.
- Cross-tab `subscribe` should not create hidden writes unless explicitly enabled. Add an env transition only if a storage subscription is statically known and bounded; otherwise warn.

Files to edit:

- `src/extract/sources/jotai/discover.ts`
- `src/extract/sources/jotai/writes.ts`
- `src/extract/sources/jotai/harness.ts`
- Tests in `test/sources/jotai/jotai-source.test.ts`

Acceptance criteria:

- Simple `atomWithStorage("theme", "light")` is discovered as a writable atom with initial `"light"`.
- `setTheme("dark")` updates that atom through existing setter summarization.
- `setTheme(RESET)` resets to `"light"`.
- SSR-unsafe unguarded storage access emits a warning when detectable.

### Step 9: Add async and lazy support

Support syntax without pretending to solve arbitrary async dataflow.

Modeling rules:

- Async read atoms `atom(async (get) => ...)` are discovered as async derived atoms. If wrapped with `loadable`, expose states `loading`, `hasData`, `hasError`.
- `unwrap(asyncAtom, fallback)` should provide a sync projection with `undefined` or static fallback while pending.
- `atomWithObservable` with `initialValue` emits initial value; without it, model loading/suspense and data token.
- `atomWithLazy(init)` computes once per store in Jotai. For static literal/object initializers, set exact initial; for non-static functions, use token/first domain plus warning.

Files to edit:

- `src/extract/sources/jotai/discover.ts`
- `src/extract/sources/jotai/domains.ts`
- `src/extract/sources/jotai/writes.ts`
- Tests in `test/sources/jotai/jotai-source.test.ts`

Acceptance criteria:

- `loadable(userAtom)` produces a finite modeled domain for `state`.
- `unwrap(userAtom, () => "pending")` or `unwrap(userAtom, () => prev ?? "pending")` is either exact for static fallback or warns clearly.
- Async atom writes after awaited effects still use existing async transition continuation logic when the write is in a React handler.

### Step 10: Add atom family support

Implement a bounded/static subset of Family.

Modeling rules:

- Discover `const itemAtom = atomFamily((id) => atom(...))`.
- Instantiate only calls with static literal or object-literal params visible in source.
- Use `areEqual` only when it is a known identifier with simple comparator shape; otherwise default to serialized params and warn if object params are used.
- Recognize family methods:
  - `family(param)` returns an atom instance.
  - `family.remove(param)` may delete cache, but model as no state write unless the atom instance is subsequently unreadable; warn and ignore cache lifetime by default.
  - `family.setShouldRemove(...)` and `family.unstable_listen(...)` should warn as cache/lifecycle behavior not modeled.

Files to edit:

- `src/extract/sources/jotai/discover.ts`
- `src/extract/sources/jotai/writes.ts`
- Tests in `test/sources/jotai/jotai-source.test.ts`

Acceptance criteria:

- `const fooAtom = atomFamily((id: "a" | "b") => atom(id)); useAtom(fooAtom("a"))` creates `atom-family:fooAtom:"a"`.
- `useSetAtom(fooAtom("a"))("b")` writes only the `"a"` instance.
- Dynamic params warn and do not silently alias unrelated instances.

### Step 11: Update reports and docs

Make support boundaries visible.

Files to edit:

- `docs/specs/02-extraction.md`
- `docs/specs/05-architecture.md`
- `docs/todo.md`
- `src/cli/features/extract/command.test.ts`

Acceptance criteria:

- Specs mention supported Jotai utility categories and conservative fallback rules.
- Extraction report warnings distinguish unsupported Jotai syntax from generic unextractable handlers.
- Existing plugin provenance still reports `state-source:jotai@0.1.0` unless intentionally bumped.

## 7. Per-step Files To Edit

- Step 1:
  - `src/extract/sources/jotai/imports.ts`
  - `src/extract/sources/jotai/discover.ts`
  - `src/extract/sources/jotai/writes.ts`
  - `test/sources/jotai/jotai-source.test.ts`
- Step 2:
  - `src/extract/sources/jotai/types.ts`
  - `src/extract/sources/jotai/discover.ts`
  - `src/extract/sources/jotai/domains.ts`
- Step 3:
  - `src/extract/sources/jotai/discover.ts`
  - `src/extract/sources/jotai/domains.ts`
  - `test/sources/jotai/jotai-source.test.ts`
- Step 4:
  - `src/extract/sources/jotai/discover.ts`
  - `src/extract/sources/jotai/writes.ts`
  - `src/extract/sources/jotai/plugin.ts`
  - `src/extract/engine/ts/transition/statement-summary.ts` only if needed
  - `test/sources/jotai/jotai-source.test.ts`
- Step 5:
  - `src/extract/sources/jotai/discover.ts`
  - `src/extract/sources/jotai/writes.ts`
  - `src/extract/sources/jotai/harness.ts`
  - `src/extract/engine/ts/react-source-transitions.ts` only if needed
  - `src/cli/features/extract/command.test.ts`
- Step 6:
  - `src/extract/sources/jotai/hydration.ts`
  - `src/extract/sources/jotai/discover.ts`
  - `src/extract/sources/jotai/writes.ts`
  - `test/sources/jotai/jotai-source.test.ts`
- Step 7:
  - `src/extract/sources/jotai/writes.ts`
  - `src/extract/sources/jotai/plugin.ts`
  - `src/extract/engine/ts/transition/expressions.ts` only if needed
  - `test/sources/jotai/jotai-source.test.ts`
- Step 8:
  - `src/extract/sources/jotai/discover.ts`
  - `src/extract/sources/jotai/writes.ts`
  - `src/extract/sources/jotai/harness.ts`
  - `test/sources/jotai/jotai-source.test.ts`
- Step 9:
  - `src/extract/sources/jotai/discover.ts`
  - `src/extract/sources/jotai/domains.ts`
  - `src/extract/sources/jotai/writes.ts`
  - `test/sources/jotai/jotai-source.test.ts`
- Step 10:
  - `src/extract/sources/jotai/discover.ts`
  - `src/extract/sources/jotai/writes.ts`
  - `test/sources/jotai/jotai-source.test.ts`
- Step 11:
  - `docs/specs/02-extraction.md`
  - `docs/specs/05-architecture.md`
  - `docs/todo.md`
  - `src/cli/features/extract/command.test.ts`

## 8. Acceptance Criteria

- Existing `useState`, SWR, router, and current Jotai tests remain green.
- Extraction recognizes all official Jotai core and requested utility entrypoints listed in the Goal.
- For each supported utility category, tests show one exact case and one conservative-warning case where appropriate.
- Store-qualified atom writes and reads are deterministic and do not alias separate Provider stores.
- Derived write atoms can update one or more underlying primitive/storage/resettable/family atom vars in M0-supported cases.
- `RESET` and `useResetAtom` lower to assignments to the recorded initial/default value when valid.
- `useHydrateAtoms` changes initial values for static tuple/Map cases.
- Dynamic atom creation, dynamic store expressions, dynamic family params, arbitrary async reads, custom storage side effects, and observable streams emit explicit warnings instead of silently producing exact-looking models.
- Extraction reports include Jotai-specific warnings/caveats that help users decide whether to add overlays.

## 9. Tests To Add Or Update

Add focused unit tests in `test/sources/jotai/jotai-source.test.ts`:

- Aliased imports from `"jotai"` and `"jotai/utils"`.
- `atom` forms:
  - primitive
  - read-only derived
  - read-write derived
  - write-only derived
  - `debugLabel` ignored safely
  - simple `onMount` write either modeled as internal mount transition or warned
- `useAtom(atom, { store })`
- `createStore`, `getDefaultStore`, `useStore`, `store.get`, `store.set`, `store.sub`
- `<Provider>` and `<Provider store={myStore}>`
- `atomWithStorage`, `createJSONStorage`, `getOnInit`, `RESET`
- `useHydrateAtoms` with array tuples, `Map`, store option, and `dangerouslyForceHydrate`
- `loadable`, `unwrap`, `atomWithObservable`
- `atomWithLazy`
- `atomWithReset`, `useResetAtom`, `atomWithDefault`, `atomWithRefresh`
- `atomFamily` static literal params and dynamic param warning

Add CLI integration tests in `src/cli/features/extract/command.test.ts`:

- Multifile app with atoms declared in one file and consumed through Provider/store in another.
- Utility-created atoms imported through local barrel files if existing local import concatenation can support it.
- Warnings appear in `report.extractionCaveats` or `report.warnings`.

Update existing tests only when expected behavior becomes more precise. Do not delete coverage for the current simple `atom`, `useAtom`, `useSetAtom`, or `getDefaultStore` cases.

## 10. Verification Commands

Run after each coherent batch:

```bash
rtk pnpm test -- test/sources/jotai/jotai-source.test.ts
rtk pnpm test -- src/cli/features/extract/command.test.ts
```

Run before handing off:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm fix
```

If semantics or model generation changes affect checker behavior, also run:

```bash
rtk pnpm phase7
```

## 11. Risks, Ambiguities, And Stop Conditions

- Stop and report if exact Provider subtree scoping requires an IR-level store scope rather than deterministic store-qualified var IDs.
- Stop and report if plugin `summarizeWrite` cannot model derived atom writes without changing `CallSite` to carry TypeScript AST nodes or a richer expression representation.
- Stop and report if `useHydrateAtoms` initial overrides cannot be applied without introducing a new plugin pipeline hook.
- Stop and report if local import concatenation loses enough module boundaries that atom declarations and Provider consumers cannot be linked safely.
- Treat dynamic atom creation inside render as unsupported unless it is wrapped in a statically analyzable `useMemo`/`useRef` and has a stable ID.
- Treat dynamic family params as unsupported unless there is a finite static domain and a bounded call set.
- Treat custom storage subscriptions, async storage, observables, and arbitrary async atom reads as conservative abstractions unless a bounded source of values is supplied by overlay or harness.
- Avoid broad refactors in `src/extract/engine/ts/`; only touch shared engine files when the Jotai slice cannot express the feature through the existing SPI.
