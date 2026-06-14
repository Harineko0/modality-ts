# 260615 — Unextractable-Handler Diagnostics & Over-Approx Classification

Implementation plan for `docs/issues/unextractable-handlers-cause-overapproximation.md`.
Audience: Cursor Composer 2 implementation agent. **Do not refactor broadly. Prefer minimal diffs.**

---

## 1. Goal

Make the extraction report explain *why* each handler was unextractable and *where* the
problem is, and classify over-approximate (`havoc`) transitions by a coarse severity. Concretely:

1. Each `unextractableHandlers` caveat carries a **specific syntax-pattern category** (not just
   the generic `Unextractable handler <id>`) and a **source span** (`file:line:col`).
2. Over-approximate (`havoc`) transition reasons in the extraction report are tagged with a
   coarse **severity** derived from the written variable's domain
   (`safe local toggle` for boolean-domain writes vs `domain-wide havoc` otherwise).

## 2. Non-goals

- **Do NOT** teach the extractor new React handler shapes (callback props, `onOpenChange`,
  setter forwarding, helper inlining, etc.). That is a separate, larger effort.
- **Do NOT** add checker-side behavior (fail-fast / warn when a property reads a havoc-written
  variable). Determining "cross-property relevant" requires property data unavailable at
  extraction time. Out of scope.
- **Do NOT** change the IR/report JSON *schema*: do not add fields to `ExtractionCaveat`
  (`src/core/report/types.ts`) or to `ExtractionCaveats` (`src/core/ir/types.ts`). Severity and
  category are encoded inside the existing `reason: string` / `reasons: string[]` fields.
- **Do NOT** change `schemaVersion`, transition `id`s, transition `effect` shapes, or
  `confidence` values.
- **Do NOT** restructure the warning pipeline into structured objects. Keep the existing
  string-channel + regex-parse pattern (see findings).

## 3. Current-state findings

Warning → caveat flow today:

1. Generic extraction (`src/extract/engine/ts/react-source-transitions.ts`) and its helpers push
   `ExtractionWarning` objects (`{ message, line?, column? }`) into a shared `warnings[]`.
2. `src/extract/engine/pipeline/index.ts:166-170` **flattens every warning to `warning.message`
   only** (dropping `line`/`column`/file) and `.sort()`s the resulting `string[]`.
3. `src/cli/features/extract/command.ts`:
   - `createExtractionCaveats(warnings: string[])` (~893) builds caveats by **regex-parsing the
     message strings**. Established pattern: `globalTaintFromWarning` (`^Global taint (.+)$`),
     `staleReadFromWarning`, `unhandledRejectionFromWarning`, `unextractableHandlerFromWarning`
     (`^Unextractable handler (.+)$`, ~1128). Each sets `reason` = the *entire* message and
     leaves `source` undefined.
   - `createExtractionReport` (~805) classifies transitions; for `over-approx` transitions it
     calls `overApproxReasons(transition)` (~1036) which emits strings like
     `havoc write to <var>` and `setter escaped to unanalyzed call`. It currently has **no
     access to var domains**.

