# TSConfig JSONC Extraction Regression

Status: ready for implementation (Cursor Composer 2).
Date: 2026-06-17.

## 1. Goal

Fix and lock in the extraction behavior described in
`docs/_issues/tsconfig-jsonc-extraction-fails.md`: `modality extract` must read
`tsconfig.json` files containing normal TypeScript/Next.js JSONC comments before
source analysis, and path alias resolution must continue to work from that
parsed config.

The intended implementation is the existing narrow fix in
`src/cli/features/extract/command.ts`: parse TSConfig text with TypeScript's
JSONC-aware parser instead of `JSON.parse`. Add or preserve focused regression
coverage in `src/cli/features/extract/command.test.ts`.

## 2. Non-goals

- Do not redesign TSConfig discovery. Keep nearest-ancestor `tsconfig.json`
  lookup in `findNearestTsConfig`.
- Do not implement full TypeScript project loading, `extends`, project
  references, or include/exclude semantics in this issue unless the existing
  code already does so.
- Do not change import graph traversal, Next.js extraction, semantic project
  construction, model checking, CLI option parsing, or report formatting.
- Do not introduce a hand-rolled comment stripper or permissive JSON parser.
  Use TypeScript's own TSConfig parser API.
- Do not edit unrelated docs issue files.
- Do not close or delete `docs/_issues/tsconfig-jsonc-extraction-fails.md`
  unless explicitly asked.

## 3. Current-state findings

- `docs/_issues/tsconfig-jsonc-extraction-fails.md` reports extraction failing
  before source analysis when an app's `tsconfig.json` contains comments.
- The failure source is `readTsConfigResolution` in
  `src/cli/features/extract/command.ts`, which previously used `JSON.parse` on
  `tsconfig.json`.
- The local worktree currently has the intended code fix already applied:
  `readTsConfigResolution` reads the file text, calls
  `ts.parseConfigFileTextToJson(tsconfigPath, sourceText)`, throws a flattened
  TypeScript diagnostic on parse error, and then reads `compilerOptions.baseUrl`
  and `compilerOptions.paths` from `parseResult.config`.
- `src/cli/features/extract/command.ts` already imports TypeScript as
  `import * as ts from "typescript";`, so no new dependency is required.
- The local worktree also currently has a focused regression test in
  `src/cli/features/extract/command.test.ts` named
  `"reads commented tsconfig.json files when resolving paths"`.
- That test creates a temporary project, writes a commented `tsconfig.json` with
  `baseUrl` and `paths`, imports a component through the alias `~/ui/Button`,
  runs `runExtractCommand`, and asserts the imported button callback transition
  is extracted.
- This is the correct coverage level: it proves JSONC parsing happens before
  import reachability and proves the parsed `paths` data is used, not merely
  tolerated.

## 4. Exact file paths and relevant symbols

Edit only these files unless verification reveals a directly related failure:

```text
src/cli/features/extract/command.ts
src/cli/features/extract/command.test.ts
```

Relevant symbols in `src/cli/features/extract/command.ts`:

- `loadExtractionProject(sourcePaths)`
- `buildClientProjectSurface(project, adapter)`
- `readTsConfigResolution(startDir)`
- `findNearestTsConfig(startDir)`
- `TsConfigResolution` imported from `./project.js`
- `sourceWithReachableImports(...)`
- `createSemanticProject(...)`

Relevant symbols in `src/cli/features/extract/command.test.ts`:

- `describe("runExtractCommand", ...)`
- `runExtractCommand(...)`
- Existing tempfile patterns using `mkdtemp(join(tmpdir(), "..."))`
- Existing filesystem fixture writes using `mkdir` and `writeFile`
- Existing transition assertions using
  `result.model.transitions.map((transition) => transition.id)`

## 5. Existing patterns to follow

- Keep the test colocated with other `runExtractCommand` integration-style CLI
  extraction tests in `src/cli/features/extract/command.test.ts`.
- Use temporary directories under `tmpdir()` rather than adding repository
  fixtures for this narrow case.
- Write small inline TSX fixture files with `writeFile`, matching neighboring
  tests.
- Assert on stable model behavior, not implementation internals. For this issue,
  assert the transition reached through a path alias import exists.
- Keep the parser implementation inside `readTsConfigResolution`; callers should
  continue receiving the same `TsConfigResolution` shape.
- Preserve existing two-space indentation, double quotes, semicolons, and
  NodeNext ESM imports.

## 6. Atomic implementation steps

### Step 1: Confirm the code fix exists

File to edit:

```text
src/cli/features/extract/command.ts
```

Implementation:

- In `readTsConfigResolution`, ensure the code reads `tsconfig.json` as UTF-8
  text.
- Parse with:

```ts
const parseResult = ts.parseConfigFileTextToJson(tsconfigPath, sourceText);
```

- If `parseResult.error` exists, throw:

```ts
throw new Error(
  ts.flattenDiagnosticMessageText(parseResult.error.messageText, "\n"),
);
```

- Continue deriving `compilerOptions.baseUrl` and `compilerOptions.paths` from
  `parseResult.config`.
