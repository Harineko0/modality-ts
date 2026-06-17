# Real-App Canary Manifest and Runner

Status: implementation plan.
Date: 2026-06-17.
Plan family: G - Real-App Canary Suite.
Split sequence: 260617-22-3.
Depends on: `260617-22-1-report-and-manifest-foundation.md`.

## 1. Goal

Add manifest-driven real-app canaries and migrate existing example CI onto the
same runner while preserving current demo-app acceptance checks.

The intended end state of this plan is:

- `test/canaries/canaries.json` declares active and planned canaries;
- local examples are represented as manifest data;
- `pnpm ci:canaries` runs all active canaries;
- `pnpm ci:examples` remains available but delegates to the canary runner;
- demo-app seeded-bug acceptance behavior is preserved through manifest
  expectations instead of hard-coded TypeScript constants.

## 2. Non-goals

- Do not make real apps the source of truth for semantics. If a canary exposes a
  semantic gap, add or update a conformance fixture first.
- Do not implement new framework/library semantics to make a canary pass.
- Do not execute arbitrary remote app code. Canary roots must be local fixture
  paths, local examples, or explicit worktree paths in the manifest.
- Do not fully implement deterministic failure classification here. That belongs
  in `260617-22-4-threshold-budget-and-classification-gates.md`.
- Do not remove `pnpm ci:examples`.
- Do not commit generated reports, traces, replay tests, or `.modality` output.

## 3. Current-State Findings

- `tools/examples-ci.ts` is a hard-coded integration script for
  `examples/demo-app`.
- Existing example CI verifies:
  - extraction coverage is 100 percent exact/overlay;
  - check finds three seeded violations;
  - at least two replay traces reproduce;
  - overlay line count stays under 100;
  - `runCiCommand` reports expected seeded failures and determinism.
- `examples/` currently contains `demo-app`, `checkout-app`, and `todo-app`.
- `src/cli/features/ci/command.ts` supports conformance-related options and
  trust-ledger regression comparison.
- There is no `test/canaries/` manifest or runner.

## 4. Exact File Paths and Relevant Symbols

Files to add/edit:

- `test/canaries/canaries.json`
- `test/canaries/README.md`
- `test/canaries/manifest.test.ts`
- `test/canaries/runner.test.ts`
- `tools/canary-ci.ts`
- `tools/canary/manifest.ts`
- `tools/canary/runner.ts`
- optional `tools/canary/assertions.ts`
- `tools/examples-ci.ts`
- `package.json`
  - add `ci:canaries`
  - keep `ci:examples`

Existing command wrappers:

- `runExtractCommand`
- `runCheckCommand`
- `runConformCommand`
- `runCiCommand` from `src/cli/features/ci/command.ts`

Existing reports:

- `ExtractionReport`
- `CheckReport`
- `ConformReport`
- `CanaryRunReport` from plan 1

## 5. Existing Patterns to Follow

- Follow `tools/examples-ci.ts` for current demo acceptance semantics and temp
  artifact handling.
- Follow the conformance runner design from plan 2 where the same pattern fits.
- Use direct command wrappers for speed and determinism.
- Keep app-specific expectations in `test/canaries/canaries.json`.
- Planned canaries should be visible in the manifest but not run by default.
- Keep runner output concise and report-backed.

## 6. Canary Manifest Shape

Represent canaries with explicit status and manifest-owned expectations. The
exact TypeScript types may differ, but preserve these concepts:

```ts
export interface CanaryDefinition {
  id: string;
  title: string;
  status: "active" | "planned";
  kind:
    | "react-app"
    | "react-router-app"
    | "next-app-router-app"
    | "next-pages-router-app"
    | "external-store-app"
    | "schema-form-app"
    | "server-action-app"
    | "tsconfig-layout-app";
  root: string;
  packageManager?: "pnpm" | "npm" | "yarn";
  dependencyFacts: readonly {
    packageName: string;
    expectedRange?: string;
    source: "package-json" | "lockfile";
  }[];
  extract: {
    sourcePaths?: readonly string[];
    configPath?: string;
    packageJsonPath?: string;
    effectApis?: readonly string[];
    disabledPlugins?: readonly string[];
  };
  check?: {
    propsPaths?: readonly string[];
    maxStates?: number;
    maxEdges?: number;
    maxFrontier?: number;
    memoryGuardMb?: number;
  };
  conform?: {
    count?: number;
    depth?: number;
    seed?: number;
    mode?: "abstract" | "action";
    harnessPath?: string;
    minPassRate?: number;
    minTransitionPassRate?: number;
  };
  thresholds: CanaryThresholds;
  acceptedCaveats: readonly CanaryAcceptedCaveat[];
  knownUnsupported: readonly string[];
}
```

