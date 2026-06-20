---
name: cli-generate-extract-pipeline
description: Intended modality CLI pipeline — generate (modals.ts) before properties, then extract (model.json + slices), then check
metadata:
  type: project
---

The intended modality CLI workflow (drives the planned `modality generate` command):

1. Create empty `*.props.ts` files (these *register* which `*.tsx` source to model; discovery keys off props.ts → derives the sibling `.tsx`).
2. `modality generate` → emits the corresponding `*.modals.ts` typed-handle modules. **This requires only the source analysis (the extracted model), NOT properties** — `emitComponentModalModules(model, appModelPath)` is a pure function of the model. So generate must run *before* any properties are written and must never call `loadProperties`/slicing.
3. Write properties in `*.props.ts`, importing handles from the generated `*.modals.ts`.
4. `modality extract` → emits `model.json` + `*.slices/*.model.json` (the sliced models). **Slices are the only props-dependent artifact.** extract must be resilient to broken/empty props: skip slices for that file, report the error politely, exit 0.
5. `modality check`.

**Why:** Properties are only needed for the sliced `model.json`, not for the handles. Bundling modal codegen + property-dependent slicing into one `extract` command created a chicken-and-egg (a broken/missing props file blocked regenerating the very `modals.ts` you import in props).

**How to apply:** Split a shared `buildExtractionModel(options)` core out of `runExtractCommand` (the source→model analysis, ~up to where `model`/`report` are finalized, before property loading). `generate` = buildExtractionModel → emit `*.modals.ts`. `extract` = buildExtractionModel → write `model.json`/`app.model.ts` + resilient property loading + slices. `check` still works without physical `*.modals.ts` because `rewriteImportedSymbols` re-derives the symbols in-memory. Do NOT make generate depend on `model.json` existing first. See [[property-api-overhaul]]. Plan: `.cursor/plans/260620-04-cli-output-production-quality.md`.
