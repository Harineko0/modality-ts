# Fix Semantic Literal Mapping and Multi-File Discovery Context

## Goal

Fix two regressions introduced by the semantic TypeScript extraction work:

1. Preserve literal initializer domains when semantic context is available, especially for initializer-only Jotai and Zustand state fields.
2. Ensure multi-file extraction discovery uses the semantic `SourceFile` that corresponds to each real source fragment, so imported type domains are not lost or overwritten by first-result merge order.

The fixes should keep semantic TypeScript inference as the primary structural domain source while preserving the existing conservative fallback behavior.

## Non-goals

- Do not change `AbstractDomain`, checker IR, or model schema.
- Do not broaden schema-library behavior or add new Zod/ArkType parsing.
- Do not refactor source plugins beyond the context/threading needed for these regressions.
- Do not remove semantic inference or return to AST-only inference.
- Do not change transition extraction, write-channel summarization, router behavior, overlays, or replay behavior except where tests naturally observe corrected domains.
- Do not introduce global mutable registries or process-wide semantic context.

## Current-State Findings

- `inferDomainFromTypeDetailed` in `src/extract/engine/ts/type-domains.ts` immediately calls `checker.getApparentType(type)` and then checks literals, unions, primitives, arrays, and objects on the apparent type.
- For expression inference, TypeScript often gives literal expressions literal types first, but `getApparentType` converts string literal types into `String` object-like types. The current mapper then treats `"idle"` as a record with a `length` field instead of an enum.
- Numeric literal expressions can similarly lose literal precision and become `tokens(1)` instead of a one-value `boundedInt`.
- `inferDomainFromExpressionSemanticDetailed` is used by initializer-only state-provider paths, including Jotai and Zustand.
- Jotai `atom("idle")` with semantic context currently maps to `record { length: tokens(1) }`, and `atom(0)` maps to `tokens(1)`.
- Zustand `create(() => ({ label: "idle", count: 0 }))` with semantic context currently maps `label` to `record { length: tokens(1) }` and `count` to `tokens(1)`.
- `runExtractionPipeline` merges all `discoverFragments` into a single synthetic discovery input when more than one fragment is present.
- That merged input is assigned `options.fileName`, so plugin discovery traverses text from multiple files while receiving semantic context for only one file.
- `runProjectExtractionPipeline` calls `runExtractionPipeline` once per fragment and passes the same full `discoverFragments` array to each call.
- The merge in `mergeExtractionPipelineResults` keeps the first state var for each id. If the first fragment run discovered another file’s state with the wrong semantic context, the later correct result can be discarded.

## Exact File Paths and Relevant Symbols

- `src/extract/engine/ts/type-domains.ts`
  - `inferDomainFromTypeDetailed`
  - `inferDomainFromExpressionSemanticDetailed`
  - `domainFromUnionType`
  - `inferUnionMembers`
  - `domainFromObjectType`
  - `tryTaggedUnion`
  - `isBroadString`
  - `isBroadNumber`
  - `isBooleanLike`
- `src/extract/engine/pipeline/index.ts`
  - `ExtractionPipelineOptions`
  - `runExtractionPipeline`
  - local `discoveryFragments`
  - local `mergedDiscoveryFragment`
  - local `discoveryInputs`
  - `semanticTypeContextForFile`
- `src/cli/features/extract/command.ts`
  - `runProjectExtractionPipeline`
  - `mergeExtractionPipelineResults`
- `src/extract/sources/jotai/domains.ts`
  - `domainFromExpression`
  - `inferAtomDomain`
- `src/extract/sources/zustand/domains.ts`
  - `inferFieldDomain`
- `test/extract/semantic-domain-resolver.test.ts`
- `test/extract/semantic-project.test.ts`
- `src/cli/features/extract/command.test.ts`
- `test/sources/jotai/jotai-source.test.ts`
- `test/sources/zustand/zustand-source.test.ts`

## Existing Patterns to Follow

- Preserve exact finite literal domains where TypeScript exposes them.
- Keep broad `string` and broad `number` as `tokens(1)`, with the existing numeric caveat behavior for broad numbers when a `varId` is available.
- Keep arrays and tuples as `lengthCat`.
- Keep object/interface inference based on checker properties.
- Keep AST fallback behavior when semantic information is unavailable or semantic inference returns only an unhelpful token domain.
- Keep plugin discovery contexts simple and explicit: pass source text, filename, optional semantic context, and optional domain refinement providers.
- Prefer focused tests for regression cases before broad test churn.

