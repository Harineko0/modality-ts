# Layered Plugins — Phase 0: Config Receives Plugins

> Part 1 of 6 in the layered-plugin migration. Specs:
> `docs/_specs/plugin-layering/00-overview.md` … `06-migration-roadmap.md`.
> This part is **foundational and ships first**. It touches no engine code and must produce
> byte-identical models, so it is the safe entry point for the whole series.

## 1. Goal

Make plugin wiring **explicit and user-editable** in the generated `modality.config.ts`, instead of
the implicit dependency-sniffing that exists today. Concretely:

- `modality init` detects installed libraries from the target `package.json` and scaffolds an
  explicit `plugins: [...]` list (plus the existing `bounds`).
- The registry treats an **explicit, non-empty** config plugin list as the source of truth and
  **suppresses** dependency-based auto-detection of built-in source plugins; an empty/omitted list
  falls back to auto-detection (zero-config UX preserved).
- This is purely a wiring change: a project whose `package.json` deps and whose generated config
  list agree produces a **byte-identical model** to the prior auto-registered run.

This is the canonical wiring change that later phases extend with `framework` and `effectModels`
fields as their SPIs land (Parts 2 and 5).

## 2. Non-goals

- Do **not** add `framework?` / `effectModels?` fields to `ModalityConfig` yet — their SPIs
  (`FrameworkPlugin`, `EffectModelProvider`) do not exist until Parts 2 and 5. Adding them now would
  reference nonexistent types. Leave a commented placeholder only.
- Do not change the extraction engine, the IR, the checker, snapshots, or any source-plugin
  behavior.
- Do not change router / domain-refinement / handler-wrapper / cache-storage auto-detection — only
  **state-source** selection becomes config-driven in this phase.
- Do not introduce backward-compatibility shims; existing configs that omit `plugins` simply keep
  auto-detecting.
- Do not walk parent directories for `package.json` in `init` — detect from the target `cwd` only
  (init scaffolds for "this project").

## 3. Current-state findings

- `ModalityConfig` (`src/cli/extraction/build-model.ts:68-81`) already accepts
  `plugins?: readonly StateSourcePlugin[]`, `domainRefinements?`, `routerPlugin?`,
  `disabledPlugins?`, plus `bounds?`, `navigation?`, `effectApis?`, `environment?`,
  `packageJsonPath?`.
- `buildExtractionModel` builds the registry at `build-model.ts:131-168`, currently merging config
  plugins into auto-detected built-ins via
  `extraSourcePlugins: [...(config.plugins ?? []), ...(options.sourcePlugins ?? [])]`
  (`build-model.ts:151-154`). There is **no suppression** of built-ins when config lists plugins, so
  an explicit `jotaiSource()` alongside a `jotai` dependency would register the id twice and trip
  `sortedUnique` (`src/cli/registry/index.ts:530-537`).
- `createBuiltinModalityRegistry` (`src/cli/registry/index.ts:93-147`) computes
  `sourcePlugins = [...builtins.filter(shouldEnableBuiltin), ...extraSourcePlugins]`. Built-ins:
  `useStateSource(), jotaiSource(), swrSource(), zustandSource(), tanstackQuerySource(),
  reduxSource()` (`registry/index.ts:98-105`). `shouldEnableBuiltin` (`registry/index.ts:381-389`)
  enables a built-in when any of its `packageNames` is present in deps (or always, when deps are
  undefined).
- Source factory exports + `packageNames` (verified):
  - `useStateSource` — `modality-ts/extract/sources/use-state` — `["react"]`
  - `jotaiSource` — `modality-ts/extract/sources/jotai` — `["jotai"]`
  - `swrSource` — `modality-ts/extract/sources/swr` — `["swr"]`
  - `zustandSource` — `modality-ts/extract/sources/zustand` — `["zustand"]`
  - `tanstackQuerySource` — `modality-ts/extract/sources/tanstack-query` — `["@tanstack/react-query"]`
  - `reduxSource` — `modality-ts/extract/sources/redux` — `["@reduxjs/toolkit","react-redux","redux"]`
- `runInitCommand` (`src/cli/features/init/command.ts:13-37`) scaffolds **only `bounds`** with
  `flag: "wx"` (no overwrite). It does not read `package.json`.
- No existing `modality.config.ts` lists `plugins:` (checked `benchmarks/nextjs`,
  `benchmarks/react-router`; both only set `navigation.initialRoute`). So making explicit config the
  source of truth changes **no existing project's** output.
- `readPackageDependencies` (`build-model.ts:594-608`) already merges peer/dev/dependencies — reuse
  this shape for `init` detection.

## 4. Atomic implementation steps

1. **Add `sourcePluginsOverride` to the registry options.**
   - In `src/cli/registry/index.ts`, add to `BuiltinRegistryOptions`
     (`registry/index.ts:72-80`): `sourcePluginsOverride?: readonly StateSourcePlugin[]` with a doc
     comment citing `docs/_specs/plugin-layering/05-config-and-registry.md §3`.
   - In `createBuiltinModalityRegistry`, replace the `sourcePlugins` construction
     (`registry/index.ts:106-112`) with:
     - if `sourcePluginsOverride?.length`: `sourcePlugins = [...sourcePluginsOverride,
       ...(extraSourcePlugins ?? [])]` (no built-in auto-detection, no `disabled` filter on the
       explicit list — the user listed them deliberately);
     - else: the current `[...builtins.filter(enabled), ...extraSourcePlugins]`.