Add an expectations object for seeded-bug canaries that can express:

- expected violated property count;
- expected violated property names;
- minimum reproduced replay count;
- overlay line budget;
- expected CI exit code for seeded bugs.

## 7. Atomic Implementation Steps

### Step 1 - Add the canary manifest and docs

Files to add/edit:

- `test/canaries/canaries.json`
- `test/canaries/README.md`
- `test/canaries/manifest.test.ts`

Implementation:

1. Create a manifest schema with `schemaVersion` and `canaries`.
2. Add active canaries for:
   - `examples/demo-app` as the seeded-bug acceptance canary;
   - `examples/todo-app` as a simple local-state app;
   - `examples/checkout-app` as a checkout workflow canary.
3. Add planned canary slots for unavailable families instead of fabricating
   coverage:
   - React Router app;
   - Next App Router app;
   - Next Pages Router app;
   - external-store app;
   - schema/forms app;
   - server actions/effect API app;
   - unusual tsconfig/module-layout app.
4. Each active canary must include:
   - root path;
   - extraction command inputs;
   - check/conform options as applicable;
   - coverage thresholds;
   - accepted caveats list, even if empty;
   - state-space budgets or explicit reason budgets are not applicable;
   - expected seeded violation/replay behavior when relevant.

Acceptance criteria:

- Active canary roots exist.
- Planned canaries do not run.
- Demo-app expectations are represented in manifest data.

### Step 2 - Implement canary manifest validation

Files to add/edit:

- `tools/canary/manifest.ts`
- `test/canaries/manifest.test.ts`

Implementation:

1. Read `test/canaries/canaries.json`.
2. Validate:
   - unique non-empty ids;
   - status is active or planned;
   - active roots exist;
   - active canaries define at least one threshold;
   - accepted caveats use stable `kind` and `id`, not free-form message regexes;
   - planned canaries are allowed to omit runnable paths only when clearly
     marked planned.
3. Resolve paths relative to the repository root.

Acceptance criteria:

- Invalid active roots fail validation.
- Free-form caveat matching fails validation.
- Planned canaries are excluded from default run selection.

### Step 3 - Implement `tools/canary/runner.ts`

Files to add/edit:

- `tools/canary/runner.ts`
- optional `tools/canary/assertions.ts`
- `test/canaries/runner.test.ts`

Implementation:

1. Read and validate the canary manifest.
2. Select active canaries by default.
3. Support flags:
   - `--canary <id>`;
   - `--kind <kind>`;
   - `--report <path>`.
4. For each selected canary:
   - create temp artifact dirs;
   - run extract as requested by the manifest;
   - run check as requested by the manifest;
   - run conform/replay as requested by the manifest;
   - compare manifest expectations and thresholds available in this plan;
   - record pass/fail evidence.
5. Write a `CanaryRunReport`.
6. Return exit codes:
   - `0`: selected canaries passed;
   - `2`: threshold or semantic expectation failed;
   - `3`: manifest/canary invalid;
   - `4`: runner infrastructure failure.

Acceptance criteria:

- A minimal canary can pass in tests.
- A threshold failure is recorded in `CanaryRunReport`.
- Planned canaries do not run unless explicitly supported later.

### Step 4 - Preserve demo-app seeded-bug behavior through manifest data

Files to add/edit:

- `test/canaries/canaries.json`
- `tools/canary/runner.ts`
- `test/canaries/runner.test.ts`

Implementation:

1. Move these existing expectations from `tools/examples-ci.ts` into manifest
   data:
   - extraction exact/overlay coverage must be 100 percent;
   - check finds three seeded violations;
   - expected property names match current acceptance behavior;
   - at least two replay traces reproduce;
   - overlay line count stays under 100;
   - CI command reports expected seeded failures and determinism.
2. Preserve semantic equivalence before deleting hard-coded demo checks.
3. Keep any temporary parity fallback local and remove it before handoff.

Acceptance criteria:

- `rtk pnpm ci:examples` still passes with equivalent demo-app checks after
  migration.
