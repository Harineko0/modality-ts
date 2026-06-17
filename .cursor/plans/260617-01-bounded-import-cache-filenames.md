# Bounded Import Cache Filenames

Status: ready for implementation (Cursor Composer 2). Author handoff plan.
Date: 2026-06-17.

This plan fixes `docs/_issues/absolute-props-path-import-cache-too-long.md` by
making property import-cache filenames bounded for both TypeScript transpilation
and Vitest module-copy paths.

## 1. Goal

Ensure `modality check <model> <props>` can load property files passed as long
absolute paths without producing `ENAMETOOLONG` under `.modality/import-cache`.

The implementation should:

- Replace path-as-hex cache filename components with a bounded hash of the
  normalized property path.
- Use the same cache filename helper for both cache-writing paths in
  `src/cli/features/check/command.ts`.
- Preserve current property-loading behavior for `.ts`, `.mjs`, `.js`, and the
  Vitest copy path.
- Add regression tests proving an overlong absolute props path no longer creates
  an overlong cache filename and still loads properties successfully.

## 2. Non-goals

- Do not change CLI argument parsing, model path resolution, report path
  handling, or check semantics.
- Do not change where the import cache is stored:
  `join(process.cwd(), ".modality", "import-cache")` remains the cache root.
- Do not introduce persistent cache reuse or cache cleanup.
- Do not broaden TypeScript loader support beyond the current behavior
  (`extension === ".ts"` is transpiled; non-TS files are copied only under
  Vitest).
- Do not edit generated `docs/build/**` artifacts.
- Do not mark `docs/_issues/absolute-props-path-import-cache-too-long.md` as
  resolved unless the implementer has a project convention for closing issue
  docs.

## 3. Current-State Findings

- The issue report at
  `docs/_issues/absolute-props-path-import-cache-too-long.md` shows
  `ENAMETOOLONG` when both model and property paths are absolute, because the
  props path is embedded as hex in the import-cache filename.
- `src/cli/features/check/command.ts` contains the property-loading pipeline:
  - `runCheckCommand(options)` reads the model and calls `loadProperties(...)`.
  - `loadProperties(model, propsPaths)` maps every props path through
    `importableModulePath(propsPath)` before dynamic `import(...)`.
  - `importableModulePath(path)` delegates `.ts` files to
    `transpiledTypeScriptModule(path)`.
  - In Vitest only, non-TS modules are copied to
    `.modality/import-cache/<hex path>.<pid>.<timestamp><extension>`.
  - `transpiledTypeScriptModule(path)` writes transpiled JS to
    `.modality/import-cache/<hex path>.<pid>.<timestamp>.mjs`.
- The problematic filename construction appears twice in
  `src/cli/features/check/command.ts`:
  - `Buffer.from(path).toString("hex")` in the Vitest copy branch.
  - `Buffer.from(path).toString("hex")` in `transpiledTypeScriptModule`.
- Existing hash precedent:
  - `src/cli/features/ci/command.ts` imports `createHash` from `node:crypto` and
    defines a local `sha256(value: string)` helper.
  - `src/cli/features/extract/command.ts` uses the same `createHash("sha256")`
    pattern for source hashes.
- Existing filename-sanitizing precedent:
  - `src/cli/features/check/command.ts` has `safeFileName(value)` for trace
    artifact names, but that helper is lossy and not collision-resistant enough
    for import-cache keys. Use a cryptographic hash instead.
- Focused tests for this area live in
  `src/cli/features/check/command.test.ts`; they already create temp models and
  props files, call `runCheckCommand`, and inspect `.modality` side effects with
  `readdir` / `readFile`.

## 4. Exact File Paths and Relevant Symbols

Edit:

- `src/cli/features/check/command.ts`
  - Add `createHash` import from `node:crypto`.
  - Add `resolve` and optionally `normalize` import from `node:path`.
  - Update `importableModulePath(path: string)`.
  - Update `transpiledTypeScriptModule(path: string)`.
  - Add a private helper such as `importCacheFileName(path, extension)` and a
    private hash helper such as `sha256(value)`.

