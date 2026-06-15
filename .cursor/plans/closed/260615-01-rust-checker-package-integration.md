# Rust Checker Package Integration

## Goal

Make the Rust checker the only semantic implementation behind `modality-ts/check`, with TypeScript reduced to artifact loading, native binding invocation, and report plumbing. The implementation should be direct and in-process, with no sidecar process, no engine selector, and no long-lived TypeScript checker fallback.

## Non-goals

- Do not add `--engine ts|rust|auto`, environment switches, or comparison mode.
- Do not preserve compatibility with arbitrary TypeScript predicate functions.
- Do not launch a subprocess or sidecar service for checking.
- Do not add benchmark infrastructure, Rust-vs-TS comparisons, or staged performance gates.
- Do not change extraction plugins, replay generation, or conformance behavior in this plan.

## Current-state findings

- `src/check/index.ts` exports the public checker API and currently points at `src/check/engine/check-model.ts`.
- `src/cli/features/check/command.ts` imports `checkModel` from `modality-ts/check` and should continue to do so.
- `package.json` has TypeScript-only build scripts and publishes `dist/**`.
- `tools/depcruise.config.cjs` requires `src/check` to depend only on `src/core`, not `src/cli` or `src/extract`.
- Existing `modelInitialStates` and `modelSuccessors` are TS runtime helpers; if kept, they must be Rust-backed too.

## Exact file paths and relevant symbols

- `package.json`: scripts, package files, dependency additions.
- `Cargo.toml`: new Rust workspace root.
- `crates/checker/Cargo.toml`: new Rust checker crate.
- `crates/checker/src/lib.rs`: native exported API.
- `src/check/native.ts`: native binding loader and request/response marshal.
- `src/check/index.ts`: public `checkModel` export.
- `src/check/types.ts`: check result and option types exposed to callers.
- `src/cli/features/check/command.ts`: should keep importing `checkModel` only.

## Existing patterns to follow

- Preserve ESM TypeScript imports and existing package export paths.
- Keep `src/check` isolated from `src/cli` and `src/extract`.
- Keep report-shaped data compatible with `createCheckReport` unless a later property/reporting plan intentionally changes core schemas.
- Use structured errors that become `PropertyVerdict.status === "error"` instead of throwing raw native errors for model-level failures.

## Atomic implementation steps

1. Add the Rust workspace and checker crate.

   Files to edit:
   - `Cargo.toml`
   - `crates/checker/Cargo.toml`
   - `crates/checker/src/lib.rs`

   Implementation:
   - Create a root Cargo workspace with `crates/checker` as a member.
   - Configure the checker crate as a native Node addon library loaded in-process.
   - Add dependencies for JSON serialization, deterministic maps/sets if needed, and parallel execution support used by later plans.
   - In `lib.rs`, expose one stable native function such as `check_model(serialized_request: string) -> string`.
   - Define the request shape as `{ model, properties, options }` and response shape as `{ ok: true, result } | { ok: false, error }`.

2. Add the TypeScript native binding loader.

   Files to edit:
   - `src/check/native.ts`
   - `src/check/types.ts`

   Implementation:
   - Implement a single `runRustCheck(model, properties, options): CheckResult` function.
   - Serialize input with existing JSON-compatible model/property artifacts.
   - Load the package-local native artifact with an ESM-safe loader.
   - Parse the native JSON response and convert native modeling errors into checker error verdicts when property names are available.
   - Do not implement fallback to the TypeScript checker if loading or execution fails; surface the failure directly.

3. Route the public checker API through Rust.

   Files to edit:
   - `src/check/index.ts`
   - `src/check/types.ts`

   Implementation:
   - Export `checkModel` from the new Rust-backed adapter.
   - Remove direct imports from `./engine/check-model.js`.
   - Delete or replace `modelInitialStates` and `modelSuccessors` exports; if callers still require them, wire them to explicit Rust native functions rather than the TS runtime.
   - Keep `sliceModel` export only if it remains pure model preprocessing and does not depend on the old checker runtime.

4. Make package scripts build Rust before TypeScript.

   Files to edit:
   - `package.json`

   Implementation:
   - Add a script such as `build:rust` that compiles the checker crate.
   - Update `build` so Rust compiles before `tsc -b`.
   - Update `test` only if tests require native build first; do not add comparison or benchmark scripts.
   - Ensure `clean` removes Rust-produced package artifacts but not Cargo's global cache.

5. Include the native artifact in package output.

   Files to edit:
   - `package.json`
   - `src/check/native.ts`

   Implementation:
   - Add the native build output path to package `files`.
   - Make `native.ts` resolve the artifact from the installed package location, not from a workspace-only path.
   - Keep generated native binaries out of source control.
   - If platform-specific filenames are needed, centralize resolution in `native.ts`.

6. Remove TypeScript semantic ownership.

   Files to edit:
   - `src/check/engine/check-model.ts`
   - `src/check/engine/model-api.ts`
   - `src/check/runtime/*`
   - `src/check/properties/*`
   - `src/check/traces/*`

   Implementation:
   - After the Rust API compiles, delete TS modules that duplicate Rust-owned semantics or stop exporting them.
   - Keep only TS files required for public types, binding load, slicing if still TS-owned, and CLI report assembly.
   - Update imports broken by removal rather than leaving compatibility aliases.
   - Do not leave a hidden TypeScript checker path for tests.

## Acceptance criteria

- `modality-ts/check` calls the Rust native checker in-process.
- There is no engine-selection flag and no TypeScript fallback checker.
- CLI check still imports only `checkModel` from `modality-ts/check`.
- Package build produces TypeScript declarations and the native checker artifact.
- Architecture rules still pass.

## Tests to add or update

- Update checker tests that import removed TS-only helper APIs.
- Add a smoke test that `checkModel` reaches the native binding and returns a shaped `CheckResult`.
- Update CLI check tests only for the new property artifact contract introduced by later plans.

## Verification commands

- `rtk pnpm build`
- `rtk pnpm test -- test/checker/checker.test.ts`

## Risks, ambiguities, and stop conditions

- Stop and report if the chosen native addon mechanism cannot be loaded from ESM without a subprocess.
- Stop and report if current package publishing constraints require multiple platform packages.
- Do not implement fallback behavior for unsupported old predicates; that migration belongs in the property IR plan.
