# 260623-01 — Extract-validity measurement spine + CI/PR-comment

Part 1 of 4. Establishes the shared report contract, the orchestrator, and the CI
workflow that all three experiments plug into. Implement **before** 02/03/04.

- 260623-02 — Experiment 3: action-mode conformance pass-rate
- 260623-03 — Experiment 4: mutation-testing true-positive rate
- 260623-04 — Experiment 5: metamorphic extraction bisimulation

## 1. Goal

Produce one machine-readable artifact and one PR comment that report three independent
*validity* signals for `extract`, measured on the existing benchmark apps
(`benchmarks/react-router`, `benchmarks/nextjs`):

- **conformance pass-rate** (does the model match the running app — experiment 3),
- **mutation detection rate** (does a real injected bug get caught — experiment 4),
- **metamorphic stability** (is extraction invariant under semantics-preserving edits —
  experiment 5).

This plan delivers the *spine*: a `ValidityReport` schema, a `tools/validity/` runner
that aggregates per-experiment sub-reports behind a common interface, a CLI entry
`pnpm validity`, and `.github/workflows/validity.yml` that runs it and posts/updates a PR
comment. Each experiment (02/03/04) implements one `ValidityExperiment` module producing
its typed slice; this plan defines the seams and ships them with **stub experiments** so
the spine is independently testable and mergeable.

## 2. Non-goals

- No experiment logic here (only the contract + stubs that emit `status: "skipped"`).
- No change to `tools/benchmark/runner.ts` semantics or the existing `pnpm benchmarks`
  job — validity is a *new, separate* workflow and runner.
- No new benchmark app; targets are the two existing apps only.
- No threshold-based CI failure yet (report-only). Gating ratchets are defined in §8 as a
  follow-up toggle, off by default.

## 3. Current-state findings

- `benchmarks/manifest.json` (`schemaVersion: 1`, `manifestId: "ledgerops-benchmarks"`)
  lists two benchmarks with `id`, `framework`, `root`, `sourcePaths`, `propsPaths`,
  `effectApis`, `expected{truePositiveViolations, trueNegativeVerified,
  falsePositiveProbes, falseNegativeProbes}`, `searchLimits`.
- `tools/benchmark/runner.ts` already drives `runExtractCommand`/`runCheckCommand`/
  `runReplayCommand` and writes `BenchmarkRunReport` (`tools/benchmark/report.ts`).
- `tools/conformance/runner.ts` runs fixture-scoped conform in abstract mode and uses
  `tools/shared-gates/` (`thresholds.ts`, `budgets.ts`, `caveats.ts`, `validate.ts`,
  `types.ts`) for threshold/budget comparison.
- `.github/workflows/benchmarks.yml` is the canonical PR-comment pattern:
  `peter-evans/find-comment@v2` (body-includes marker) → `peter-evans/create-or-update-comment@v5`
  (`comment-id` reused), under `permissions: { issues: write, pull-requests: write }`,
  plus `actions/upload-artifact@v4`.
- `package.json` scripts run tools via `tsx tools/<name>-ci.ts`; the suite excludes
  `test/benchmarks/**` from default `vitest`.
- `modality-ts/core` exports `canonicalJson` and report types via `src/core/report/types.ts`.

## 4. Atomic implementation steps

1. **Define the shared contract** in `tools/validity/types.ts`:
   - `ValidityExperimentId = "conformance" | "mutation" | "metamorphic"`.
   - `ValiditySubReport` (discriminated by `experiment`): common fields
     `{ experiment, status: "pass" | "fail" | "skipped" | "error", headline: string,
     perBenchmark: ValidityBenchmarkSlice[], messages: string[] }`; each experiment
     extends `ValidityBenchmarkSlice` with its own `metrics` payload (left as
     `metrics: unknown` here; narrowed in 02/03/04).
   - `ValidityReport = { schemaVersion: 1; kind: "validity-report"; generatedAt: string;
     manifestId: string; subReports: ValiditySubReport[]; reportPath: string }`.
   - `ValidityExperiment` interface: `{ id; run(ctx: ValidityRunContext):
     Promise<ValiditySubReport> }` where `ValidityRunContext` carries `repoRoot`,
     parsed `benchmarks/manifest.json`, a `workDir` (mkdtemp), and `now`.
2. **Implement the orchestrator** `tools/validity/runner.ts`:
   `runValiditySuite({ repoRoot, manifestPath, experimentIds?, reportPath?, now? })`:
   read+validate the benchmark manifest (reuse `tools/benchmark/manifest.ts`
   `readBenchmarkManifest`/`validateBenchmarkPaths`), create one `mkdtemp` workDir,
   run the selected experiments sequentially (default: all three), catch per-experiment
   errors into `status: "error"` (never abort the suite), assemble `ValidityReport`,
   write canonical JSON via `canonicalJson` to `reportPath`, return
   `{ exitCode, report, reportPath, lines }`. Exit code: `0` unless any sub-report is
   `"error"` (→ `4`); `"fail"` does **not** fail the process in report-only mode (§8).