## Atomic Implementation Steps

1. Add failing semantic literal regression tests.
   - Add semantic mapper tests for direct expression inference:
     - string literal expression maps to `{ kind: "enum", values: ["idle"] }`
     - numeric literal expression maps to `{ kind: "boundedInt", min: 0, max: 0 }`
     - boolean literal expression maps to `{ kind: "bool" }`
     - broad typed expression such as `const label: string = "idle"; label` still maps to `{ kind: "tokens", count: 1 }`
   - Add source-provider regression tests with semantic context:
     - Jotai `atom("idle")` and `atom(0)` preserve enum/boundedInt domains and initial values.
     - Zustand `label: "idle"` and `count: 0` preserve enum/boundedInt domains and initial values.
   - These tests should fail before the implementation change.

2. Fix semantic type mapping to inspect original types before apparent object types.
   - In `inferDomainFromTypeDetailed`, split the current `target` concept into:
     - the original `type` for literal, primitive, union, broad string/number, boolean, nullish, any/unknown/never/template/symbol, and array/tuple checks.
     - an apparent/object type only for object/interface property inference where TypeScript needs apparent members.
   - Check string, number, and boolean literal types before calling `checker.getApparentType`.
   - Check unions on the original type so unions of literals remain exact.
   - Check broad `string` and broad `number` on the original type before object handling.
   - Only call `checker.getApparentType(type)` when entering object handling, and pass the appropriate object type into `domainFromObjectType`.
   - Preserve recursion detection, but ensure it tracks the type being structurally expanded rather than the apparent type of a literal primitive.

3. Add guard tests for primitive object-wrapper false positives.
   - Add tests that a semantic string literal does not become a record with a `length` field.
   - Add tests that broad `string` does not become a record with a `length` field.
   - Add tests that `String`, `Number`, or other object-wrapper types fall back conservatively if they appear in user types. Do not attempt to model boxed primitives structurally.

4. Fix multi-file discovery to use per-fragment semantic contexts.
   - In `runExtractionPipeline`, remove the behavior that collapses multiple `discoverFragments` into one merged discovery input for plugin discovery/write-channel/safety-warning phases.
   - Use each real fragment as its own `discoveryInput` so `semanticTypeContextForFile(options.semanticProject, fragment.fileName)` matches the source text being parsed.
   - Keep supplemental type alias collection separate:
     - It may continue to concatenate fragment text for `additionalTypeAliases`.
     - It must not affect plugin discovery `fileName` or `types.sourceFile`.
   - Ensure plugin `discover`, `writeChannels`, and `safetyWarnings` all receive the matching fragment filename and matching semantic context.

5. Simplify or harden multi-file CLI orchestration.
   - Revisit `runProjectExtractionPipeline` after step 4.
   - Prefer one of these minimal approaches:
     - Pass only the current fragment as `discoverFragments` during each per-fragment `runExtractionPipeline` call, because every call is already scoped to one `sourceText`/`fileName`.
     - Or call `runExtractionPipeline` once with all fragments if transition extraction and result merging remain correct.
   - Choose the smaller, safer diff after inspecting existing multi-file tests.
   - The important invariant is: no plugin discovery should parse merged text while using a single real file’s semantic context.

6. Add a multi-file regression test for semantic imported domains.
   - Use at least two React component files and one imported `types.ts`.
   - File A should contain a simple local state var.
   - File B should import `type Status = "idle" | "done"` and use `useState<Status>("idle")`.
   - Run extraction over both files.
   - Assert the final model contains `local:B.status` or the actual component id with an enum domain, not `tokens(1)`.
   - Make the test sensitive to merge order by ordering files so the previous implementation would keep the wrong first result.

7. Re-run existing semantic and source-provider tests.
   - Fix any fallout by tightening the semantic mapper rather than adding source-provider-specific workarounds.
   - If a provider expects initializer literals to stay broad under semantic context, stop and report; this would contradict existing AST fallback behavior and should be decided explicitly.

## Per-Step Files to Edit

