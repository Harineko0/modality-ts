# Spec 09.05 — Config Reception, Registry Wiring, and Dependency Boundaries

Status: draft for review. Part of the `plugin-layering/` series. Builds on `03-use-case-spis.md`.

## 1. Goal

Make the layered plugins **explicit and user-editable in the generated config**, instead of the
implicit dependency-sniffing that exists today. After this change, `modality.config.ts` is the
canonical, hand-editable wiring; auto-detection remains as the zero-config fallback.

## 2. `ModalityConfig` receives plugins

`ModalityConfig` (`src/cli/extraction/build-model.ts:68-81`) already accepts `plugins?`,
`domainRefinements?`, `routerPlugin?`, and `disabledPlugins?`. This series extends it with the new
layered fields **as each lands** in its phase:

```ts
export interface ModalityConfig {
  // …existing: navigation?, effectApis?, environment?, bounds?, packageJsonPath?,
  //            disabledPlugins?, plugins?, domainRefinements?, routerPlugin?
  framework?: FrameworkPlugin;                          // L4 framework (Phase 1)
  effectModels?: readonly EffectModelProvider[];        // L4 effect models (Phase 6)
}
```

`framework` is singular (exactly one framework is active per app, like the router); `effectModels`
compose. Both thread through `BuildExtractionModelOptions`
(`build-model.ts:83-100`) and into `createBuiltinModalityRegistry`
(`src/cli/registry/index.ts`).

Each field is added in the phase that introduces its SPI, so the config type never references a type
that does not yet exist. Until Phase 1, the generated config wires only the existing
`StateSourcePlugin` factories plus `bounds`.

## 3. Registry: explicit config as source of truth, auto-detect as fallback

Today `createBuiltinModalityRegistry` (`registry/index.ts:93-147`) builds the source-plugin set as
`[...builtins.filter(shouldEnableBuiltin), ...extraSourcePlugins]` — auto-detection plus any extras.
The change:

- When the config supplies an **explicit, non-empty** source-plugin list, that list is the source of
  truth and the auto-detected built-ins are **suppressed** (otherwise an app whose `package.json`
  contains `jotai` *and* whose config lists `jotaiSource()` would register the id twice and trip
  `sortedUnique`'s duplicate check, `registry/index.ts:530`).
- When the config supplies **no** plugin list (zero-config, or a legacy config that predates this
  change), auto-detection runs exactly as before.
- CLI `--plugin` extras still append in both modes.

The same explicit-vs-fallback rule applies to `framework` (Phase 1) and `effectModels` (Phase 6):
an explicit value in config wins; absence falls back to dependency-detection
(`shouldEnableBuiltin`, `registry/index.ts:381-389`). The registry registers, validates
(`validate*`), and stamps each into `PluginProvenance`.

## 4. `PluginProvenance` gains framework + effect-model kinds

`PluginProvenance.kind` (`src/core/ir/types.ts:144-157`) gains `"framework"` and `"effect-model"`
so the model metadata and trust ledger record which framework and effect models produced the model
— same accountability the existing eight kinds carry. The registry's `plugins` assembly
(`registry/index.ts:318-374`) gets the two new mapping blocks, sorted into the existing
kind-then-id order.

## 5. The `modality init` scaffold

`runInitCommand` (`src/cli/features/init/command.ts:13-37`) scaffolds **only `bounds`** today. The
new scaffold detects installed libraries from the target `package.json` (reusing the same
dependency detection the registry uses) and emits explicit imports + wiring:

```ts
import type { ModalityConfig } from "modality-ts/cli/extract";
import { useStateSource } from "modality-ts/extract/sources/use-state";
import { jotaiSource } from "modality-ts/extract/sources/jotai";
import { swrSource } from "modality-ts/extract/sources/swr";
// import { reactFramework } from "modality-ts/extract/frameworks/react";  // (added in Phase 1)

export default {
  // framework: reactFramework(),                 // L4 framework (Phase 1+)
  plugins: [useStateSource(), jotaiSource(), swrSource()],   // L4 state sources (detected)
  bounds: { maxDepth: 12, maxPending: 3, maxInternalSteps: 16 },
} satisfies ModalityConfig;
```

Rules:

- Emit only imports for libraries actually present in the target `package.json` (a React app with
  Jotai but no SWR omits the SWR import). `react` ⇒ `useStateSource()` is always included when react
  is a dependency.
- Keep `flag: "wx"` — never overwrite an existing config.
- Detection maps npm package name → source factory using the same `packageNames` the plugins
  declare (`["react"]`→useState, `["jotai"]`→jotai, `["swr"]`→swr, `["zustand"]`→zustand,
  `["@tanstack/react-query"]`→tanstack-query, `["@reduxjs/toolkit","react-redux","redux"]`→redux).
- The generated config must typecheck and must produce a model **identical** to the prior
  auto-registered run on the same app (the explicit list equals the auto-detected set).

## 6. Dependency-cruiser boundaries

`tools/depcruise.config.cjs` gains rules for the three new locations, mirroring the existing
`extract/sources/*` rules (`depcruise.config.cjs:43-65`):

- **`extract/frameworks/*`** — a *sibling* to `sources/*`. May import `core`, `extract/engine/spi`,
  and the shared `extract/engine/ts` utilities; may **not** import `check`, `cli/*` product slices,
  or `extract/sources/*` (except via `shared`). Being a sibling keeps `next → react-framework` legal
  without weakening source independence.
- **`extract/lang/*`** — imports `core` only (plus `typescript` for the TS impl). Not `compile`,
  `frameworks`, `sources`, or `engine` internals.
- **`extract/compile`** — imports `core` + `extract/engine/spi` (for the leaf-dispatch contract).
  Not `frameworks`, `sources`, or `lang`.
- The existing `extract-engine-is-node-only-and-independent` rule
  (`depcruise.config.cjs:16-20`) is extended so the engine is **forbidden to import `frameworks` or
  `lang` directly** — it reaches them only through injected SPI objects.

## 7. Verification (Phase 0 acceptance)

- `pnpm build` (`tsc -b`) green.
- Run `modality init` in a temp dir with a representative `package.json`; confirm the generated
  `modality.config.ts` typechecks.
- `modality extract` on a benchmark app (`benchmarks/nextjs`, `benchmarks/react-router`) produces a
  model **byte-identical** to the pre-change auto-registered run.
- `pnpm architecture` passes after the depcruise edits.
- `pnpm test` green (registry tests, init tests).
