# 260615 — Preserve Literal Union Domains & Consolidate Type→Domain Inference

Implementation plan for `docs/issues/coarse-token-domains-limit-semantic-properties.md`.

Optimized for an implementation agent (Cursor Composer 2). Be explicit, prefer minimal
diffs, avoid broad refactors beyond the scoped consolidation.

---

## 1. Goal

1. **Consolidate** the type→domain inference *core* (the `inferDomainFromTypeNode` family),
   which is currently **duplicated across four source files** and carries the **same bug in
   at least three of them**, into a single shared implementation in
   `src/extract/engine/ts/domains.ts`.
2. **Fix the bug once** in that shared core: when TypeScript types expose finite
   string/number unions, preserve those literal domains **inside records and tagged-union
   variants** (and add a recursion/cycle guard while threading aliases). Concrete repro:
   `local:EditLink.draft.visibility` must become `enum("private"|"public")`, not `"tok1"`.
3. **Surface** any coarse `tokens` domains that remain (incl. nested record field paths) so
   users know what to refine via the existing overlay mechanism: a structured
   `coarseDomains` section in the extraction report plus one CLI summary line.

## 2. Non-goals (do NOT implement)

- Inferring domains from `SelectItem value=...`, validation branches, or `as const`
  arrays. (Future directions in the issue.)
- Property-evaluation-time warnings. The check subsystem (`src/check`) is **not** touched.
- Any overlay capability change (`src/core/overlay/index.ts`). Overlay-based refinement
  already exists and must not change.