- Keep the return shape as `{ baseUrl, paths }`.

Stop and report if:

- `readTsConfigResolution` has moved or no longer owns TSConfig parsing.
- `TsConfigResolution` no longer represents only `baseUrl` and `paths`.
- The codebase already uses a shared TSConfig parser utility elsewhere that
  should be reused instead.

### Step 2: Add or preserve the JSONC regression test

File to edit:

```text
src/cli/features/extract/command.test.ts
```

Implementation:

- Add a test under `describe("runExtractCommand", ...)` near the other basic
  extraction command tests.
- Name it:

```text
reads commented tsconfig.json files when resolving paths
```

- Build a temporary project:
  - `src/App.tsx`
  - `src/ui/Button.tsx`
  - `tsconfig.json`
- Ensure `tsconfig.json` contains a real block comment inside
  `compilerOptions`, plus:

```jsonc
"baseUrl": ".",
"paths": {
  "~/*": ["./src/*"]
}
```

- In `src/App.tsx`, import the button through the alias:

```ts
import { Button } from "~/ui/Button";
```

- Make the button callback update React state so extraction produces a stable
  transition.
- Run `runExtractCommand({ sourcePath, modelPath })`.
- Assert:

```ts
expect(result.model.transitions.map((transition) => transition.id)).toEqual([
  "App.onClick.status",
]);
```

Stop and report if:

- The transition id convention has changed for component callback extraction.
- Alias imports are no longer resolved by `runExtractCommand` without additional
  CLI options.
- The test passes even if `readTsConfigResolution` is temporarily changed back
  to `JSON.parse`; in that case, strengthen the fixture until it fails before
  the fix and passes after it.

### Step 3: Keep the diff narrow

Files to inspect:

```text
src/cli/features/extract/command.ts
src/cli/features/extract/command.test.ts
```

Implementation:

- Do not modify generated artifacts, `dist/`, examples, model snapshots, or
  unrelated docs.
- Do not reformat the entire large test file. Let `pnpm fix` handle only
  necessary formatting.
- If the local worktree already contains the exact fix and test, avoid rewriting
  it for style-only reasons.

## 7. Per-step files to edit

- Step 1:
  - `src/cli/features/extract/command.ts`
- Step 2:
  - `src/cli/features/extract/command.test.ts`
- Step 3:
  - No new edits unless formatting or verification requires a directly related
    adjustment.

## 8. Acceptance criteria

- A commented `tsconfig.json` no longer causes extraction to fail before source
  analysis.
- `readTsConfigResolution` uses TypeScript's JSONC-aware TSConfig parser, not
  `JSON.parse`.
- Invalid TSConfig syntax still fails loudly with a useful TypeScript diagnostic.
- Existing `baseUrl` and `paths` behavior remains intact.
- The regression test proves both:
  - comments in `tsconfig.json` are accepted;
  - path aliases from the commented TSConfig are used during reachable import
    extraction.
- No unrelated extraction behavior or public API shape changes.

## 9. Tests to add or update

Add or preserve this test:

```text
src/cli/features/extract/command.test.ts
  runExtractCommand > reads commented tsconfig.json files when resolving paths
```

The test should fail with the old `JSON.parse` implementation and pass with the
TypeScript parser implementation.

Do not add broad snapshot tests for this issue. Do not add a separate fixture
directory unless inline tempfile setup becomes unreadable.

## 10. Verification commands

Run targeted verification first:

```bash
rtk pnpm exec vitest run src/cli/features/extract/command.test.ts -t "reads commented tsconfig.json files when resolving paths"
```

Then run the containing test file:

```bash
rtk pnpm exec vitest run src/cli/features/extract/command.test.ts
```

Then run project-level checks expected for extraction changes:

```bash
rtk pnpm typecheck
rtk pnpm fix
```

If time allows, or before marking the issue closed, run:

```bash
rtk pnpm test
```

Note: `pnpm test` runs `pnpm build:rust && vitest run`, so it may take longer
than targeted Vitest commands.

## 11. Risks, ambiguities, and stop conditions

- `ts.parseConfigFileTextToJson` parses JSONC but does not by itself perform
  full TypeScript config expansion such as `extends`. That is acceptable for
  this issue because the bug is comment parsing in the nearest TSConfig. Stop
  and report if requirements expand to inherited TSConfig behavior.
- If TypeScript parser diagnostics include file-position text that changes
  existing error-message expectations, avoid broad message assertions. Prefer
  preserving loud failure over matching exact text.
- If `readTsConfigResolution` is replaced with a shared config loader before
  implementation, reuse the shared loader only if it returns the same
  `TsConfigResolution` semantics needed by `sourceWithReachableImports` and
  `createSemanticProject`.
- If the regression test cannot observe the alias-import transition, investigate
  import reachability before changing assertions. Do not weaken the test to only
  assert that `runExtractCommand` did not throw.
- If unrelated local changes are present, leave them untouched. Work only with
  the two files listed above unless a directly related verification failure
  requires otherwise.