3. **Register the three experiments** in `tools/validity/experiments/index.ts` as a map
   `Record<ValidityExperimentId, () => ValidityExperiment>`. Ship **stubs** that return
   `status: "skipped"`, `headline: "<experiment> not yet implemented"`. 02/03/04 each
   replace exactly one stub.
4. **Implement the markdown renderer** `tools/validity/comment.ts`:
   `renderValidityComment(report): string` emitting a stable leading marker line
   `Extract-validity report:` (used by find-comment), a summary table
   (experiment × per-benchmark headline metric), and a `<details>` block per experiment
   with the full per-benchmark breakdown. Append a collapsible `Actual JSON` block (mirror
   `benchmarks.yml`). Keep all rendering pure (string in/out) for unit testing.
5. **Add the CLI entry** `tools/validity-ci.ts` (mirror `tools/benchmark-ci.ts`):
   parse `--id <experiment>` (repeatable), `--report <path>`, `--comment <path>`;
   call `runValiditySuite`; when `--comment` given, write `renderValidityComment` output;
   print `lines`; `process.exit(result.exitCode)`. Add `package.json` scripts:
   `"validity": "tsx tools/validity-ci.ts"` and convenience
   `"validity:conformance" | "validity:mutation" | "validity:metamorphic"` passing
   `--id`.
6. **Add the workflow** `.github/workflows/validity.yml` cloned from `benchmarks.yml`:
   triggers `pull_request` + `workflow_dispatch` + `push: main`; `permissions:
   { issues: write, pull-requests: write }`; steps: checkout → pnpm/action-setup@v4
   (10.12.4) → setup-node@v4 (node 24, cache pnpm) → rust-toolchain@stable →
   `pnpm install --frozen-lockfile` → `pnpm build:rust` → `pnpm typecheck` →
   `pnpm validity -- --report .modality/validity/report.json --comment .modality/validity/comment.md`
   → find-comment (body-includes `Extract-validity report:`) →
   create-or-update-comment (body-path `comment.md`, reuse `comment-id`) →
   upload-artifact `.modality/validity/`. Gate the comment steps on
   `if: github.event_name == 'pull_request'`.
7. **Wire docs**: add a short `docs/soundness/validity-experiments.md` page that names the
   three experiments, links them to the gaps in `docs/soundness/index.md` (extraction →
   conformance; checker already covered by phase7), and states the report is the standing
   evidence artifact. Add it to `docs/sidebars.js` under Soundness. (Content only;
   numbers are produced by 02/03/04.)

## 5. Tests to add or update

- `test/validity/runner.test.ts`: with all-stub experiments, asserts the report shape,
  `manifestId`, three `skipped` sub-reports, deterministic `canonicalJson`, and
  `exitCode === 0`. Inject a throwing fake experiment → `status: "error"`, `exitCode 4`,
  suite still completes the others.
- `test/validity/comment.test.ts`: snapshot/string assertions that the marker line, the
  summary table, and one `<details>` per experiment are present; verify it tolerates
  `skipped`/`error` slices.
- Ensure these live where default `vitest` picks them up (not under `test/benchmarks/**`).

## 6. Verification

- `pnpm typecheck`
- `pnpm validity -- --report /tmp/v.json --comment /tmp/v.md` → exit 0, JSON + markdown
  written, three `skipped` sub-reports.
- `pnpm architecture` (the new `tools/validity/` must not import production `src/` beyond
  the published CLI wrappers and `modality-ts/core`).
- `pnpm fix`
- `act` or a draft PR to confirm the workflow posts a single, updatable comment.

## 7. Acceptance criteria

- `tools/validity/` exposes a typed `ValidityExperiment` seam; adding an experiment is a
  one-file swap of a stub.
- `pnpm validity` produces deterministic canonical JSON and a PR-ready markdown comment.
- `validity.yml` posts exactly one comment per PR and updates it on re-runs (no
  duplicates), uploads the artifact, and is independent of the existing `benchmarks` job.
- All three experiments are registered (as stubs) and individually selectable via `--id`.

## 8. Risks, ambiguities, and stop conditions

- **Report-only vs gating**: ship report-only. Add `ValidityRunContext.gating?: boolean`
  and a manifest `validityThresholds` block now (unused), so 02/03/04 can populate
  thresholds and a later flip to `--gate` turns `fail` into a non-zero exit via
  `tools/shared-gates/validate.ts`. Do not gate CI in this plan.
- **Comment size**: per-transition/per-mutant detail can be large. Keep summary tables
  small; push detail into `<details>` and the uploaded artifact. If markdown exceeds
  GitHub's 65 536-char comment limit, the renderer must truncate detail blocks and link to
  the artifact (assert this in `comment.test.ts`).
- **Stop** if `tools/benchmark/manifest.ts` validators are not reusable for an extended
  manifest — surface and resolve the manifest-schema decision before 02/03/04 rely on it.
