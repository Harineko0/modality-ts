# Structured Caveats Confidence and Provenance

Status: implementation plan.
Date: 2026-06-17.
Plan family: C - Adapter SPI Consolidation.
Split sequence: 260617-21-4.

## 1. Goal

Replace warning-string conventions with structured caveats and make adapter
confidence/provenance explicit for all capabilities that affect model output.

The intended end state of this plan is:

- imprecision is represented as `ExtractionCaveat` at the source that creates
  it;
- production code no longer parses warning message prefixes such as
  `"Global taint "` to recover typed caveats;
- provider results carry producer/confidence metadata where they create vars,
  transitions, aliases, or caveats;
- `PluginProvenance.kind` distinguishes navigation, module roles, effect APIs,
  cache/storage, observation, state sources, and domain refinements;
- extraction reports and model metadata expose which provider caused an
  approximation.

## 2. Non-goals

- Do not add new adapter capabilities in this plan.
- Do not change checker semantics.
- Do not broaden cache/storage interpretation beyond the provider added in
  plan 3.
- Do not migrate replay observation behavior; plan 5 owns that.
- Do not preserve warning-message parsing as a fallback.
- Do not edit generated `dist/` or `docs/build/` artifacts.

## 3. Current-State Findings

- `ExtractionWarning` currently supports `message` and `source`; plan 1 should
  have added optional `caveat`, `confidence`, and `producer` fields.
- `src/extract/engine/pipeline/index.ts` has `pluginSafetyWarning()` that
  converts safety warnings into caveats by parsing message text.
- `src/cli/features/extract/command.ts` has `createExtractionCaveats()` and
  report helpers that already consume `warning.caveat` when present.
- Jotai and Zustand storage/global-taint warnings originate in source-specific
  plugin/writes files.
- Next cache discovery may still emit plain warning strings after plan 3.
- `PluginProvenance.kind` currently supports only coarse kinds such as
  `"state-source"`, `"router"`, and `"domain-refinement"`.

## 4. Exact File Paths and Relevant Symbols

Primary files:

- `src/core/ir/types.ts`
  - `PluginProvenance`
  - `ExtractionCaveat`
  - `ExtractionCaveats`
  - `Transition.confidence`
  - `Model.metadata.plugins`
  - `Model.metadata.extractionCaveats`
- `src/extract/engine/spi/index.ts`
  - `ExtractionWarning`
  - `SourceExtractionResult`
  - `DiscoveredEffectApi`
  - `CacheStorageFragment`
  - provider interfaces from plans 2 and 3
- `src/extract/engine/pipeline/index.ts`
  - `runExtractionPipeline()`
  - `pluginSafetyWarning()`
  - `provenanceForSource()`
  - `provenanceForRouter()`
- `src/cli/features/extract/command.ts`
  - `pluginProvenance()`
  - `createExtractionCaveats()`
  - report confidence/caveat helpers
- `src/extract/engine/ts/caveats.ts`
  - existing caveat factories such as `globalTaintCaveat()`
- `src/extract/sources/jotai/plugin.ts`
- `src/extract/sources/jotai/writes.ts`
  - `discoverJotaiSafetyWarnings()`
- `src/extract/sources/zustand/plugin.ts`
- `src/extract/sources/zustand/writes.ts`
  - `discoverZustandSafetyWarnings()`
- `src/extract/sources/swr/*` and `src/extract/sources/use-state/*` if they
  emit safety warnings
- `src/extract/sources/next/cache.ts`

## 5. Existing Patterns to Follow

- Keep caveat factories in extraction/core helper modules, not report code.
- Create caveats at the point where precision is lost.
- Keep transition `confidence` as one of `"exact"`, `"over-approx"`, or
  `"manual"`.
- Use `"manual"` only for explicit manual overlays/artifacts, not adapter
  guesses.
- Use provider ids in producer metadata so reports can group approximations.
- Prefer removing string parsing helpers instead of keeping transitional
  fallbacks.

## 6. Atomic Implementation Steps

### Step 1 - Expand provenance kinds

Files to edit:

- `src/core/ir/types.ts`
- `src/cli/registry/index.ts`
- `src/extract/engine/pipeline/index.ts`
- `src/cli/features/extract/command.ts`

Implementation:

1. Expand `PluginProvenance.kind` to include:
   - `"navigation"`;
   - `"module-roles"`;
   - `"effect-api"`;
   - `"cache-storage"`;
   - `"observation"`;
   - `"state-source"`;
   - `"domain-refinement"`.
2. Replace the old `"router"` provenance kind with `"navigation"`.
3. Stamp all registered capability providers in registry and model metadata.
4. Keep sorting deterministic by `kind` then `id`.

Acceptance criteria:

- Model metadata includes all active capability kinds.
- No production source emits `"router"` as a current provenance kind.

### Step 2 - Make structured warnings authoritative

Files to edit:

- `src/extract/engine/spi/index.ts`
- `src/extract/engine/pipeline/index.ts`
- `src/cli/features/extract/command.ts`

Implementation:

1. If not already done in plan 1, ensure `ExtractionWarning` has:
   - `message`;
   - optional `source`;
   - `caveat?: ExtractionCaveat`;
   - `confidence?: Transition["confidence"]`;
   - `producer?: { kind: PluginProvenance["kind"]; id: string }`.
2. Remove `pluginSafetyWarning()` from
   `src/extract/engine/pipeline/index.ts`.
3. Update pipeline warning collection to keep warnings as warnings and collect
   only explicit `warning.caveat` values into extraction caveats.
4. Update `createExtractionCaveats()` in the CLI so it does not parse message
   strings.
5. Preserve warning messages for human-readable reports.

Acceptance criteria:

- Production code does not parse warning message prefixes to create caveats.

### Step 3 - Convert source safety warnings

Files to edit:

- `src/extract/engine/ts/caveats.ts`
- `src/extract/sources/jotai/plugin.ts`
- `src/extract/sources/jotai/writes.ts`
- `src/extract/sources/zustand/plugin.ts`
- `src/extract/sources/zustand/writes.ts`
- any SWR/use-state warning producers found by search

Implementation:

1. Update warning producers to create structured caveats directly.
2. Replace `"Global taint ..."` message parsing with direct
   `globalTaintCaveat(...)` creation at the warning site.
3. Add producer metadata:
   - `{ kind: "state-source", id: "jotai" }`;
   - `{ kind: "state-source", id: "zustand" }`;
   - equivalent ids for other state sources.
4. Set `confidence: "over-approx"` for warnings that correspond to broad or
   global approximations.
5. Keep human-readable `message` text stable unless it is misleading.

Acceptance criteria:

- Jotai/Zustand safety warnings create typed caveats without downstream parsing.

### Step 4 - Convert cache/storage caveats

Files to edit:

- `src/extract/sources/next/cache.ts`
- `src/extract/sources/next/index.ts` or cache provider file from plan 3
- `src/cli/features/extract/command.ts`

Implementation:

1. Convert Next cache approximation warnings into `ExtractionCaveat` entries in
   `CacheStorageFragment.caveats`.
2. Attach producer metadata for the Next cache provider.
3. Ensure cache transitions created through broad abstractions have
   `confidence: "over-approx"` and exact transitions have `"exact"`.
4. Merge cache caveats into model metadata through the generic provider path.

Acceptance criteria:

- Next cache caveats appear in model metadata without command-specific parsing.

### Step 5 - Add confidence/provenance to provider outputs

Files to edit:

- `src/extract/engine/spi/index.ts`
- `src/extract/engine/ts/transition/navigation.ts`
- `src/extract/sources/next/cache.ts`
- `src/extract/sources/router/server-effects.ts`
- `src/extract/sources/next/server-effects.ts`
- `src/cli/features/extract/project.ts`
- `src/cli/features/extract/command.ts`

Implementation:

1. For navigation lowering, require or default confidence in
   `NavigationLoweringResult`.
2. For effect API discovery, add optional warning/caveat metadata to
   `DiscoveredEffectApi` if needed:
   - `caveats?: readonly ExtractionCaveat[]`;
   - `confidence?: Transition["confidence"]`;
   - `producer?`.
3. For cache/storage, ensure `CacheStorageFragment` carries provider caveats and
   all transitions include confidence.
4. For source plugin extraction, preserve existing transition confidence and
   attach caveats via structured warnings.
5. Avoid inventing exactness where the adapter is broad; use `"over-approx"`.

Acceptance criteria:

- Provider-created transitions and caveats can be attributed to a capability.

### Step 6 - Update reports and tests

Files to edit:

- `src/cli/features/extract/command.ts`
- `src/cli/registry/index.test.ts`
- `src/cli/features/extract/command.test.ts`
- source-specific warning tests

Implementation:

1. Update report output to display expanded provider kinds.
2. Update snapshots/assertions that expected `"router"` to expect
   `"navigation"`.
3. Add tests proving structured caveats survive into `Model.metadata`.
4. Add tests proving `"Global taint "` message parsing is gone.

Acceptance criteria:

- Reports remain readable and do not hide provider/capability origin.

## 7. Per-Step Files to Edit

- Step 1: `src/core/ir/types.ts`, `src/cli/registry/index.ts`,
  `src/extract/engine/pipeline/index.ts`,
  `src/cli/features/extract/command.ts`.
- Step 2: `src/extract/engine/spi/index.ts`,
  `src/extract/engine/pipeline/index.ts`,
  `src/cli/features/extract/command.ts`.
- Step 3: `src/extract/engine/ts/caveats.ts`,
  `src/extract/sources/jotai/plugin.ts`,
  `src/extract/sources/jotai/writes.ts`,
  `src/extract/sources/zustand/plugin.ts`,
  `src/extract/sources/zustand/writes.ts`, warning producers found by search.
- Step 4: `src/extract/sources/next/cache.ts`,
  `src/extract/sources/next/index.ts` or the cache provider file,
  `src/cli/features/extract/command.ts`.
- Step 5: `src/extract/engine/spi/index.ts`,
  `src/extract/engine/ts/transition/navigation.ts`,
  `src/extract/sources/next/cache.ts`,
  `src/extract/sources/router/server-effects.ts`,
  `src/extract/sources/next/server-effects.ts`,
  `src/cli/features/extract/project.ts`,
  `src/cli/features/extract/command.ts`.
- Step 6: tests and report assertions listed above.

## 8. Acceptance Criteria

- No production code parses `"Global taint "`, `"Unextractable handler "`, or
  equivalent warning prefixes to recover typed caveats.
- Structured caveats are created by source/provider code at imprecision sites.
- `PluginProvenance.kind` covers all adapter capabilities.
- `"router"` is not used as a current provenance kind.
- Cache/storage, effect API, navigation, state-source, and domain-refinement
  providers can be distinguished in metadata/report output.
- Provider-created over-approximations use `"over-approx"` confidence.

## 9. Tests to Add or Update

- `src/cli/registry/index.test.ts`
  - expanded provenance kinds for active providers.
- `src/cli/features/extract/command.test.ts`
  - structured caveats reach model metadata and report output;
  - plugin/provider labels include new capability kinds.
- `src/extract/sources/jotai/*` tests
  - storage/global warnings include caveats and producer metadata.
- `src/extract/sources/zustand/*` tests
  - storage/global warnings include caveats and producer metadata.
- `src/extract/sources/next/cache.test.ts`
  - cache provider returns caveats and transition confidence.
- `test/extraction/architecture.test.ts`
  - no production string parsing for known warning prefixes.

## 10. Verification Commands

Run after implementation:

```bash
rtk pnpm typecheck
rtk pnpm vitest run src/cli/registry/index.test.ts
rtk pnpm vitest run src/cli/features/extract/command.test.ts
rtk pnpm vitest run src/extract/sources/next/cache.test.ts
rtk pnpm vitest run test/extraction/architecture.test.ts
rtk grep -n "Global taint |Unextractable handler |pluginSafetyWarning|kind: \"router\"" src test docs --exclude-dir=docs/build
rtk git diff --check
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if expanding `PluginProvenance.kind` breaks artifact readers
  that require coordinated schema updates. Do not omit provenance silently.
- Stop and report if a warning cannot produce a meaningful structured caveat at
  its source. Add a narrowly scoped caveat type or factory rather than parsing
  messages later.
- Stop and report if confidence cannot be determined for a provider-created
  transition. Default to `"over-approx"` only when the semantics are truly broad.

## 12. Must Not Change

- Do not keep compatibility parsing for old warning strings.
- Do not label adapter guesses as `"manual"`.
- Do not change checker semantics.
- Do not edit generated artifacts.