- **Consolidating the divergent value/initial wrappers.** Only the type→domain *core* is
  unified (that is where the duplicated bug lives). The source-specific wrappers
  (`inferUseStateDomain` / `initialValueForUseState` in engine + use-state, and the
  value-inference in jotai/swr) genuinely diverge in behavior and stay where they are. A
  later plan may unify those; out of scope here. (Chosen approach: "consolidate core, fix
  once".)
- Resolving TypeScript `interface` declarations into record domains (only `type X = ...`
  aliases are in scope; see Step 4 + stop condition S3).

## 3. Current-state findings

### 3.1 FOUR copies of the type→domain core; the SAME bug in three

`inferDomainFromTypeNode` / `domainFromTypeLiteral` (and their union/tagged/reference
helpers) are duplicated in:

- `src/extract/engine/ts/domains.ts` — the most complete copy; **already exports**
  `inferDomainFromTypeNode`, `firstValue`, `typeAliasDeclarations`, `inferUseStateDomain`,
  `initialValueForUseState`. Consumed by `engine/ts/components.ts`, `context.ts`,
  `react-source-transitions.ts`.
- `src/extract/sources/use-state/index.ts` — private inlined copy (produces the repro's
  `local:*` vars via its own `inferUseStateDomain`).
- `src/extract/sources/jotai/domains.ts` — private inlined copy.
- `src/extract/sources/swr/domains.ts` — private inlined copy (structurally similar).

The identical record-field bug appears at:

- `src/extract/engine/ts/domains.ts:280`
- `src/extract/sources/use-state/index.ts:307`
- `src/extract/sources/jotai/domains.ts:205`

(swr's structure differs but is the same family.) **The original two-copy framing was
wrong** — a per-copy hand-fix would still miss jotai/swr.

### 3.2 The bug: `typeAliases` not threaded into record fields / tagged variants

In each copy, `domainFromTypeLiteral` infers fields with
`inferDomainFromTypeNode(member.type)` — **without** passing `typeAliases`. So a field
typed by an alias (`visibility: Visibility` where `type Visibility = "private" | "public"`)
cannot resolve the alias and falls through `domainFromTypeReference` →
`{ kind: "tokens", count: 1 }`. Same gap on the tagged path: `taggedUnion*` →
`domainFromTypeLiteral(member, tag)` without aliases; and `domainFromUnion` calls
`taggedUnion*` without forwarding aliases. Top-level aliases already work (the
`domainFromTypeReference` self-recursion does pass `typeAliases`); only nested paths break.

### 3.3 Recursion-safety gap

`domainFromTypeReference` resolves an alias and recurses with the same `typeAliases` map and
no `visited` guard. Threading aliases into record fields *increases* exposure to cyclic
aliases (`type A = { self: A }`). A `visited` set keyed by alias name must be added to
terminate cycles at `{ kind: "tokens", count: 1 }`.

### 3.4 Architecture constraints for consolidation (verified)

`tools/depcruise.config.cjs` rule `source-slices-use-extraction-spi-only` (lines 50–56):

```
from: ^src/extract/sources/[^/]+
to:   ^src/extract/engine/(?!spi/|ts/)   # forbidden
```

The negative lookahead means source slices **may** import from `engine/spi/` **and**
`engine/ts/`, but **not** the engine barrel (`engine/index.ts`). `package.json` `exports`
expose only `./extract/engine`, `./extract/engine/pipeline`, `./extract/engine/spi` (no
`ts/domains` subpath), and depcruise resolves via `exportsFields`.

**Chosen wiring:** re-export the three shared core functions from the **spi barrel**
(`src/extract/engine/spi/index.ts`, public subpath `modality-ts/extract/engine/spi`,
already imported by sources). This needs no new package export, no relative cross-area
import, and no depcruise change. spi→ts is intra-engine (allowed); no import cycle
(`ts/domains.ts` does not import spi). Sources then import
`inferDomainFromTypeNode` / `firstValue` / `typeAliasDeclarations` from
`modality-ts/extract/engine/spi`.

> spi/index.ts is currently type-only (`import type` from core). This adds a value
> re-export (and a transitive `typescript` runtime dep, which source slices already have).
> If the team objects to runtime exports in spi, the fallback is a relative import
> `../../engine/ts/domains.js` (depcruise allows `engine/ts/`). **Checkpoint C1.**

### 3.5 Behavioral divergence (the cost of unifying the core)

The four cores are *near*-clones, not identical:

- engine's `domainFromUnion` handles multi-member non-null unions via
  `domainFromUnionMembers`; use-state's only handles the single non-null case.
- jotai/swr cores have their own minor differences.

Unifying onto the engine core (the most complete) is an *improvement*, but it can shift
extracted `model.json` for affected fixtures. Output is snapshot-tested
(`assertMatchesExpectedModel`) and differential-checked (`pnpm phase7` /
`pnpm ci:examples`). Each diff must be reviewed (stop condition S4). The **value/initial
wrappers are NOT unified**, so initial-value behavior per source is unchanged except where
the now-correct (richer) domain changes `firstValue`/validation results.

### 3.6 Report & CLI plumbing (for diagnostics)

- `ExtractionReport` in `src/core/report/types.ts` (re-exported via `src/core/index.ts:7`)
  has `domains: DomainReportEntry[]` with `provenance: "default-token"` **per var only** —
  it does not capture nested record fields, which is exactly where the repro hides
  (`draft.visibility`).
- Report built in `createExtractionReport` (`src/cli/features/extract/command.ts:861`);
  CLI summary lines returned from `runExtractCommand` (`command.ts:215-236`);
  `stateSpaceLine` at `command.ts:207`.
- Domain helpers live in `src/core/ir/domains.ts`, re-exported from `modality-ts/core`
  (`src/core/index.ts:2`). New domain-walking helper belongs here.

### 3.7 In-flight work — coordination required

`src/cli/features/extract/command.ts` and `src/core/report/types.ts` have **uncommitted
changes** (state-space-contributors work; untracked
`.cursor/plans/260615-state-space-contributors-report.md`). Step 6 edits both, additively.
**Stop condition S1.**

## 4. Exact file paths & relevant symbols

| Path | Action / symbols |
| --- | --- |
| `src/extract/engine/ts/domains.ts` | **Canonical core.** Fix `inferDomainFromTypeNode`, `domainFromUnion`, `domainFromUnionMembers`, `taggedUnionFromMembers`, `domainFromTypeLiteral`, `domainFromTypeReference` (thread `typeAliases` + add `visited`). Keep `inferUseStateDomain`/`initialValueForUseState`/`firstValue`/`typeAliasDeclarations` exports. |
| `src/extract/engine/spi/index.ts` | Re-export `inferDomainFromTypeNode`, `firstValue`, `typeAliasDeclarations` from `../ts/domains.js`. |
| `src/extract/sources/use-state/index.ts` | **Delete** local core (`inferDomainFromTypeNode`, `domainFromUnion`, `taggedUnionFrom`, `domainFromTypeLiteral`, `domainFromTypeReference`, `domainFromLiteralType`, `firstValue`, `typeAliasDeclarations`). Import them from spi. **Keep** `inferUseStateDomain`, `initialValueForUseState`, `validInitialOrFirst`, component-discovery helpers. |
| `src/extract/sources/jotai/domains.ts` | **Delete** local core; import from spi. Keep jotai-specific value/initial inference. |
| `src/extract/sources/swr/domains.ts` | **Delete** local core; import from spi. Keep swr-specific inference. |
| `src/core/ir/domains.ts` | **New** export `collectTokenDomainPaths`. |
| `src/core/report/types.ts` | `ExtractionReport` — add optional `coarseDomains`. |
| `src/cli/features/extract/command.ts` | `createExtractionReport` + summary line. |

Tests:

| Path | Purpose |
| --- | --- |
| `src/core/ir/domains.test.ts` | unit tests for `collectTokenDomainPaths` |
| `src/cli/features/extract/command.test.ts` | integration: aliased union field → `enum` (useState); `coarseDomains` present; one jotai/atom record-field case to prove consolidation reaches jotai |

## 5. Existing patterns to follow

- **Param threading style**: `typeAliases: ReadonlyMap<string, ts.TypeNode> = new Map()`
  is already used in both engine + use-state. Add `visited: ReadonlySet<string> = new Set()`
  the same way.
- **Domain walking**: exhaustive `switch (domain.kind)` with no `default` (see
  `domainCardinality` / `enumerateDomain` in `src/core/ir/domains.ts`).
- **spi re-export**: `engine/spi/index.ts` already aggregates the source contract; a
  `export { ... } from "../ts/domains.js"` line fits there.
- **Source import style**: sources import via `modality-ts/...` specifiers (use-state
  already imports `modality-ts/extract/engine/spi`). Reuse that exact specifier.
- **Integration tests**: `mkdtemp(tmpdir())` + `writeFile` `.tsx` fixture + `runExtractCommand`,
  assert `model.vars.find(v => v.id === ...)?.domain` (examples at `command.test.ts:1043`,
  `1407`, `1711`).
- **CLI line style**: terse `key=value` (see `state-space≈…bits top:…`, `command.ts:207`).

## 6. Atomic implementation steps

### Step 1 — Fix + harden the canonical core (engine/ts/domains.ts)

Thread `typeAliases` through every nested path and add a `visited` cycle guard:

1. `inferDomainFromTypeNode(node, typeAliases, visited = new Set())`: in the `TypeLiteral`
   case call `domainFromTypeLiteral(node, undefined, typeAliases, visited)`; forward
   `typeAliases, visited` to `domainFromUnion` and `domainFromTypeReference`.
2. `domainFromUnion(node, typeAliases, visited)`: forward to `inferDomainFromTypeNode(...)`
   and `domainFromUnionMembers(...)`.
3. `domainFromUnionMembers(types, typeAliases, visited)`: forward to
   `taggedUnionFromMembers(types, typeAliases, visited)`.
4. `taggedUnionFromMembers(types, typeAliases, visited)`: call
   `domainFromTypeLiteral(member, tag, typeAliases, visited)`.
5. `domainFromTypeLiteral(node, omitField, typeAliases = new Map(), visited = new Set())`:
   infer each field via `inferDomainFromTypeNode(member.type, typeAliases, visited)`.
6. `domainFromTypeReference(node, typeAliases, visited)`: if `visited.has(name)` return
   `{ kind: "tokens", count: 1 }`; else recurse with
   `inferDomainFromTypeNode(alias, typeAliases, new Set([...visited, name]))`.

Keep all non-aliased return shapes identical. Defaulted params keep existing callers
source-compatible. This is the **only** place the fix is written.

### Step 2 — Expose the shared core via the spi barrel

File: `src/extract/engine/spi/index.ts` — add:

```ts
export { inferDomainFromTypeNode, firstValue, typeAliasDeclarations } from "../ts/domains.js";
```

(If Checkpoint C1 forces it, skip this and use relative imports in Step 3 instead.)

### Step 3 — Consolidate the source slices onto the shared core

For each of `use-state/index.ts`, `jotai/domains.ts`, `swr/domains.ts`:

1. Delete the local `inferDomainFromTypeNode` and its private helpers (`domainFromUnion`,
   `domainFromUnionMembers`/`taggedUnion*`, `domainFromTypeLiteral`,
   `domainFromTypeReference`, `domainFromLiteralType`), plus local `firstValue` and
   `typeAliasDeclarations`.
2. Import `inferDomainFromTypeNode`, `firstValue`, `typeAliasDeclarations` from
   `modality-ts/extract/engine/spi`.
3. **Keep** each source's value/initial wrapper(s) and call the imported core from them
   (e.g. use-state's `inferUseStateDomain` keeps calling
   `inferDomainFromTypeNode(typeArg, typeAliases)` — now the shared, fixed one).

Verify no remaining references to the deleted locals. Confirm `pnpm architecture` passes
(Checkpoint C1).

### Step 4 — (Optional, gated) interface support

Only if Step 7 shows the repro's record type is declared with `interface` (var collapses to
`tokens` entirely rather than a record): extend `typeAliasDeclarations` (now single-sourced
in engine) to also register `ts.isInterfaceDeclaration` nodes. Otherwise **skip** — see S3.

### Step 5 — `collectTokenDomainPaths` helper (core)

File: `src/core/ir/domains.ts` — add & export:

```ts
export function collectTokenDomainPaths(domain: AbstractDomain): string[]
```

Recursively collect dot/bracket paths where a `{ kind: "tokens" }` domain appears:
`tokens → [""]`; `record → field[.child]`; `option → recurse(inner)` (no segment);
`tagged → "#variant" + recurse`; `boundedList → "[]" + recurse(inner)`;
`bool|enum|boundedInt|lengthCat → []`. Return sorted + de-duplicated. Exhaustive
`switch (domain.kind)`, no `default`.

### Step 6 — Surface coarse domains (report + CLI)

File: `src/core/report/types.ts` — add to `ExtractionReport` (additive, optional):

```ts
coarseDomains?: readonly { varId: string; paths: readonly string[] }[];
```

File: `src/cli/features/extract/command.ts`:

1. In `createExtractionReport`, after `domains`, compute (import `collectTokenDomainPaths`
   from `modality-ts/core`, extend the import block at `command.ts:7-18`):
   ```ts
   const coarseDomains = model.vars
     .map((decl) => ({ varId: decl.id, paths: collectTokenDomainPaths(decl.domain) }))
     .filter((entry) => entry.paths.length > 0)
     .sort((a, b) => a.varId.localeCompare(b.varId));
   ```
   Add `coarseDomains` to the returned report.
2. In `runExtractCommand`, add **one** line after `stateSpaceLine` (`command.ts:218`) only
   when non-empty: `coarse-domains=<count> e.g. <varId>[<path>]` (count = total
   `(varId, path)` pairs; example = first entry). Do not print every entry.

Do **not** route this through `warnings` (those are regex-parsed into `extractionCaveats`).

### Step 7 — Tests (see §9). Step 8 — Verify (see §10).

## 7. Per-step files to edit

- Step 1: `src/extract/engine/ts/domains.ts`
- Step 2: `src/extract/engine/spi/index.ts`
- Step 3: `src/extract/sources/use-state/index.ts`, `src/extract/sources/jotai/domains.ts`, `src/extract/sources/swr/domains.ts`
- Step 4 (optional): `src/extract/engine/ts/domains.ts`
- Step 5: `src/core/ir/domains.ts`
- Step 6: `src/core/report/types.ts`, `src/cli/features/extract/command.ts`
- Step 7: `src/core/ir/domains.test.ts`, `src/cli/features/extract/command.test.ts`

## 8. Acceptance criteria

1. Only **one** definition of `inferDomainFromTypeNode` / `domainFromTypeLiteral` remains
   in `src/extract` (in `engine/ts/domains.ts`); use-state, jotai, swr import it.
   `rtk grep -rn "function inferDomainFromTypeNode" src/extract` returns a single hit.
2. `useState<Draft>(...)` with `type Draft = { visibility: Visibility; title: string }` and
   `type Visibility = "private" | "public"` yields
   `domain.fields.visibility === { kind: "enum", values: ["private", "public"] }` (order
   preserved), and `domain.fields.title === { kind: "tokens", count: 1 }`;
   `initial.visibility === "private"`.
3. The same preservation holds for aliased union fields inside tagged-union variants, and
   for **jotai atoms** (proves consolidation reached that slice).
4. Top-level aliased unions still work (no regression).
5. Cyclic type aliases terminate (no stack overflow) at `{ kind: "tokens", count: 1 }`.
6. `report.coarseDomains` lists remaining token paths (incl. nested, e.g.
   `draft → ["title"]`); CLI prints `coarse-domains=` only when non-empty.
7. `collectTokenDomainPaths` correct + sorted + de-duped across record/option/tagged/list.
8. `pnpm typecheck`, `pnpm test`, `pnpm architecture` pass; `pnpm phase7` /
   `pnpm ci:examples` pass or have only reviewed, intended snapshot updates (S4).

## 9. Tests to add or update

### `src/core/ir/domains.test.ts` — add `describe("collectTokenDomainPaths")`

`tokens → [""]`; `bool/enum/boundedInt/lengthCat → []`;
record `{a:tokens,b:bool,c:enum} → ["a"]`; nested `{outer:{inner:tokens}} → ["outer.inner"]`;
option-wrapping-record-with-token (no option segment); tagged with token field →
`["#variant.field"]`; boundedList of record with token field → `["[].field"]`; dedup+sort.

### `src/cli/features/extract/command.test.ts` — add 3 `it(...)`

- **Fixture A (useState alias preserved):**
  ```tsx
  type Visibility = "private" | "public";
  type Draft = { visibility: Visibility; title: string };
  export default function EditLink() {
    const [draft, setDraft] = useState<Draft>({ visibility: "private", title: "" });
    return <button onClick={() => setDraft({ ...draft, visibility: "public" })} />;
  }
  ```
  Assert `local:EditLink.draft` is a `record` with
  `fields.visibility = enum(["private","public"])`, `fields.title = tokens count 1`,
  `initial.visibility === "private"`.
- **Fixture B (coarse surfaced):** assert `report.coarseDomains` contains
  `{ varId: "local:EditLink.draft", paths: ["title"] }` and `result.lines` includes a
  `coarse-domains=` line.
- **Fixture C (jotai atom record field):** an `atom<{ status: Status }>(...)` where
  `type Status = "open"|"closed"`; assert the atom var's `fields.status` is the enum —
  proving the shared core reaches the jotai slice.

Reuse the `mkdtemp`/`writeFile`/`runExtractCommand` harness (`command.test.ts:11-40`).

## 10. Verification commands

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture          # MUST pass — validates the spi re-export wiring (C1)
rtk pnpm phase7                # differential semantics/parity (snapshot review, S4)
rtk pnpm ci:examples           # example-app integration (snapshot review, S4)
rtk pnpm fix                   # biome lint+format; run last
```

Targeted while iterating:

```bash
rtk pnpm test src/core/ir/domains.test.ts
rtk pnpm test src/cli/features/extract/command.test.ts
rtk grep -rn "function inferDomainFromTypeNode" src/extract   # expect 1 hit (engine)
```

Manual repro (optional):

```bash
cd /Users/hari/proj/gdgjp/tinyurl && rtk pnpm exec modality extract
rtk node -e 'const m=JSON.parse(require("fs").readFileSync(".modality/model.json","utf8")); const d=m.vars.find(v=>v.id==="local:EditLink.draft"); console.log(JSON.stringify(d.domain.fields?.visibility));'
# expect: {"kind":"enum","values":["private","public"]}
```

## 11. Risks, ambiguities, stop conditions

- **C1 (spi wiring checkpoint):** after Step 2/3, run `pnpm architecture`. If re-exporting
  runtime functions from the spi barrel is rejected (lint/review/cycle), fall back to
  relative imports `../../engine/ts/domains.js` in the sources (depcruise allows
  `engine/ts/`). If *both* fail unexpectedly, **stop and report** with the depcruise output.
- **S1 (in-flight files):** re-read `command.ts` and `report/types.ts` in their current
  (modified) state before Step 6; apply additively. If the report shape has diverged from
  §3.6 such that insertion is ambiguous, **stop and report**.
- **S2 (object-literal initial):** if Fixture A shows `initial.visibility !== "private"`,
  do not port engine's `initialValueFromExpression` into use-state blindly — **stop and
  report** (separate enhancement; the chosen scope keeps use-state's wrapper as-is).
- **S3 (interface vs type alias):** if the repro type is an `interface`, only then do
  Step 4; otherwise leave interfaces unsupported and note it.
- **S4 (snapshot/behavior churn):** unifying onto the engine core (richer union handling)
  plus preserving literal domains will change extracted `model.json` for affected fixtures
  and examples. Inspect every `pnpm test` / `pnpm phase7` / `pnpm ci:examples` diff; confirm
  each is the intended `tokens → enum`/`union` refinement. If any diff is **not** an
  obvious improvement, **stop and report**.
- **Recursion:** add the `visited` cycle guard in the **same** change as alias threading.
- **Determinism:** preserve enum value order exactly as authored (do **not** sort enum
  members). Sort only `coarseDomains` entries and `collectTokenDomainPaths` results.
- **Scope discipline:** unify only the type→domain *core*. Do **not** unify the value/initial
  wrappers (`inferUseStateDomain`, etc.) — that is a deliberate, separate follow-up.