2. **Thread config plugins as override (not extras) in build-model.**
   - In `src/cli/extraction/build-model.ts:145-160`, pass
     `sourcePluginsOverride: config.plugins` and keep
     `extraSourcePlugins: [...(options.sourcePlugins ?? [])]` (CLI `--plugin` extras stay extras).
   - Remove `config.plugins` from the old `extraSourcePlugins` merge so it is no longer double-fed.

3. **Add library detection for `init`.**
   - In `src/cli/features/init/command.ts`, add a static table
     `SOURCE_SCAFFOLD: { factory; module; packageNames }[]` in the canonical order useState, jotai,
     swr, zustand, tanstack-query, redux (values from §3).
   - Add a helper `detectSourceScaffolds(cwd)` that reads `join(cwd, "package.json")` (tolerate
     ENOENT → return `[]`), merges `dependencies`/`devDependencies`/`peerDependencies`, and selects
     each scaffold whose `packageNames` intersect the dep set.

4. **Emit explicit wiring from `init`.**
   - Rewrite the `writeFile` body in `runInitCommand` (`command.ts:17-32`) to:
     - when scaffolds are non-empty: emit `import type { ModalityConfig } …`, one named value import
       per detected scaffold, then `export default { plugins: [<factory>(), …], bounds: {…} }
       satisfies ModalityConfig;`, plus a commented `// framework: reactFramework(),` placeholder
       line referencing Part 2;
     - when empty (no `package.json` / no known deps): emit the current bounds-only config unchanged.
   - Keep `flag: "wx"`. Return the same `InitCommandResult` shape (extend `lines` with a
     `plugins=<ids>` summary line for human output, optional).

5. **Document the placeholder for later phases.**
   - Add a one-line code comment in `ModalityConfig` (`build-model.ts:68-81`) marking where
     `framework?: FrameworkPlugin` and `effectModels?: readonly EffectModelProvider[]` land (Parts 2
     and 5), so the next implementer has an anchor. Do not add the fields yet.

## 5. Tests to add or update

- Add `test/cli/init-command.test.ts` (or `src/cli/features/init/command.test.ts`):
  - With a temp `package.json` containing `react` + `jotai` + `swr`: generated config imports
    exactly `useStateSource`, `jotaiSource`, `swrSource` and lists them in `plugins`; it typechecks
    (compile the emitted string via `ts.transpileModule`, or assert it parses + imports resolve).
  - With no `package.json`: generated config is bounds-only (current behavior).
  - `flag: "wx"` still throws when a config already exists.
  - Detection ignores unrelated deps and includes redux when any of
    `@reduxjs/toolkit`/`react-redux`/`redux` is present.
- Update `src/cli/registry/index.test.ts`:
  - `sourcePluginsOverride` non-empty suppresses auto-detected built-ins (registry source ids equal
    the override ids ∪ extras, regardless of `dependencies`).
  - Empty/omitted `sourcePluginsOverride` preserves current auto-detection (existing assertions
    unchanged).
  - Override + a CLI extra of the **same id** raises the existing duplicate error (documents the
    contract).
- Add a registry-equivalence test: for deps `{react, jotai}`, the model/source-id set from
  `sourcePluginsOverride: [useStateSource(), jotaiSource()]` equals the set from auto-detection.

## 6. Verification

```bash
rtk pnpm vitest run src/cli/registry/index.test.ts test/cli/init-command.test.ts
rtk pnpm typecheck
rtk pnpm build
# Identity check: extract a benchmark before/after and diff the model.
rtk pnpm --filter . exec node -e "0" # placeholder; use the repo's extract entrypoint
rtk pnpm architecture
rtk pnpm test
rtk pnpm fix
```

Manual identity check (required acceptance evidence): in a temp copy of `benchmarks/react-router`,
run `modality init`, then `modality extract`, and `diff` the produced `.modality/model.json` against
an extraction from the pre-change build. They must be byte-identical.

## 7. Acceptance criteria

- `modality init` in a React+Jotai+SWR project writes a `modality.config.ts` that imports and lists
  exactly those source factories plus `bounds`, and the file typechecks.
- `modality init` in a directory with no `package.json` still writes the bounds-only config.
- When config lists `plugins`, the registry uses them as the source of truth and does **not**
  auto-add built-ins (no duplicate-id error).
- When config omits `plugins`, auto-detection is unchanged.
- `modality extract` on both benchmark apps produces a model byte-identical to the pre-change run.
- `rtk pnpm test`, `rtk pnpm architecture`, `rtk pnpm typecheck` all green.

## 8. Risks, ambiguities, and stop conditions

- **Duplicate-id risk:** if any benchmark or example *does* gain a `plugins` list that relies on the
  old "append to auto-detect" behavior, suppression changes its model. None exists today; stop and
  report if one is found rather than silently changing its output.
- **`react` always-on:** `useStateSource`'s `packageNames` is `["react"]`; every React app scaffolds
  `useStateSource()`. Confirm this matches auto-detect (it does — `shouldEnableBuiltin` enables it
  whenever `react` is a dep). Stop if a benchmark lacks `react` in deps yet relies on useState.
- **Typecheck of generated config:** the emitted file imports value factories from subpath exports;
  ensure those subpaths exist in `package.json#exports` (verified for all six). Stop and report if a
  factory lacks a non-harness main export.
- **Do not** extend `ModalityConfig` with `framework`/`effectModels` in this part; if a reviewer
  asks for them, that work belongs to Parts 2 and 5 where the SPIs exist.
- Keep the change additive to the registry signature; if threading `sourcePluginsOverride` forces a
  change to `createModalityRegistry` (the lower-level builder), stop — it should not, since override
  resolution happens entirely in `createBuiltinModalityRegistry`.