- `src/cli/features/check/command.test.ts`
  - Add a focused regression test under `describe("runCheckCommand", ...)`.
  - Reuse existing `model()`, `flagTrueIr`, and `runCheckCommand` helpers.

Do not edit:

- `src/cli/cli.ts`
- `src/cli/features/ci/command.ts`
- `src/cli/features/extract/command.ts`
- `docs/build/**`
- Checker/core IR files

## 5. Existing Patterns to Follow

- Follow the local TypeScript style: Node built-in imports at the top,
  two-space indentation, double quotes, semicolons.
- Use the repo's existing hash idiom:
  `createHash("sha256").update(value).digest("hex")`.
- Keep helper functions private to `command.ts` unless another file truly needs
  them. This is a localized CLI implementation detail.
- Keep cache filenames debuggable but bounded. A good shape is:
  `props-${sha256(resolve(path))}.${process.pid}.${Date.now()}${extension}`.
  Full SHA-256 hex is only 64 characters and avoids collision tradeoffs.
- Preserve existing dynamic import behavior:
  `loadProperties` should still import `pathToFileURL(modulePath).href`.
- Preserve the current cache uniqueness suffix behavior (`process.pid` and
  `Date.now()`) unless tests reveal a same-millisecond collision. If that happens,
  use `randomUUID()` or an incrementing local counter in the cache filename
  helper, and note the reason in the implementation.

## 6. Atomic Implementation Steps

### Step 1 - Introduce a Bounded Cache Filename Helper

In `src/cli/features/check/command.ts`:

- Import `createHash` from `node:crypto`.
- Import `resolve` from `node:path` along with existing path helpers.
- Add:
  - `function normalizedImportCacheKey(path: string): string`
  - `function sha256(value: string): string`
  - `function importCacheFileName(path: string, extension: string): string`
- Hash `resolve(path)` rather than raw user input so `./app.props.ts` and the
  equivalent absolute path map to the same normalized identity. Do not alter the
  path used for `readFile` or `copyFile`; only normalize for the cache key.
- Return a filename component whose length is independent of the original path
  length.

### Step 2 - Replace Both Hex Filename Sites

Still in `src/cli/features/check/command.ts`:

- In the Vitest-only branch of `importableModulePath(path)`, replace:
  `Buffer.from(path).toString("hex")...`
  with `importCacheFileName(path, extension)`.
- In `transpiledTypeScriptModule(path)`, replace:
  `Buffer.from(path).toString("hex")...`
  with `importCacheFileName(path, ".mjs")`.
- Keep `mkdir(cacheDir, { recursive: true })`, `copyFile`, `readFile`,
  `transpileModule`, and `writeFile` behavior unchanged.

### Step 3 - Add TypeScript Regression Test

In `src/cli/features/check/command.test.ts`:

- Add a test that creates a deeply nested temporary directory with repeated
  segments long enough that the previous hex filename would exceed common
  filename limits.
- Put `model.json` and `index.props.ts` under that nested directory.
- Write `index.props.ts` exporting a passing property, for example:
  `flagCanBecomeTrue` using existing `flagTrueIr`.
- Call `runCheckCommand({ modelPath, propsPath, now: ... })` with absolute paths.
- Assert:
  - `result.exitCode === 0`.
  - The expected property verdict is present.
  - `.modality/import-cache` exists under `process.cwd()`.
  - Every cache entry filename length is bounded, e.g. less than 120 chars.
  - No cache entry contains the long path segment repeated in the test.

Important cleanup note:

- The cache root is under the repo cwd, not the temp directory. The test should
  avoid depending on an empty cache directory. Capture the directory entries
  before and after the command and inspect only newly created entries, or use a
  unique hashable path and assert at least one new `.mjs` entry appears.

