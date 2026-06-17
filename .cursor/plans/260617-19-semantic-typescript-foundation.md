# Semantic TypeScript Foundation - Split Index

Status: split index.
Date: 2026-06-17.
Plan family: A - Semantic TypeScript Foundation.

This original monolithic plan has been split into smaller Composer 2 handoff
plans. Do not implement from this index directly. Implement the split plans in
order, because later plans assume the semantic project APIs and source identity
work introduced by earlier plans.

## Split Plans

1. `.cursor/plans/260617-19-1-semantic-project-config-resolver.md`
   - Replace reduced tsconfig parsing with TypeScript parsed config.
   - Add canonical module/file/symbol resolver APIs to `SemanticProject`.

2. `.cursor/plans/260617-19-2-compiler-backed-project-surface.md`
   - Replace custom project-surface path resolution with compiler module
     resolution.
   - Keep import syntax scanning only for discovering import declarations and
     referenced identifiers.

3. `.cursor/plans/260617-19-3-semantic-source-identity-pipeline.md`
   - Stop concatenating fragment source as the semantic source of truth.
   - Ensure extraction uses `ts.Node`s from the same `ts.SourceFile` as the
     active semantic context.

4. `.cursor/plans/260617-19-4-symbol-keyed-write-channels.md`
   - Add symbol-keyed write channels and setter bindings.
   - Keep local names only as display/fallback fields.

5. `.cursor/plans/260617-19-5-component-hook-symbol-registries.md`
   - Move component and custom hook discovery/resolution onto symbol-keyed
     registries.
   - Keep display names readable while internal matching uses symbol identity.

6. `.cursor/plans/260617-19-6-semantic-domain-inference.md`
   - Centralize checker-backed domain inference.
   - Retire alias-map plumbing from normal compiler-backed paths.

7. `.cursor/plans/260617-19-7-semantic-import-recognition-cleanup.md`
   - Add shared semantic import/export recognition helpers.
   - Migrate Jotai, Zustand, and SWR import recognition.
   - Remove obsolete syntax-only infrastructure after all prior migrations.

## Family-Level Must Not Change

- Do not change checker IR semantics, Rust checker behavior, TLA export, or
  state-space slicing in this plan family.
- Do not add new library support. Existing React, Jotai, Zustand, SWR, Zod, and
  router support should be migrated onto shared semantic infrastructure.
- Do not execute app code or rely on bundler-specific runtime behavior.
- Do not edit generated artifacts or `dist/`.
- Do not edit `.cursor/plans/260617-18-versatility-plan-of-plans.md` or other
  unrelated worker plan files.
- Do not silently downgrade semantic misses to guessed domains or guessed
  writes. Use fallback only when no semantic project exists, and report
  ambiguity when a modeled write could be missed.
