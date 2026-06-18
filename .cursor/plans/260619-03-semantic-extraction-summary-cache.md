# Semantic Extraction Summary Cache

## Goal

Reduce `extract` runtime by computing project-level semantic summaries once per extraction target instead of rebuilding component registries, custom-hook registries, type aliases, context bindings, and related source files for every interaction fragment.

This targets the observed Meiwa `FreeConsultPage` profile where `runProjectExtractionPipeline` spent roughly 8-9 seconds and most samples were under `extractReactSourceTransitions`, `buildComponentRegistry`, `buildCustomHookRegistry`, and TypeScript parse/bind work.

## Non-goals

- Do not change extraction semantics or emitted IR.
- Do not remove syntax-only extraction fallback.
- Do not change plugin SPI in a breaking way unless a compatibility shim is provided inside this experimental codebase.
- Do not rewrite route inventory or semantic project resolution.
- Do not introduce process-global caches that can leak across CLI invocations or tests.

## Current-State Findings

- `src/cli/features/extract/extraction-project.ts` builds a semantic project for reachable sources, then `runProjectExtractionPipeline()` invokes `runExtractionPipeline()` once per interaction fragment.
- Each call passes the same `discoverFragments`.
- `src/extract/engine/pipeline/index.ts` calls plugin `discover`, `writeChannels`, and `safetyWarnings` over all discovery fragments for each pipeline call.
- `extractReactSourceTransitions()` then:
  - collects project type aliases,
  - discovers context bindings on primary and related sources,
  - builds component registry,
  - builds custom-hook registry,
  - computes stateful list components.
- With semantic types, it uses `relatedSourceFiles`; it also passes `supplementalSources` from the same related fragments, which can duplicate scans/parses.

## Exact File Paths and Relevant Symbols

- `src/cli/features/extract/extraction-project.ts`
  - `buildClientProjectSurface`
  - `runProjectExtractionPipeline`
  - `mergeExtractionPipelineResults`
- `src/extract/engine/pipeline/index.ts`
  - `ExtractionPipelineOptions`
  - `runExtractionPipeline`
  - `discoveryRelatedFragments`
  - `semanticTypeContextForFile`
- `src/extract/engine/ts/react-source-transitions.ts`
  - `ReactSourceTransitionOptions`
  - `extractReactSourceTransitions`
  - `relatedDiscoverySourceFiles`
  - `collectProjectTypeAliases`
- `src/extract/engine/ts/components.ts`
  - `buildComponentRegistry`
  - `buildCustomHookRegistry`
  - `componentRegistryDisplayMap`
  - `customHookRegistryDisplayNames`
- `src/extract/engine/ts/context.ts`
  - `discoverContextBindings`
- `test/extract/semantic-project.test.ts`
  - semantic related-fragment tests
- `test/extraction/extraction.test.ts`
  - syntax-only related-fragment tests
- `src/cli/features/extract/command.run.test.ts`
  - end-to-end extraction behavior

## Existing Patterns to Follow

- Existing extraction code uses plain typed option bags and small helper functions.
- Semantic project access flows through `SemanticTypeContext`.
- Tests use small in-memory projects via `createSemanticProjectForTest`.
- Preserve deterministic ordering by sorting paths and IDs.

## Atomic Implementation Steps

1. Introduce a project-local summary type.
   - Add an internal type such as `ReactExtractionProjectSummary`.
   - Include:
     - canonical file list,
     - `SourceFile` lookup for related sources,
     - type alias map,
     - context bindings by file or merged context bindings,
     - component registry,
     - custom-hook registry.
   - Keep it internal to `src/extract/engine/ts` or `src/extract/engine/pipeline`; do not export it from public package entry points unless required by tests.

2. Build the summary once per `runProjectExtractionPipeline()` call.
   - In `extraction-project.ts`, build summary from `project.interactionSources`, `project.semanticProject`, and `discoverFragments`.
   - Alternatively, in `pipeline/index.ts`, memoize summary by `semanticProject` plus canonical discovery fragment file names for the duration of one `runProjectExtractionPipeline()` call.
   - Prefer an explicit summary object passed through options over a hidden module-level cache.

