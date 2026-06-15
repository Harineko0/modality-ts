# 260615 — State-Space Contributors Report

Implementation plan for `docs/issues/shared-imported-component-state-inflates-page-models.md`.
Audience: Cursor Composer 2 implementation agent. **Do not refactor broadly. Prefer minimal diffs.**

---

## 1. Goal

Give developers visibility into *what inflates the model* by adding a static
**state-space contributors** section to the extraction report (and a one-line summary to
the `modality extract` CLI output). Concretely:

1. A reusable, non-enumerating `domainCardinality(domain)` helper that returns the number of
   abstract values a domain can take (capped, never throws/overflows).
2. A new optional `stateContributors` section on `ExtractionReport` that lists, per state
   variable: `varId`, `domainKind`, `bits` (log2 of cardinality), `scope` (`"global"` or the
   route pattern), and `origin` (source file path, or `"system"` / `"library-template"`),
   sorted by `bits` descending and capped to the top N. Plus a `bySource` rollup summing `bits`
   per `origin` so a developer can see *which file/component* drives model size.
3. A single human-readable summary line in `runExtractCommand` output, e.g.
   `state-space≈42.0bits top:sys:pending(18.0),local:CreateLinkForm.destinationUrl(3.0),…`.

This implements the issue's fix direction #5 ("Provide a report section listing top
state-space contributors by variable/domain") and partially #4 (per-source provenance rollup).

## 2. Non-goals

