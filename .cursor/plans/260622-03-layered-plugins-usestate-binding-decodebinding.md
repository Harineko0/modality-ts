# Layered Plugins — Phase 2: useState Binding Consolidation + `decodeBinding`

> Part 3 of 6. Specs: `docs/_specs/plugin-layering/03-use-case-spis.md §3`,
> `06-migration-roadmap.md` (Phase 2). Depends on Part 2 (framework SPI provides hook classification).
> **Identity-preserving: zero golden-snapshot diffs.**

## 1. Goal

Stop the engine from re-deriving useState bindings and from regex-matching library var-id shapes.
Two moves:

- The engine consumes the binding metadata that `StateSourcePlugin` discovery already produces
  (flowing via `extractionCtx.stateVars`) instead of re-walking `useState` declarations in
  `react-source-transitions.ts` and `context.ts`.
- Add `StateSourcePlugin.decodeBinding(decl): SetterBinding | undefined` so each source owns its own
  var-id shape, deleting the hardcoded regex in `context.ts:27-44`.

Identity-preserving: `decodeBinding` returns the **same** `SetterBinding` fields the regex produced.

## 2. Non-goals

- Do not move render-boundary or effect ownership (Part 4) or router/effect-model recognition
  (Part 5).
- Do not change the `SetterBinding` type shape or var-id strings — only **who** decodes them.
- Do not change discovery output; `stateVars` already carries what is needed.
- Do not add new source plugins.

## 3. Current-state findings

- `setterBindingFromDecl` (`src/extract/engine/ts/context.ts:27-44`) regex-matches four var-id
  shapes: `^local:([^.]+)\.(.+)$`, `^atom:(.+)$`, `^atom-family:([^:]+):`, `^swr:(.+):data$`, and
  derives `component` / `stateName` / `domain` / `initial`. This is the single coupling point that
  knows every library's id grammar.
- `discoverContextBindings` (`context.ts:108-216`) re-walks the source for `useState` array-binding
  declarations (`context.ts:134-160`) to build provider/setter maps — re-deriving what discovery
  already knows.
- `react-source-transitions.ts:454-541` (within the 1353-line walker) re-binds useState setters
  during transition extraction.
- The pipeline already threads discovered state vars; `build-model.ts:309-324` assembles
  `pipeline.stateVars` and template fragments into the model, and `runProjectExtractionPipeline`
  (`build-model.ts:251-268`) receives `sourcePlugins: registry.sourcePlugins`.
- `StateSourcePlugin` (`src/extract/engine/spi/index.ts`) has `discover`, `writeChannels`,
  `summarizeWrite?` (`spi/index.ts:235`), `domainHints?`, `template?`, `harness`, `conformance?`. No
  `decodeBinding`.
- Var-id owners: `useState` owns `local:`; Jotai owns `atom:` / `atom-family:`; SWR owns
  `swr:…:data`. Each is implemented in its `sources/<lib>/` slice.

## 4. Atomic implementation steps

1. **Add the SPI method.** Add optional `decodeBinding?(decl: StateVarDecl): SetterBinding | undefined`
   to `StateSourcePlugin` (`spi/index.ts`). Document that it owns the source's var-id shape and must
   return the identical fields the engine's regex produced.

2. **Implement `decodeBinding` per source.**
   - `sources/use-state`: decode `local:<Component>.<state>` → `{ varId, component, stateName,
     domain, initial }`.
   - `sources/jotai`: decode `atom:<name>` (strip `@store:…`) and `atom-family:<name>:…`.
   - `sources/swr`: decode `swr:<key>:data`.
   - Each mirrors the exact substring logic from `context.ts:27-44` for its shape.

3. **Replace the engine regex with plugin dispatch.** In `context.ts`, replace
   `setterBindingFromDecl` with a function that asks each active source plugin's `decodeBinding` in
   registry order until one claims the decl; fall back to the current `decl.id`-verbatim default for
   unclaimed decls. Thread the active `sourcePlugins` into `context.ts` (it currently has none) via
   the existing extraction context.

4. **Consume discovery bindings in the walker.** In `react-source-transitions.ts:454-541` and
   `discoverContextBindings` (`context.ts:134-160`), replace the re-derivation of useState bindings
   with a read of the already-discovered `stateVars` / setter map produced by discovery. Use the
   framework hook classification from Part 2 (`recognizeHook → kind:"state"`) to identify the hook
   call, then look up the discovered binding rather than re-parsing the declaration.

5. **Delete dead code.** Remove the now-unused regex and re-walk paths once tests confirm identity.
   Keep `emptyContextBindings` and the provider/context-value machinery (that is not the target).

## 5. Tests to add or update

- Add `test/sources/use-state/decode-binding.test.ts`, plus jotai/swr equivalents: `decodeBinding`
  returns the exact `SetterBinding` the old regex produced for representative ids, and `undefined`
  for foreign ids.
- Add `test/extraction/binding-consolidation.test.ts`: a fixture with useState + a Jotai atom + an
  SWR key produces identical setter bindings whether decoded by plugins or (a captured snapshot of)
  the old regex.
- Update any test that imported `setterBindingFromDecl` directly to use the new dispatch entry point.
- **Identity gate:** full snapshot suite, zero diffs.

## 6. Verification

```bash
rtk pnpm vitest run test/sources/use-state test/sources/jotai test/sources/swr test/extraction/binding-consolidation.test.ts
rtk pnpm typecheck
rtk pnpm test        # zero golden-snapshot diffs
rtk pnpm phase7
rtk pnpm architecture
rtk pnpm ci:examples
rtk pnpm fix
```

## 7. Acceptance criteria

- `StateSourcePlugin.decodeBinding` exists and is implemented by use-state, jotai, and swr.
- `context.ts` contains **no** var-id regex; binding decode goes through plugin dispatch with a
  verbatim-id fallback.
- The walker no longer re-derives useState bindings; it reads discovery output and uses framework
  hook classification.
- Zero golden-snapshot diffs across `pnpm test`, `pnpm phase7`, `pnpm ci:examples`;
  `pnpm architecture` green.

## 8. Risks, ambiguities, and stop conditions

- **Ordering sensitivity:** if two plugins could claim the same id shape, dispatch order matters.
  Today the shapes are disjoint; assert disjointness in a test. Stop and report if a real overlap
  exists (it would indicate an id-grammar collision needing a spec decision).
- **`initial` fidelity:** the regex derives `initial` from `decl.initial`. Ensure `decodeBinding`
  reads the same field; a subtle difference here changes initial-state snapshots.
- **Hidden consumers:** `setterBindingFromDecl` may be imported elsewhere. Grep before deleting; stop
  and migrate each call site rather than leaving a shim.
- If reading discovery bindings turns out to lack a field the re-walk computed (e.g. a
  provider-scoped alias), prefer extending discovery output over reviving the re-walk — but stop and
  report the missing field first.
