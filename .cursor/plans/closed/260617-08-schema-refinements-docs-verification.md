# Part 4 of 4: Schema Refinements, Documentation, and End-to-End Verification

## Goal

Finish the feature by formalizing schema libraries as refinement providers on top of semantic TypeScript inference, adding end-to-end tests for Zod/ArkType non-numerical shapes where TypeScript preserves the type, and updating docs to describe the new architecture and its limits.

## Non-goals

- Do not implement a full Zod or ArkType runtime schema interpreter.
- Do not infer runtime-only constraints that TypeScript erases unless an existing adapter already supports them.
- Do not add new IR domain kinds.
- Do not change overlay semantics.
- Do not make checker search larger by default through aggressive product-domain inference without tests and warnings.

## Current-State Findings

- Numeric schema adapters live under `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/adapters/`.
- Existing Zod/ArkType support is numeric and AST-chain based.
- Docs already state the intended architecture in `/Users/hari/proj/modality-ts/docs/architecture/extraction-pipeline.md`: `D(τ)` maps TypeScript types to domains structurally.
- `/Users/hari/proj/modality-ts/docs/concepts/state-and-domains.md` already lists non-numerical domain kinds and warns that bare `string`/`number` must not become accidental finite domains.
- Extraction reports surface caveats and coarse domains.
- Model trust ledger domain provenance currently tracks overlay refinement only in metadata.

## Exact File Paths and Relevant Symbols

- `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/adapters/zod.ts`
  - `resolveZodNumericSchema`
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/adapters/arktype.ts`
  - `resolveArktypeNumericSchema`
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/resolver.ts`
  - `resolveNumericDomain`
- `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts`
  - semantic wrapper from Parts 2 and 3
- `/Users/hari/proj/modality-ts/src/core/ir/types.ts`
  - `Model.metadata.domainProvenance`
  - `ExtractionCaveat`
- `/Users/hari/proj/modality-ts/src/cli/features/check/command.ts`
  - `domainReportEntry`
- `/Users/hari/proj/modality-ts/docs/architecture/extraction-pipeline.md`
- `/Users/hari/proj/modality-ts/docs/concepts/state-and-domains.md`
- `/Users/hari/proj/modality-ts/docs/guides/refining-domains-and-overlays.md`
- `/Users/hari/proj/modality-ts/test/extract/numeric-domain-resolver.test.ts`
- `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`

## Existing Patterns to Follow

- Existing schema adapters should remain narrowly responsible for refinements TypeScript does not preserve.
- Use caveats for unprovable or erased constraints.
- Keep docs honest: schema-to-TypeScript-to-IR is not equivalent to full schema interpretation.
- Prefer end-to-end extraction tests over fragile AST-parser tests for non-numerical schema behavior.
- Do not invent provenance categories unless they are immediately displayed or useful in reports.

## Atomic Implementation Steps

1. Define the schema refinement boundary in code comments and API names.
   - Add comments near semantic useState/domain wrappers explaining inference order:
     1. schema/native numeric refinement adapters when they can prove finite numeric constraints
     2. TypeScript semantic type mapper for structural finite domains
     3. conservative token fallback
   - Keep existing numeric resolver names if renaming causes broad churn.

2. Add end-to-end tests for Zod non-numerical type flow.
   - In `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`, add a fixture:
     - `schema.ts` exports a Zod schema and `export type State = z.infer<typeof StateSchema>`.
     - `App.tsx` imports `type State` and uses `useState<State>`.
   - Use a schema whose inferred TypeScript type preserves finite non-numerical domains, for example:
     - `status: z.enum(["idle", "posting", "failed"])`
     - `flag: z.boolean()`
     - Optional/nullable field if TypeScript exposes it clearly.
   - Assert extracted domain is `record` with `enum` and `bool`.
   - If Zod inference cannot be resolved in the test environment because dependencies/types are unavailable, stop and report rather than replacing it with an AST heuristic.

3. Add end-to-end tests for ArkType non-numerical type flow.
   - Add a fixture with ArkType exporting the inferred static type if the installed ArkType package exposes a standard type helper.
   - Assert imported inferred type maps to `record`/`enum`/`bool` when the TypeScript checker can see it.
   - If ArkType static inference does not expose finite literal details through `ts.TypeChecker`, document the limitation and keep the test focused on a manually exported type alias derived from ArkType only if that is an actual project-supported pattern.

4. Preserve existing numeric schema adapter tests.
   - Keep `/Users/hari/proj/modality-ts/test/extract/numeric-domain-resolver.test.ts` passing.
   - Add explicit regression tests:
     - Zod bounded int still uses existing numeric adapter.
     - ArkType bounded int still uses existing numeric adapter.
     - Zod `z.string()` inferred as broad `string` still falls back to `tokens(1)` when no finite literal information is present.