3. Thread the summary into `extractReactSourceTransitions()`.
   - Add optional `projectSummary` or `sharedSummary` to `ReactSourceTransitionOptions`.
   - When present:
     - reuse type aliases instead of calling `collectProjectTypeAliases`,
     - reuse merged context bindings instead of rediscovering every related source,
     - reuse component/custom-hook registries,
     - avoid rebuilding supplemental source files that are already present in the semantic project.
   - Keep the current code path for syntax-only direct callers.

4. Avoid duplicate semantic and supplemental scans.
   - When `options.types?.getSourceFile` is present, do not also pass the same related files as `supplementalSources` to registry builders.
   - Only use `supplementalSources` for syntax-only mode or for fragments missing from the semantic project.

5. Prevent plugin discovery from repeating per fragment.
   - In `runProjectExtractionPipeline()`, run state-source plugin `discover`, `writeChannels`, `safetyWarnings`, and template generation once across all discovery fragments.
   - Then run generic React transition extraction per interaction fragment with the precomputed `stateVars`, `writeChannels`, and summary.
   - Keep source plugin `extract` behavior unchanged unless it is also demonstrably repeated; if changed, add tests.

6. Add instrumentation-friendly tests.
   - Add a test with two or three related fragments that monkey-patches or wraps a small helper to count registry builds, or use observable behavior to verify the result remains identical.
   - If direct call-count testing is brittle, add a regression test ensuring semantic mode does not parse supplemental copies when `getSourceFile` returns the project source file.

## Per-Step Files to Edit

- Step 1: new helper file under `src/extract/engine/ts/` or `src/extract/engine/pipeline/`
- Step 2: `src/cli/features/extract/extraction-project.ts`, `src/extract/engine/pipeline/index.ts`
- Step 3: `src/extract/engine/ts/react-source-transitions.ts`
- Step 4: `src/extract/engine/ts/react-source-transitions.ts`, `src/extract/engine/ts/components.ts` if options need tightening
- Step 5: `src/extract/engine/pipeline/index.ts`
- Step 6: `test/extract/semantic-project.test.ts`, `test/extraction/extraction.test.ts`, or `src/cli/features/extract/command.run.test.ts`

## Acceptance Criteria

- Extraction output is byte-equivalent or semantically equivalent for existing tests.
- Syntax-only `extractReactSourceTransitions()` callers still work.
- Semantic related custom hooks and imported components still inline correctly.
- Registry/type/context summaries are built once per target, not once per fragment.
- Real-app single target timing improves materially on Meiwa `FreeConsultPage` and Coffee `_customer/home` after rebuilding.

## Tests to Add or Update

- Add semantic multi-fragment tests covering:
  - imported component registry reuse,
  - imported custom hook registry reuse,
  - context binding reuse,
  - syntax-only fallback.
- Update tests only for internal timing-sensitive assumptions, not for model behavior.

## Verification Commands

```bash
rtk pnpm test test/extract/semantic-project.test.ts
rtk pnpm test test/extraction/extraction.test.ts
rtk pnpm test src/cli/features/extract/command.run.test.ts
rtk pnpm test src/cli/features/extract/command.run.plugins.test.ts
rtk pnpm typecheck
```

Optional profiling commands:

```bash
rtk proxy /usr/bin/time -p node /Users/hari/proj/modality-ts/dist/cli/cli.js extract src/app/consult/FreeConsultPage.tsx --out /tmp/free.model.json --app-model /tmp/free.props.ts
rtk proxy node --cpu-prof --cpu-prof-dir /tmp/modality-prof /Users/hari/proj/modality-ts/dist/cli/cli.js extract src/app/consult/FreeConsultPage.tsx --out /tmp/free.model.json --app-model /tmp/free.props.ts
```

## Risks, Ambiguities, and Stop Conditions

- Stop and report if summaries require changing plugin SPI broadly. The first pass should keep plugin APIs stable.
- Stop and report if output changes for symbol-keyed imported hooks/components; that is a correctness regression.
- Stop and report if summary caching introduces stale data between tests or between separate extraction targets.
- Do not introduce a module-global cache keyed only by file names; tests and CLI runs need isolated state.