All `Unextractable handler <Component>.<attr>` message sites (the issue's focus):

| File | Line | Cause to encode as category |
|---|---|---|
| `src/extract/engine/ts/transition/handlers.ts` | ~281 | `await-in-loop` |
| `src/extract/engine/ts/transition/handlers.ts` | ~306 | `awaited-effect-in-block` |
| `src/extract/engine/ts/transition/async.ts` | ~46 | `await-in-loop` |
| `src/extract/engine/ts/transition/async.ts` | ~103 | `awaited-effect-in-async` |
| `src/extract/engine/ts/react-source-transitions.ts` | ~316 | `no-extractable-effect` (component-prop fallback) |
| `src/extract/engine/ts/react-source-transitions.ts` | ~407 | `no-extractable-effect` (intrinsic-attr fallback) |

**Duplicate-warning nuance (must handle):** the specific sites in `handlers.ts`/`async.ts` push a
warning *and return `[]`*. That empty result bubbles up to the `react-source-transitions.ts`
fallback (`extracted.length === 0`), which pushes a **second** `Unextractable handler <id>`
warning for the same handler. Today both strings are identical, so two near-identical caveats can
result for one handler. After this change the two will differ by category; the caveat builder
**must dedupe by `id`, preferring the more specific (non-`no-extractable-effect`) category.**

Out-of-scope warning strings that share the `Unextractable ` prefix but a different shape — leave
their messages unchanged and do not let the new regex match them:
`Unextractable list-rendered handler ...`, `Unextractable custom hook ...`,
`Unextractable stateful list item ...`, `Unextractable effect ...`, `Unsupported useReducer ...`.

`fileName` is already a parameter in scope at every site above (used for `source: [{ file: fileName, ... }]`
anchors nearby) — **verify before relying on it** (see stop conditions).

## 4. Exact file paths and relevant symbols

- `src/extract/engine/ts/transition/handlers.ts`
  - `transitionsFromResolvedHandler` — warning pushes at ~281, ~306.
  - existing import `lineAndColumn` from `../ast.js`.
- `src/extract/engine/ts/transition/async.ts`
  - `transitionsFromAsyncHandler` — warning pushes at ~46, ~103.
- `src/extract/engine/ts/react-source-transitions.ts`
  - `visit` closure — fallback warning pushes at ~316, ~407.
- `src/cli/features/extract/command.ts`
  - `unextractableHandlerFromWarning` (~1128) — parser to extend.
  - `createExtractionCaveats` (~893) — dedupe step for unextractable caveats.
  - `createExtractionReport` (~805) and `overApproxReasons` (~1036) — severity tagging.
- `src/extract/engine/ts/ast.ts` — `lineAndColumn(source, node) -> { line, column }` (1-based).
- Tests: `src/cli/features/extract/command.test.ts`.

## 5. Existing patterns to follow

- **String-channel warnings + regex caveats.** Keep encoding everything into `message` and parse
  with a single anchored regex, exactly like `globalTaintFromWarning` et al. Do not introduce a
  parallel structured channel.
- **Caveat shape** `{ id, reason, source? }` — `source` is a plain string. Populate it with the
  `file:line:col` string parsed out of the message.
- **Deterministic ordering** — `createExtractionCaveats` already `.sort(compareCaveats)`s; keep
  output sorted and stable.
- **1-based line/column** via `lineAndColumn`.

## 6. Atomic implementation steps

> Use a single message format so one regex parses everything:
> `Unextractable handler <id> [<category>] (<file>:<line>:<col>)`
> where `<id>` = `<Component>.<attr>` (no spaces), `<category>` is kebab-case, `<file>` is the
> `fileName` value as already used for source anchors.

### Step 1 — Encode category + span at the 6 `Unextractable handler` sites
Replace each generic `Unextractable handler ${component}.${attr}` message with the new format,
injecting the per-site category from the table in §3 and the file+span from `fileName` +
`lineAndColumn(source, <node>)`. Use the **same node** already passed to `lineAndColumn` at that
site (`handler`, `expression`, `awaitStatement`, or `node`).

Example (handlers.ts ~281):
```ts
const { line, column } = lineAndColumn(source, handler);
warnings.push({
  message: `Unextractable handler ${component}.${attr} [await-in-loop] (${fileName}:${line}:${column})`,
  line,
});
```
Keep pushing `line` on the object (harmless; preserves current field). Do **not** rely on the
object carrying file/category downstream — everything travels in `message`.

### Step 2 — Teach `unextractableHandlerFromWarning` to parse the new format
In `src/cli/features/extract/command.ts`, change the parser to extract `id`, `category`, and
`source`, and to remain backward-compatible with the bare legacy form:
```ts
function unextractableHandlerFromWarning(
  warning: string,
): { id: string; reason: string; source?: string; category: string } | undefined {
  const rich = /^Unextractable handler (\S+) \[([^\]]+)\] \((.+)\)$/.exec(warning);
  if (rich) return { id: rich[1]!, category: rich[2]!, reason: `${rich[2]!} at ${rich[3]!}`, source: rich[3]! };
  const bare = /^Unextractable handler (\S+)$/.exec(warning);
  return bare?.[1] ? { id: bare[1], category: "unextractable", reason: bare[0] } : undefined;
}
```
`\S+` ensures it does **not** match `Unextractable list-rendered handler ... over ...` (which has
spaces after the id) or the other out-of-scope prefixes.

### Step 3 — Dedupe unextractable caveats by `id`, preferring the specific category
In `createExtractionCaveats`, replace the inline
`warnings.map(unextractableHandlerFromWarning).filter(isCaveat).sort(...)` for
`unextractableHandlers` with a dedupe that groups by `id` and drops the generic
`no-extractable-effect` / `unextractable` entry when a more specific one exists for the same id.
Keep the result `{ id, reason, source? }[]` (strip the internal `category` before storing) and
`.sort(compareCaveats)`.

### Step 4 — Mirror the dedupe/format in `createExtractionReport`
`createExtractionReport` builds `unextractableHandlers` report entries from the same warnings
(~827). Reuse the deduped parse so `reasons` shows the specific category+span string instead of
the raw message, and the same id is not double-listed. Keep `classification: "unextractable"`.

### Step 5 — Tag havoc over-approx reasons with domain-based severity
Give `overApproxReasons` access to var domains and prefix `havoc write to <var>` with a severity:
- boolean domain (`domain.kind === "bool"`) → `safe local toggle: havoc write to <var>`
- otherwise → `domain-wide havoc: havoc write to <var>`

Build a `Map<varId, StateVarDecl["domain"]>` from `model.vars` in `createExtractionReport` and
pass it into `overApproxReasons`. Leave `setter escaped to unanalyzed call` and the
`transition confidence is over-approx` fallback unchanged. **Verify the exact boolean domain
kind string in `src/core/ir/types.ts` before hardcoding `"bool"`** (stop condition below).

## 7. Per-step files to edit

- Step 1: `src/extract/engine/ts/transition/handlers.ts`, `src/extract/engine/ts/transition/async.ts`, `src/extract/engine/ts/react-source-transitions.ts`
- Step 2: `src/cli/features/extract/command.ts`
- Step 3: `src/cli/features/extract/command.ts`
- Step 4: `src/cli/features/extract/command.ts`
- Step 5: `src/cli/features/extract/command.ts`
- Tests (§9): `src/cli/features/extract/command.test.ts`

No other files should change. Do not edit `src/core/ir/types.ts`, `src/core/report/types.ts`,
`src/core/artifacts/index.ts`, `src/extract/engine/pipeline/index.ts`, or any checker file.

## 8. Acceptance criteria

1. Re-running extraction on a handler with `await` in a loop yields a caveat whose `reason`
   contains `await-in-loop` and whose `source` is `<file>:<line>:<col>`.
2. A handler that simply has no extractable effect yields a caveat with category
   `no-extractable-effect` and a source span.
3. A handler that hits a specific cause (await-in-loop etc.) produces **exactly one**
   `unextractableHandlers` caveat for that id (no generic duplicate).
4. `unextractableHandlers` caveats are sorted and stable across runs (deterministic output;
   `canonicalJson` snapshot unchanged run-to-run for the same input).
5. Over-approx report reasons for a boolean-domain havoc read `safe local toggle: havoc write to <var>`;
   for a non-boolean domain they read `domain-wide havoc: havoc write to <var>`.
6. Out-of-scope warning strings (`list-rendered`, `custom hook`, `stateful list item`,
   `effect`, `useReducer`) are unchanged and produce no new `unextractableHandlers` caveats.
7. `pnpm build`, `pnpm test`, and the Biome check all pass.

## 9. Tests to add or update

In `src/cli/features/extract/command.test.ts`:

- **Update** the existing "surfaces unextractable handlers in the extraction report" test
  (~105). Its current expectations
  (`reason: "Unextractable handler App.onClick"`,
  `report.warnings` contains `"Unextractable handler App.onClick"`,
  `reasons: ["Unextractable handler App.onClick"]`)
  must change to the new format. Assert the caveat `reason` contains the expected category and
  the caveat `source` matches `App.tsx:<line>:<col>` (use a regex, not a hardcoded number, unless
  the fixture line is fixed).
- **Add** a test with an `await`-in-loop handler asserting category `await-in-loop` and that
  exactly one caveat exists for that id (dedupe).
- **Update** "explains over-approximate extracted handlers" (~1356) and "reports loop setter
  writes as over-approximate havoc" (~1392): their `reasons` currently equal
  `["havoc write to local:App.saveStatus"]` and must become the severity-prefixed form
  (`safe local toggle: ...` or `domain-wide havoc: ...` depending on the fixture var's domain —
  check the fixture's declared domain and assert accordingly).
- **Add** a regression assertion that a `list-rendered`/`effect` warning does not appear in
  `unextractableHandlers` caveats.

Match the existing test style (fixture source strings + `runExtract`-style helpers already in the
file). Do not introduce a new test framework or helpers.

## 10. Verification commands

```bash
pnpm build
pnpm test src/cli/features/extract/command.test.ts
pnpm test
npx @biomejs/biome check src/extract src/cli/features/extract
```
(Confirm the exact lint script in `package.json` — use that script name if it differs.)

Manual sanity (optional, mirrors the issue repro):
```bash
node -e 'const fs=require("fs");const m=JSON.parse(fs.readFileSync(".modality/model.json","utf8"));console.log(JSON.stringify(m.metadata.extractionCaveats.unextractableHandlers,null,2))'
```

## 11. Risks, ambiguities, and stop conditions

- **STOP and report** if `fileName` is *not* in lexical scope at any of the six push sites
  (verify each; it is used for nearby `source: [{ file: fileName, ... }]` anchors). If missing at
  a site, omit the `(file:line:col)` suffix for that site only and note it — do **not** widen
  function signatures across the extractor to thread it.
- **STOP and ask** if the boolean domain kind in `src/core/ir/types.ts` is not literally `"bool"`
  (it may be `"boolean"` or an enum-token domain). Use the actual kind; do not guess.
- **Ambiguity:** the message format embeds `file:line:col` with a `:` separator while file paths
  on some platforms could contain `:` — unlikely here (POSIX-relative paths), and the regex uses
  a single greedy `(.+)` for the whole span, so it round-trips. If fixtures use Windows-style
  paths, **report** rather than hardening the regex.
- **Determinism risk:** changing message strings changes `.sort()` order of `report.warnings`.
  Confirm snapshot/`canonicalJson` outputs are regenerated intentionally and remain stable; if a
  golden model snapshot exists and changes, update it deliberately and call it out.
- **Duplicate caveats:** if, contrary to §3, the codebase already dedupes unextractable warnings
  upstream, skip Step 3's dedupe and just verify single-caveat output — **report** the deviation.
- If `overApproxReasons` is called from anywhere other than `createExtractionReport`, do not
  change its signature globally; instead add an optional domain-map parameter (defaulting to an
  empty map) so existing callers are unaffected — **report** any second caller found.