### Step 4 - Add Non-TS Vitest Copy Regression Test

In `src/cli/features/check/command.test.ts`:

- Add a second focused test for the Vitest copy path by creating a long absolute
  `.mjs` props file.
- Export a property array from the `.mjs` file.
- Call `runCheckCommand({ modelPath, propsPath })`.
- Assert the command succeeds and the newly copied cache filename is bounded.

This ensures both previous `Buffer.from(path).toString("hex")` sites are covered.

### Step 5 - Run Formatting and Adjust Imports

- Run `rtk pnpm fix`.
- If Biome reorders imports, keep the resulting order.
- Confirm no unrelated files changed beyond the intended two files and any
  expected formatter effects.

## 7. Per-Step Files to Edit

| Step | Files |
|---|---|
| 1 | `src/cli/features/check/command.ts` |
| 2 | `src/cli/features/check/command.ts` |
| 3 | `src/cli/features/check/command.test.ts` |
| 4 | `src/cli/features/check/command.test.ts` |
| 5 | formatter may touch only files changed above |

## 8. Acceptance Criteria

- Absolute `.ts` props paths with very long nested directories no longer throw
  `ENAMETOOLONG`.
- Absolute `.mjs` props paths with very long nested directories no longer throw
  `ENAMETOOLONG` in Vitest.
- Import-cache filenames are bounded and do not embed the full input path as hex
  or plain text.
- `runCheckCommand` still loads the properties and returns the same verdicts it
  would for a short relative props path.
- The change is localized to the check command property import-cache behavior.
- No generated docs, build output, checker semantics, CLI parsing, or extraction
  code changes are included.

## 9. Tests to Add or Update

Add tests in `src/cli/features/check/command.test.ts`:

- `loads TypeScript properties from long absolute paths with bounded import-cache filenames`
- `copies non-TypeScript properties from long absolute paths with bounded import-cache filenames`

Use existing helpers:

- `model()`
- `flagTrueIr`
- `runCheckCommand`

Potential small local test helpers:

- `async function cacheEntries(): Promise<Set<string>>`
- `function difference(after: string[], before: Set<string>): string[]`
- `function longNestedPath(root: string): string`

Do not update snapshots; this area has no snapshot requirement.

## 10. Verification Commands

Run targeted tests first:

```bash
rtk pnpm vitest run src/cli/features/check/command.test.ts
```

Then run required project checks:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm fix
rtk git diff --check
```

After `rtk pnpm fix`, check for unintended edits:

```bash
rtk git diff -- src/cli/features/check/command.ts src/cli/features/check/command.test.ts
rtk git status --short
```

## 11. Risks, Ambiguities, and Stop Conditions

- Stop and report if the regression is not reproducible through
  `runCheckCommand`; do not add test-only exports for private helpers unless
  there is no practical black-box assertion.
- Stop and report if the cache directory already contains entries that make
  before/after inspection unreliable. Prefer isolating by comparing new entries;
  do not delete the whole repo `.modality/import-cache` in tests.
- Stop and report if TypeScript property imports require preserving the original
  path in the generated filename for sourcemaps or stack traces. Current
  `transpileModule` already receives `fileName: path`, so the filename itself
  should not be needed.
- If same-millisecond filename collisions appear because `Promise.all` loads
  multiple props paths concurrently, add `randomUUID()` from `node:crypto` or a
  module-local monotonic counter to `importCacheFileName`. Keep the path identity
  hash in the filename; use the random/counter suffix only for per-import
  uniqueness.
- If hashing `resolve(path)` breaks any relative path behavior in tests, verify
  that only the cache key uses `resolve(path)`. The actual `copyFile(path, ...)`
  and `readFile(path, ...)` calls must keep using the caller-provided path.
- Do not change backward-compatible behavior for existing short relative paths;
  the only visible behavior change should be bounded cache filenames.
