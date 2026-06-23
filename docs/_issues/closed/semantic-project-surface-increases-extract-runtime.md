# Semantic Project Surface Increases Extract Runtime

## Summary

`modality extract` became slower after the 0.0.25 to 0.0.27 updates because extraction now builds and analyzes a compiler-backed reachable project surface instead of only the requested source text.

For Coffee DX, extracting `apps/web/app/_customer/home.tsx` now includes 17 source files in the report and runs semantic project creation, import reachability, plugin discovery, and React project-summary work across that surface.

## Why This Matters

The broader semantic surface improves correctness for imported components, server action aliases, route inventory, and type/domain inference. However, users experience it as a large regression when a single-file extraction now pays for a multi-file TypeScript project walk.

## Reproduction

Use the sibling Coffee DX app:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
rtk proxy /usr/bin/time -p node /Users/hari/proj/modality-ts/dist/cli/cli.js extract \
  app/_customer/home.tsx \
  --out /tmp/customer-home.model.json \
  --app-model /tmp/customer-home.props.ts \
  --report /tmp/customer-home.extract-report.json
```

Observed locally on the current checkout:

```text
✓ app/_customer/home.tsx 2.21s
real 2.71
```

The reported user case was about 6.66s for extract.

The generated model/report included 17 source files, including route components, shared UI components, feature queries/actions, printer client code, lib files, `routes.ts`, and `db/schema.ts`.

## Expected Behavior

Single-entry extraction should either remain close to single-file cost, or the CLI/report should make clear which project-surface phases dominate runtime and provide ways to narrow the surface.

## Observed Behavior

The current pipeline intentionally performs multiple project-wide steps:

- `buildClientProjectSurface()` creates a semantic module resolver.
- `sourceWithReachableImports()` walks reachable render/interaction/type imports.
- `buildClientProjectSurface()` creates a second semantic project over included sources.
- `runProjectExtractionPipeline()` builds a project-level React extraction summary.
- `runPluginDiscoveryPhase()` runs discovery, write-channel extraction, and safety warnings over all discovery fragments.

Relevant code:

- `src/cli/features/extract/extraction-project.ts`: `buildClientProjectSurface()`
- `src/cli/features/extract/project.ts`: `sourceWithReachableImports()`
- `src/cli/features/extract/extraction-project.ts`: `runProjectExtractionPipeline()`
- `src/extract/engine/pipeline/index.ts`: `runPluginDiscoveryPhase()`
- `src/extract/lang/ts/driver/react-extraction-project-summary.ts`: `buildReactExtractionProjectSummary()`

## Possible Fix Directions

- Add phase timing diagnostics to extraction reports.
- Cache semantic project creation between module resolution and included-source extraction.
- Cache parsed `SourceFile`s inside `sourceWithReachableImports()` instead of reparsing records during fixpoint and output phases.
- Provide an explicit narrow extraction mode for users who want entry-file-only behavior.
- Add a Coffee DX extract canary with budgets for source count and phase timings.