- **Do NOT** add a route-scoped extraction mode, change which files are loaded in directory
  mode (`loadExtractionProject`), or change `sys:route` semantics. (Issue fix directions #1.)
  That is a separate, higher-risk effort — see §11 stop conditions.
- **Do NOT** change check-time slicing (`src/check/slicing/slice-model.ts`) or any checker
  behavior/semantics. The model produced is byte-for-byte unchanged; only the *report* gains a
  section.
- **Do NOT** add a new ignore mechanism for shell state — `overlay.ignoreVars` already exists
  and is out of scope here.
- **Do NOT** change `schemaVersion` (stays `1`), `Model` shape, `vars`, `transitions`,
  transition `id`s, or domain JSON. The new report field is **optional and additive**.
- **Do NOT** modify the `CheckReport` runtime `dominantVars` diagnostic
  (`src/check/engine/check-model.ts`) — that observes *visited* values at check time; this plan
  adds a *static* estimate at extract time. They are intentionally separate.
- **Do NOT** enumerate domains to count them (`enumerateDomain` materializes every value and will
  blow up on `boundedList`/`record`). Compute cardinality structurally instead.

## 3. Current-state findings

- Extraction report is built in `src/cli/features/extract/command.ts` by
  `createExtractionReport(sourceFiles, model, warnings, ignoredVars, now)` (~line 805). It already
  maps `model.vars` to a `domains: DomainReportEntry[]` array (~856). This is the established
  place to add a new section; it has `model` (hence `model.vars`) in scope.
- The CLI summary lines are returned from `runExtractCommand` in the `lines: [...]` array
  (~line 206–224). Adding one string there is the established way to surface a summary.
- `StateVarDecl` (`src/core/ir/types.ts:25`) has:
  - `domain: AbstractDomain` (full union at `:8`),
  - `scope: { kind: "global" } | { kind: "route-local"; route: string }` (`:29`),
  - `origin: SourceAnchor | "system" | "library-template"` (`:28`), where `SourceAnchor` is
    `{ file: string; line?; column? }` (`:19`).
- `src/core/ir/domains.ts` already has `enumerateDomain` (materializing — do NOT reuse for
  counting) and `tokenNames`. It is the right home for a new `domainCardinality`.
- `src/core/index.ts` re-exports `./ir/domains.js` (`:2`) and `./report/types.js` (`:7`) via
  `export *`, so new exports in those files are automatically public — no index edit needed.
- `ExtractionReport` is defined in `src/core/report/types.ts:121`. Fields are read structurally;
  adding an optional field is backward-compatible.
- Existing report tests live in `src/cli/features/extract/command.test.ts` and assert with
  `toMatchObject` against the parsed report JSON (e.g. ~line 70). `toMatchObject` ignores extra
  fields, so existing assertions stay green when a new field is added.
- Domain JSON canonicalization is in `src/core/ir/canonical.ts` / `canonicalJson`; the report is
  written via `canonicalJson(report)` (command.ts ~200). New plain-object fields serialize fine.

### Cardinality rules to implement (must match `enumerateDomain` counts exactly)

| `domain.kind` | count |
|---|---|
| `bool` | 2 |
| `enum` | `domain.values.length` |
| `boundedInt` | `domain.max - domain.min + 1` |
| `option` | `1 + card(inner)` |
| `record` | product of `card(field)` over all fields (empty record → 1) |
| `tagged` | sum of `card(variant)` over all variants |
| `tokens` | `domain.names?.length ?? domain.count` |
| `lengthCat` | 3 |
| `boundedList` | `sum_{len=0..maxLen} card(inner)^len` (i.e. `1 + c + c² + … + c^maxLen`) |

These mirror `enumerateDomain` exactly (verify against it in a test). To avoid overflow on
products/powers, clamp every intermediate and the result to a `CARDINALITY_CAP`
(`Number.MAX_SAFE_INTEGER`); once clamped, stay clamped. `bits = Math.log2(cardinality)`.

## 4. Exact file paths and relevant symbols

- `src/core/ir/domains.ts` — add `export function domainCardinality(domain: AbstractDomain): number`.
- `src/core/report/types.ts` — add `StateSpaceContributor` interface, `StateSpaceContributors`
  interface (or inline shape), and optional `stateContributors?` field on `ExtractionReport`.
- `src/cli/features/extract/command.ts` —
  - add `buildStateContributors(model: Model, limit?: number)` helper,
  - call it inside `createExtractionReport` and attach `stateContributors` to the returned object,
  - add one summary line in `runExtractCommand`'s `lines` array.
- Tests: `src/core/ir/domains.test.ts` (create if absent) and
  `src/cli/features/extract/command.test.ts` (add a case).

> If `src/core/ir/domains.test.ts` does not exist, create it next to the source per the repo's
> colocated-test convention (`src/**/*.test.ts` is configured in Vitest).

## 5. Existing patterns to follow

- Domain recursion: copy the `switch (domain.kind)` exhaustiveness style of `enumerateDomain` /
  `domainFingerprint` in `src/core/ir/domains.ts` (every case returns; no `default`, so the
  compiler enforces exhaustiveness).
- Report assembly: mirror how `createExtractionReport` builds `domains: model.vars.map(...)`
  (command.ts ~856) — map over `model.vars`, then `.sort(...)` with `localeCompare` tie-breaks
  for determinism (canonical JSON output must be stable).
- Origin/scope formatting: a var's `scope` is `"global"` or `route`; its `origin` is either a
  string sentinel (`"system"`/`"library-template"`) or `{ file }`. Reduce to a string the same way
  `domainReportEntry` (command.ts ~167) inspects `decl.origin === "system"` etc.
- Summary line: follow the existing `lines.push`-style strings in `renderCheckResult`
  (`src/cli/features/check/command.ts` ~192) and the `extracted vars=… transitions=…` line.

## 6. Atomic implementation steps

**Step 1 — `domainCardinality` helper.**
In `src/core/ir/domains.ts`, add `domainCardinality(domain)` per the table in §3. Add a module
const `const CARDINALITY_CAP = Number.MAX_SAFE_INTEGER;` and a small `clamp(n)` that returns
`Math.min(n, CARDINALITY_CAP)`. Implement product/power with clamping at each multiply so large
records/lists saturate instead of returning `Infinity`/wrong integers. Use `tokenNames(domain)`
length is unnecessary — for `tokens` just use `domain.names?.length ?? domain.count`.

**Step 2 — Report types.**
In `src/core/report/types.ts` add:

```ts
export interface StateSpaceContributor {
  varId: string;
  domainKind: string;
  bits: number;        // log2(cardinality), rounded to 2 decimals
  scope: string;       // "global" or the route pattern
  origin: string;      // file path, or "system" / "library-template"
}

export interface StateSpaceContributors {
  totalBits: number;                 // sum of all vars' bits (full model, not just topN)
  topVars: readonly StateSpaceContributor[];
  bySource: readonly { source: string; bits: number }[];
}
```

Then add `stateContributors?: StateSpaceContributors;` to `ExtractionReport` (after `domains`).

**Step 3 — Build contributors in the command.**
In `src/cli/features/extract/command.ts`, add `buildStateContributors(model, limit = 20)`:
- For each `decl` in `model.vars`: `bits = round2(Math.log2(domainCardinality(decl.domain)))`
  (guard `cardinality < 1` → `bits = 0`), `scope = decl.scope.kind === "global" ? "global" :
  decl.scope.route`, `origin = typeof decl.origin === "string" ? decl.origin : decl.origin.file`.
- `totalBits = round2(sum of all bits)`.
- `topVars` = all contributors sorted by `bits` desc, then `varId` `localeCompare`, sliced to
  `limit`.
- `bySource` = group bits by `origin`, sum, sort by bits desc then `source` `localeCompare`.
- Import `domainCardinality` from `modality-ts/core` (add to the existing core import block at the
  top of the file). Define a local `round2(n) = Math.round(n * 100) / 100`.

Attach `stateContributors: buildStateContributors(model)` to the object returned by
`createExtractionReport`.

**Step 4 — CLI summary line.**
In `runExtractCommand`, after building `report`, append one line to the returned `lines` array:
`state-space≈${report.stateContributors!.totalBits.toFixed(1)}bits top:${topVars.slice(0,3)
.map(v => `${v.varId}(${v.bits.toFixed(1)})`).join(",")}`. Place it right after the
`transitions=` line. Keep it ASCII-safe except the `≈` already shown is fine in this repo's
output (verify no test asserts the exact full `lines` array equality for the basic case — it uses
`result.lines[0]` and `toContain`, so appending is safe).

**Step 5 — Tests** (see §9).

## 7. Per-step files to edit

| Step | File(s) |
|---|---|
| 1 | `src/core/ir/domains.ts` |
| 2 | `src/core/report/types.ts` |
| 3 | `src/cli/features/extract/command.ts` |
| 4 | `src/cli/features/extract/command.ts` |
| 5 | `src/core/ir/domains.test.ts` (new), `src/cli/features/extract/command.test.ts` |

No other files should change. Do **not** touch `slice-model.ts`, `check-model.ts`,
`core/index.ts`, `pipeline/index.ts`, or any extractor under `src/extract/`.

## 8. Acceptance criteria

1. `domainCardinality(d)` returns, for every domain kind, exactly `enumerateDomain(d).length` for
   small finite domains (proven by a property-style test over hand-built domains).
2. For large domains (`boundedList` with big `maxLen`/inner, deep `record`), `domainCardinality`
   returns a finite number `≤ Number.MAX_SAFE_INTEGER` and never `Infinity`/`NaN`.
3. The extraction report JSON contains a `stateContributors` object with `totalBits` (number),
   `topVars` (sorted desc by `bits`, ≤ 20 entries, each with the five fields), and `bySource`
   (sorted desc by `bits`).
4. `topVars` is deterministic across runs (stable tie-break), so `canonicalJson` output is stable.
5. `modality extract` prints exactly one new `state-space≈…` line; existing output lines are
   unchanged and in the same order otherwise.
6. The produced `model.json` is byte-for-byte identical to before this change (no model/semantic
   change). Confirm via an existing extract golden/`--expect-model` test still passing.
7. `pnpm typecheck`, `pnpm test`, and `pnpm architecture` all pass.

## 9. Tests to add or update

- **New** `src/core/ir/domains.test.ts`:
  - `domainCardinality` equals `enumerateDomain(d).length` for: `bool`, a 3-value `enum`,
    `boundedInt {min:2,max:5}`, `option` of bool, a 2-field `record` of bools, a `tagged` with two
    record variants, `tokens {count:3}` and `tokens {names:["a","b"]}`, `lengthCat`, and
    `boundedList {inner: bool, maxLen: 2}` (expect `1+2+4=7`).
  - A saturation test: `boundedList {inner: record of 5 bools, maxLen: 8}` returns a finite number
    `≤ Number.MAX_SAFE_INTEGER`.
- **Update** `src/cli/features/extract/command.test.ts`: extend the existing
  "writes model and extraction report artifacts" test (or add a sibling `it`) to:
  - assert `report.stateContributors.topVars[0].varId` and that its `bits` is a number,
  - assert `report.stateContributors.topVars` is sorted non-increasing by `bits`,
  - assert `report.stateContributors.bySource` includes the source file with positive `bits`,
  - assert `result.lines.some(l => l.startsWith("state-space≈"))`.
  Use `toMatchObject`/targeted field asserts so existing assertions are unaffected.

Do not weaken or delete existing assertions. If any golden snapshot of the report exists
(search `--expect-model` / `goldenPath` usages), those are *model* goldens, not *report* goldens,
so they should be unaffected; if a report golden exists, regenerate it and note it in the PR.

## 10. Verification commands

```bash
rtk pnpm typecheck
rtk pnpm test -- src/core/ir/domains.test.ts src/cli/features/extract/command.test.ts
rtk pnpm test
rtk pnpm architecture
```

(Optional real-app smoke, only if the app is present — do not fail the task if it is missing:)

```bash
cd /Users/hari/proj/gdgjp/tinyurl && rtk pnpm exec modality extract --report .modality/extraction-report.json
rtk node -e 'const r=require("./.modality/extraction-report.json"); console.log(r.stateContributors.topVars.slice(0,10)); console.log(r.stateContributors.bySource.slice(0,10));'
```

## 11. Risks, ambiguities, and stop conditions

- **Schema expectation.** Adding `stateContributors?` to `ExtractionReport` is additive/optional.
  If the repo enforces a report JSON schema/validator (search for a `validateReport` or a JSON
  schema file) that rejects unknown fields, **stop and report** before proceeding — the field may
  need to be registered there or `schemaVersion` discussion is required.
- **Report golden snapshots.** If a committed golden file pins the *full* extraction-report JSON
  (not just the model), the new field will break it. Regenerate it and call it out; if regeneration
  is ambiguous, **stop and ask**.
- **`enumerateDomain` parity.** If any cardinality case fails to match `enumerateDomain` for the
  test domains, fix `domainCardinality` (it is the source of truth-under-test); do **not** change
  `enumerateDomain`.
- **Non-ASCII in CLI line.** The `≈` character: confirm no existing test does a strict
  full-array equality on `runExtractCommand().lines`. The current tests use `lines[0]` and
  `toContain`, so this is safe; if a strict-equality test exists, append the line in a way that
  keeps that test passing (update it) or use `~` instead of `≈`.
- **Scope creep.** If, while implementing, it becomes tempting to also filter the model (route
  scoping) or auto-ignore shell vars, **do not** — those are explicit non-goals (§2). Capture them
  as follow-ups.
- **Assumption check.** This plan assumes `model.vars[*].scope` and `.origin` shapes per
  `src/core/ir/types.ts:25-31`. If those types differ when you open the file, **stop and report**
  the discrepancy rather than guessing.