- Runner tests prove demo seeded-bug expectations come from manifest data.

### Step 5 - Add `tools/canary-ci.ts` and package script

Files to add/edit:

- `tools/canary-ci.ts`
- `package.json`
- `test/packaging/package-manifest.test.ts` if package scripts are asserted

Implementation:

1. Add:

   ```json
   "ci:canaries": "tsx tools/canary-ci.ts"
   ```

2. The entrypoint should delegate to `tools/canary/runner.ts`.
3. Print concise output:
   - selected canary count;
   - pass/fail summary;
   - report path;
   - failure evidence.

Acceptance criteria:

- `rtk pnpm ci:canaries` runs active canaries.
- `rtk pnpm ci:canaries -- --canary <id>` runs one canary.

### Step 6 - Convert `tools/examples-ci.ts` to a compatibility entrypoint

Files to edit:

- `tools/examples-ci.ts`
- `test/canaries/runner.test.ts`

Implementation:

1. Replace hard-coded example checks with a call into the canary runner
   selecting the example/demo canary group.
2. Keep the command name `pnpm ci:examples`.
3. Do not keep duplicate threshold comparison logic in `tools/examples-ci.ts`.
4. If parity cannot be proven immediately, keep old logic only behind a
   temporary clearly named helper and remove it before this plan is complete.

Acceptance criteria:

- `tools/examples-ci.ts` is a compatibility entrypoint, not a second canary
  system.
- `rtk pnpm ci:examples` still passes.

## 8. Per-Step Files to Edit

| Step | Files |
| --- | --- |
| 1 | `test/canaries/canaries.json`, `test/canaries/README.md`, `test/canaries/manifest.test.ts` |
| 2 | `tools/canary/manifest.ts`, `test/canaries/manifest.test.ts` |
| 3 | `tools/canary/runner.ts`, optional `tools/canary/assertions.ts`, `test/canaries/runner.test.ts` |
| 4 | `test/canaries/canaries.json`, `tools/canary/runner.ts`, `test/canaries/runner.test.ts` |
| 5 | `tools/canary-ci.ts`, `package.json`, packaging tests if needed |
| 6 | `tools/examples-ci.ts`, `test/canaries/runner.test.ts` |

## 9. Acceptance Criteria

- `test/canaries/canaries.json` exists and validates.
- Active local examples are represented as canaries.
- Planned framework-family canaries are visible but not run by default.
- `rtk pnpm ci:canaries` runs all active canaries.
- `rtk pnpm ci:examples` still passes.
- Demo-app thresholds and seeded-bug expectations live in manifest data.
- `tools/examples-ci.ts` contains no duplicate demo threshold implementation.

## 10. Tests to Add or Update

Add:

- `test/canaries/manifest.test.ts`
  - validates active/planned entries;
  - rejects missing roots for active canaries;
  - rejects free-form accepted caveat matching;
  - proves planned canaries do not run.
- `test/canaries/runner.test.ts`
  - runs a minimal canary;
  - fails and records a threshold result;
  - preserves demo-app seeded-bug expectations through manifest data.

Update:

- `test/packaging/package-manifest.test.ts`
  - only if package scripts are asserted.

## 11. Verification Commands

Run during development:

```bash
rtk pnpm vitest run test/canaries/manifest.test.ts
rtk pnpm vitest run test/canaries/runner.test.ts
rtk pnpm ci:canaries
rtk pnpm ci:examples
```

Run before handoff:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk git diff --check
```

## 12. Risks, Ambiguities, and Stop Conditions

- Stop and report if migrating `tools/examples-ci.ts` would lose any current
  seeded-bug check. Preserve old checks temporarily until parity is proven, then
  delete duplication.
- Stop and report if an active canary requires installing dependencies or
  modifying files outside repo-controlled paths.
- Stop and report if canary failures suggest changing adapter/checker behavior
  before a corresponding conformance fixture exists.
- Stop and report if runner implementation needs framework-specific
  conditionals outside manifest data.
- Stop and report if accepted caveat matching needs human warning strings.
  Wait for structured caveat gates in plan 4.

## 13. Must Not Change

- Do not remove `pnpm ci:examples`.
- Do not weaken demo-app acceptance expectations.
- Do not commit generated reports, traces, replay tests, or `.modality` output.
- Do not add new framework/library semantics.
- Do not treat real-app canary behavior as a semantic oracle.