5. Add cardinality guard warnings for newly inferred structured domains if needed.
   - Check existing `wideNumericReachabilityWarnings` and coarse-domain reporting before adding anything.
   - If semantic mapping can produce unexpectedly large record/tagged product domains, add a narrow extraction warning based on `domainCardinality`.
   - Do not block exact finite domains by default; only warn when cardinality exceeds an existing or newly named threshold.

6. Update documentation.
   - In `/Users/hari/proj/modality-ts/docs/architecture/extraction-pipeline.md`, update P0/P2 to mention `ts.Program`/`ts.TypeChecker`.
   - In `/Users/hari/proj/modality-ts/docs/concepts/state-and-domains.md`, revise schema adapter language:
     - TypeScript semantic inference is primary for structural domains.
     - Zod/ArkType adapters provide refinements for constraints erased from TypeScript, currently numeric bounds.
     - Runtime-only schema predicates are not interpreted unless represented in TypeScript or an adapter.
   - In `/Users/hari/proj/modality-ts/docs/guides/refining-domains-and-overlays.md`, add guidance for when to use overlays versus schema/static types.

7. Run broad verification and fix fallout.
   - Run focused tests first.
   - Run full extraction-related tests.
   - Run typecheck, architecture, and formatter/linter.
   - If formatting changes many unrelated files, stop and report before committing broad churn.

## Per-Step Files to Edit

- Step 1:
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/domains.ts`
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/type-domains.ts`
  - `/Users/hari/proj/modality-ts/src/extract/engine/ts/numeric/resolver.ts`
- Steps 2-4:
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`
  - `/Users/hari/proj/modality-ts/test/extract/numeric-domain-resolver.test.ts`
- Step 5:
  - `/Users/hari/proj/modality-ts/src/cli/features/extract/command.ts`
  - `/Users/hari/proj/modality-ts/src/core/ir/domains.ts` only if a shared threshold belongs there
  - `/Users/hari/proj/modality-ts/src/core/ir/types.ts` only if adding a caveat/provenance kind is necessary
- Step 6:
  - `/Users/hari/proj/modality-ts/docs/architecture/extraction-pipeline.md`
  - `/Users/hari/proj/modality-ts/docs/concepts/state-and-domains.md`
  - `/Users/hari/proj/modality-ts/docs/guides/refining-domains-and-overlays.md`

## Acceptance Criteria

- Documentation accurately states:
  - TypeScript semantic type inference is the primary structural domain source.
  - Zod/ArkType non-numerical support works when their inferred TypeScript type preserves finite structure.
  - Numeric schema bounds still require schema/native refinement adapters unless encoded in TypeScript.
  - Runtime-only refinements remain unsupported without adapters/overlays.
- Zod and ArkType end-to-end tests demonstrate the intended feature or explicitly document a package/type-system limitation.
- Existing numeric schema behavior is unchanged.
- Extraction report/trust ledger remains honest for token fallbacks and coarse domains.
- Full TypeScript typecheck passes.

## Tests to Add or Update

- `/Users/hari/proj/modality-ts/src/cli/features/extract/command.test.ts`
  - Zod inferred non-numerical `record`/`enum`/`bool` test.
  - ArkType inferred non-numerical test if feasible.
  - Imported broad string/number fallback regression.
- `/Users/hari/proj/modality-ts/test/extract/numeric-domain-resolver.test.ts`
  - Existing numeric schema regression assertions, if semantic wrapper changes call flow.
- Optionally add docs test updates if the repo has docs validation snapshots.

## Verification Commands

- `rtk pnpm vitest run src/cli/features/extract/command.test.ts`
- `rtk pnpm vitest run test/extract/numeric-domain-resolver.test.ts`
- `rtk pnpm vitest run test/extract/semantic-domain-resolver.test.ts`
- `rtk pnpm test`
- `rtk pnpm typecheck`
- `rtk pnpm architecture`
- `rtk pnpm fix`

## Risks, Ambiguities, and Stop Conditions

- Stop and report if installed Zod or ArkType type definitions do not preserve finite literal schema information through `ts.TypeChecker`. Do not compensate by adding broad schema AST heuristics for non-numerical shapes.
- Stop and report if TypeScript checker setup cannot resolve package type declarations under the in-memory project. The correct fix may belong in Part 1 compiler host/module resolution, not in schema-specific code.
- Do not expand schema adapters into full validators. That would duplicate library semantics and create unsound drift.
- Do not add cardinality warnings that turn exact useful finite domains into errors. Warnings should inform, not suppress extraction.