- Step 1:
  - `test/extract/semantic-domain-resolver.test.ts`
  - `test/sources/jotai/jotai-source.test.ts`
  - `test/sources/zustand/zustand-source.test.ts`
- Step 2:
  - `src/extract/engine/ts/type-domains.ts`
- Step 3:
  - `test/extract/semantic-domain-resolver.test.ts`
- Step 4:
  - `src/extract/engine/pipeline/index.ts`
- Step 5:
  - `src/cli/features/extract/command.ts`
- Step 6:
  - `src/cli/features/extract/command.test.ts`
- Step 7:
  - only files required by test fallout; avoid unrelated refactors

## Acceptance Criteria

- Semantic expression inference maps string literals to enum domains, numeric literals to one-value bounded integer domains, and boolean literals to bool domains.
- Broad `string` and broad `number` remain `tokens(1)`, with existing broad-number caveats preserved.
- Jotai initializer-only primitive atoms keep the same domains under semantic context that they had without semantic context.
- Zustand initializer-only primitive fields keep the same domains under semantic context that they had without semantic context.
- Multi-file extraction does not discover state from file B using file A’s semantic `SourceFile`.
- Imported type aliases in multi-file extraction produce the same domains regardless of input file order.
- Existing semantic imported-type behavior remains intact for `enum`, `record`, `tagged`, `option`, arrays, and numeric unions.
- No engine import from `src/extract/type-libraries/*` is introduced.
- Zod/ArkType numeric refinement provider behavior remains unchanged.

## Tests to Add or Update

- `test/extract/semantic-domain-resolver.test.ts`
  - Add direct semantic expression tests for string, number, boolean literals.
  - Add broad primitive regressions showing `string` and `number` do not narrow from literal initializers.
  - Add boxed primitive fallback tests if straightforward with the TypeScript checker.
- `test/sources/jotai/jotai-source.test.ts`
  - Add semantic-context test for `atom("idle")`.
  - Add semantic-context test for `atom(0)`.
- `test/sources/zustand/zustand-source.test.ts`
  - Add semantic-context test for initializer-only `label: "idle"`.
  - Add semantic-context test for initializer-only `count: 0`.
- `src/cli/features/extract/command.test.ts`
  - Add multi-file extraction test with two component files where only one file uses an imported semantic type.
  - Assert final model domain, not just the direct mapper output.
- Update snapshots or exact plugin output expectations only if they legitimately change because corrected domains are now more precise.

## Verification Commands

- `rtk pnpm vitest run test/extract/semantic-domain-resolver.test.ts`
- `rtk pnpm vitest run test/sources/jotai/jotai-source.test.ts`
- `rtk pnpm vitest run test/sources/zustand/zustand-source.test.ts`
- `rtk pnpm vitest run src/cli/features/extract/command.test.ts`
- `rtk pnpm vitest run test/extract/semantic-project.test.ts`
- `rtk pnpm vitest run test/extract/type-libraries/zod-domain-refinement.test.ts test/extract/type-libraries/arktype-domain-refinement.test.ts`
- `rtk pnpm typecheck`
- `rtk pnpm architecture`
- `rtk pnpm fix`

## Risks, Ambiguities, and Stop Conditions

- Stop and report if preserving literal expression domains causes broad typed values like `const x: string = "idle"; useState(x)` to become finite. That would be unsound; fix the mapper to distinguish literal expression types from broad variable types.
- Stop and report if TypeScript exposes boxed primitive object types in a way that makes it unclear whether to model them as records. Prefer conservative `tokens(1)` over structural modeling of boxed primitives.
- Stop and report if removing merged discovery inputs breaks cross-file source-provider behavior that depends on scanning all fragments simultaneously. The correct fix may require a separate supplemental project context instead of merged parse text.
- Stop and report if deduping state vars in multi-file extraction still keeps a less precise result after per-fragment discovery is fixed. Do not solve this by arbitrary domain preference ordering without first understanding why duplicates remain.
- Do not add source-plugin-specific literal hacks to Jotai or Zustand unless the shared semantic mapper cannot safely distinguish the cases. The fundamental fix belongs in `type-domains.ts`.
- Do not weaken architecture boundaries or reintroduce type-library adapter imports into the engine.
