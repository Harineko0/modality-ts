# 260620-02 — Hide transition IDs via combined `*.modals.ts` handles

## 1. Goal

Let property authors reference transitions by stable, type-checked handles instead of
hand-written magic strings like
`const loadMoreOrders = "OrderHistoryDialog.onClick.error_nextCursor_orders.seq"`.

Concretely:

- Rename the generated per-source state module from `<source>.vars.ts` to `<source>.modals.ts`.
- That single file holds **two sections**: existing `Variable<…>` state handles, plus new
  **transition handles** typed `TransitionRef<"<transition id>">`.
- Add a `TransitionRef<Id>` branded type exported from `modality-ts/properties` (and therefore
  `modality-ts/core`). `enabled(...)` and `stepTransitionId(...)` accept `string | TransitionRef<string>`.
- Transition handle export names are derived from the event **locator/text** when available,
  falling back to the writes-set, with collision-safe numbering.
- The property loader resolves an imported transition handle to its literal id (parallel to how
  `Variable<_, "id">` handles resolve to `variable("id")`), then strips the import — so the
  generated file is never imported inside the check-time sandbox.

End state for `home.props.ts`: the whole `const loadMoreOrders = "…"` block disappears, replaced by
`import { orderHistoryDialog_loadMore, … } from "./home.modals"` (optionally aliased).

## 2. Non-goals

- No change to transition **id synthesis** (`handlers.ts` / `ids.ts`). Ids stay as-is; we only add
  friendly handles that carry them.
- No source-side annotation mechanism (no `data-modality="…"` propagation). Naming is derived only.
- No namespaced-object layout (`on.loadMore`). Flat exports, two comment-delimited sections.
- No backward-compat shim for `*.vars.ts`. This is an experimental tool; the old name is removed,
  not aliased. (Per repo principle: never preserve backward compatibility.)
- Do not change runtime evaluation of `enabled` / `stepTransitionId` — the rewritten source still
  passes a plain string literal at runtime.
- Do not touch `modality-ts/vars` (the built-in system handles `pending`/`route`/`history` in
  `src/core/props/vars.ts`) — that is an unrelated module that merely shares the word "vars".

## 3. Current-state findings

State-handle generation today:

- `src/cli/codegen/component-state.ts`
  - `emitComponentVarModules(model, appModelPath)` groups `model.vars` (only `local:*` ids) by
    owning source file and emits one module per file.
  - `modulePathForSource()` → `${name}.vars.ts`; `fallbackModulePath()` →
    `componentVarsDir(appModelPath)/${componentId}.vars.ts`; `componentVarsDir()` →
    `dirname(appModelPath)/vars`.
  - Module source = `import { variable, type Variable } from "modality-ts/core";` then one
    `export const <name>: Variable<domain, "id"> = variable("id") as Variable<domain, "id">;` per field.
  - `collisionSafeExportName()` disambiguates duplicate field names with `Component_field`.
  - `ComponentVarModule { sourcePath?, fileName, path, source }`.

- `src/cli/features/extract/command.ts`
  - L37 imports `emitComponentVarModules`; L475 calls it; L484–489 writes each module to disk;
    L572 records artifacts; L611–612 logs `componentVars=<n>`.

- `src/cli/properties/resolve-symbols.ts` (the check-time loader rewrite)
  - `isGeneratedVarsSpecifier()` (L180) matches `.vars.ts`, `.vars.js`, `.modality/vars/`, `./vars`,
    `./vars/…`, `../vars`, `../vars/…`.
  - `resolvedGeneratedVarsModulePath()` (L205) maps a `.vars(.ts|.js)` specifier to its `.vars.ts` path.
  - `componentIdFromGeneratedVarsSpecifier()` (L195) parses `.modality/vars/<Component>`.
  - `varIdFromHandleDeclaration()` (L108) reads the id from a `Variable<_, "id">` type annotation.
  - `handleVarIdForIdentifier()` (L129) resolves an imported identifier to that id.
  - `generatedComponentVarEntries()` (L344) feeds the generated module source into the semantic
    project so the checker can see handle types.
  - `generatedImportDiagnostics()` (L264) + the `visit()` branch at L463–472 **throw** for any
    identifier imported from a generated-vars specifier that does not resolve to a modeled var.
    → Transition handles imported from `*.modals.ts` MUST be recognized here or they will be
    rejected as "unresolved state variable".
  - `rewriteImportedSymbols()` (L394): rewrites var-handle identifiers to `variable("id")`
    (L453–462), then `ensureStateVarImport()` and `removeRewrittenImports()` strip the now-dead
    generated import.

- `src/cli/properties/load-properties.ts`
  - `rewriteImportedSymbols` output is transpiled and dynamically imported. Surviving **relative**
    imports are resolved against disk by `rewriteRelativeImports`, but their own package imports are
    **not** rewritten — confirming the generated file must not survive into the sandbox. Transition
    handles must therefore be rewritten + import-stripped, same as vars.

Transition shape (the data the emitter has from `model`):

- `src/core/ir/types.ts` — `Transition { id, cls, label: EventLabel, source: SourceAnchor[],
  guard, effect, reads, writes, confidence, … }`. `model.transitions` is the list.
- `EventLabel` (L114): `click|submit` carry optional `locator` + `text`; `input` carries `locator`
  + `valueClass`; plus `navigate|resolve|focus-revalidate|timer|env|internal`.
- `Locator` (L109): `{ kind:"testId"; value }` | `{ kind:"role"; role; name? }` |
  `{ kind:"positional"; base; index }`.
- Transition id format (`src/extract/engine/ts/transition/handlers.ts:1055`):
  `${component}.${attr}.${writeNames.join("_")}.seq[.${valueSuffix}][.${shortHash}]`. The hash
  (`ids.ts:64`) is the fragile disambiguator (e.g. three buttons writing `isFree_phase` differ only
  by `pj0iff` / `1vae60` / `jyeh9g`) — exactly why locator-based naming is required.

Public API:

- `src/core/props/index.ts` — `enabled(transitionId: string)` (L135),
  `enabledTransitionPrefix(prefix: string)` (L139), `stepTransitionId(transitionId: string)` (L151).
  `Variable`/`variable` re-exported (L36–43). `src/core/index.ts` re-exports `./props/index.js`.

Consumers needing regeneration:

- `docs/intro/quickstart.md` L46 (`import { auth, step } from "./App.vars";`) and L58
  (prose "`<source>.vars.ts`").
- `examples/todo-app/app.props.ts` L15 (`import { draft, saveStatus } from "./App.vars";`).
- Stale `examples/todo-app/.modality/vars/App.d.ts` uses the pre-rename `VarHandle` type — a leftover;
  regeneration via `pnpm ci:examples` should overwrite/remove it.
- Tests asserting the `.vars.ts` name: `src/cli/features/extract/command.run.test.ts:1310,1312`
  (`App.vars.ts`). Re-scan for any other `.vars.ts` / `App.vars` string assertions before editing.
- External `coffee-dx` app (`apps/web/app/_customer/home.props.ts`) — out of this repo; document that
  it must be re-extracted. Do not edit it here.

## 4. Exact file paths and relevant symbols

Edit:

- `src/core/props/index.ts` — add `TransitionRef<Id>` type + export; widen `enabled` and
  `stepTransitionId` parameter types to `string | TransitionRef<string>`.
- `src/cli/codegen/component-state.ts` — rename `.vars.ts` → `.modals.ts`; add transition-handle
  emission; new naming helper; rename public symbols (`emitComponentVarModules` → `emitComponentModalModules`,
  `ComponentVarModule` → `ComponentModalModule`, `componentVarsDir` → `componentModalsDir`).
- `src/cli/features/extract/command.ts` — update import + call site + log label.
- `src/cli/properties/resolve-symbols.ts` — `.modals` specifier matching; `TransitionRef` handle
  resolution + rewrite to string literal; allow transition exports through diagnostics.
- `src/core/props/vars.ts` — fix the doc comment that says "generated … as `<source>.vars.ts`".
- `docs/intro/quickstart.md` — update import + prose to `.modals`.

Add:

- `src/cli/codegen/transition-handles.ts` (new) — `transitionHandleName(transition)` derivation +
  helpers, OR colocate inside `component-state.ts` (see step 2). Prefer a new file to keep
  `component-state.ts` focused; export the naming function for unit testing.

Tests (see §9).

Do **not** edit:

- `src/extract/engine/ts/transition/handlers.ts`, `ids.ts`, `ui.ts` (read-only references for naming).
- `src/core/props/vars.ts` runtime values (only its doc comment).
- `coffee-dx` (external).

## 5. Existing patterns to follow

- Emit pattern: copy the structure of `emitComponentVarModules` exactly — sort modules by path, sort
  entries deterministically, build `source` as a joined string array, return
  `{ sourcePath?, fileName, path, source }`.
- Handle-id-in-type pattern: `Variable<domain, "id">` → for transitions `TransitionRef<"id">`. Reuse
  `stringLiteralType()` from `src/cli/codegen/model.ts` for the literal.
- Loader resolution pattern: clone `varIdFromHandleDeclaration` / `handleVarIdForIdentifier` into
  `transitionIdFromHandleDeclaration` / `handleTransitionIdForIdentifier` that match a
  `TransitionRef<"…">` annotation and return the literal.
- Collision-safe naming: mirror `collisionSafeExportName` — count base names, append `_2`, `_3` … to
  later duplicates (deterministic order).
- `safeId()` semantics from `ids.ts:41` for sanitizing arbitrary text into identifier-safe tokens
  (replicate locally in codegen; do not import from the extract engine to respect layer boundaries —
  verify with `pnpm architecture`).

## 6. Atomic implementation steps

Keep each step independently compilable.

**Step A — Add `TransitionRef` type + widen API.**
In `src/core/props/index.ts`: add
`export type TransitionRef<Id extends string = string> = Id & { readonly __transition?: Id };`
(brand optional so a plain string literal is assignable, matching the rewrite output). Change
`enabled(transitionId: string | TransitionRef<string>)` and
`stepTransitionId(transitionId: string | TransitionRef<string>)`; coerce to `String(transitionId)`
internally where the id is stored if needed (it is already used as a string). Leave
`enabledTransitionPrefix` as `string`.

**Step B — Transition naming helper.**
Add `src/cli/codegen/transition-handles.ts` exporting
`transitionHandleName(transition: Transition): string` (raw, pre-collision) computing:
1. `component` = id prefix before first `.` lower-camelized.
2. `token`:
   - `label.locator.kind === "testId"` → camelCase(`value`).
   - `label.locator.kind === "role"` with `name` → camelCase(`name`); without name → `role`.
   - `label.kind === "click"|"submit"` with `text` → camelCase(`text`).
   - else fall back to writes: field names parsed from `writes` (`local:Comp.field` → `field`)
     joined by `_`; if empty, use the event kind.
   - `positional` locator → fall back to writes (positional carries no semantic token).
3. Return `${component}_${token}` sanitized via local `safeId`, ensuring it starts with a letter.
Also export `assignTransitionHandleNames(transitions): { transition, name }[]` applying collision
numbering deterministically.

**Step C — Emit transitions into the combined module.**
In `component-state.ts`:
- Rename file-name helpers: `${name}.vars.ts` → `${name}.modals.ts`; `componentVarsDir` →
  `componentModalsDir` returning `dirname(appModelPath)/modals` (was `/vars`).
- Group transitions by owning source file using `transition.source[0]?.file` with the same
  `modulePathForSource` / fallback logic used for vars (fallback keyed by component id parsed from
  `transition.id`).
- Merge var-modules and transition-modules by path so each file is emitted once with both sections.
- Module source:
  ```
  import { variable, type Variable } from "modality-ts/core";
  import type { TransitionRef } from "modality-ts/properties";

  // state
  export const <field>: Variable<…, "id"> = variable("id") as Variable<…, "id">;
  …

  // transitions
  export const <name>: TransitionRef<"<id>"> = "<id>" as TransitionRef<"<id>">;
  …
  ```
  Omit a section (and its unused import) entirely if it has no entries. Omit the
  `import type { TransitionRef }` line when there are no transitions.
- Rename exported symbols: `emitComponentVarModules` → `emitComponentModalModules`,
  `ComponentVarModule` → `ComponentModalModule`. Keep `{ sourcePath?, fileName, path, source }`.

**Step D — Wire extract command.**
In `src/cli/features/extract/command.ts`: update import (L37) and call (L475) to the renamed
function, variable names (`componentVarModules` → `componentModalModules`), artifact mapping (L572),
and the log token (L611–612, e.g. `componentModals=<n>`). No behavioral change to the write loop.

**Step E — Loader: resolve transition handles.**
In `src/cli/properties/resolve-symbols.ts`:
- Extend `isGeneratedVarsSpecifier` to also match `.modals.ts` / `.modals.js` / `.modals` /
  `.modality/modals/` / `./modals` / `./modals/…` / `../modals…`. (Rename the function to
  `isGeneratedModalSpecifier`; update callers.)
- Update `resolvedGeneratedVarsModulePath` and `componentIdFromGeneratedVarsSpecifier` to the
  `.modals` naming, mirroring current logic.
- Add `transitionIdFromHandleDeclaration` + `handleTransitionIdForIdentifier` matching
  `TransitionRef<"…">` (the annotation is `TypeReferenceNode` named `TransitionRef`, first type arg
  is the literal).
- In `visit()`: after the var-handle check, if `handleTransitionIdForIdentifier` resolves, push a
  replacement of the identifier with the **string literal** `JSON.stringify(id)` (no `variable(...)`
  wrapper), add to `rewrittenSymbolNames`. Because the value is already a string, no helper import is
  required.
- `generatedImportDiagnostics`: also accept exports whose declaration is a `TransitionRef` handle, so
  a valid transition import is not flagged. Simplest: when collecting `fields` for the generated
  module, also collect transition-handle names by re-emitting via `emitComponentModalModules` and
  reading both `Variable` and `TransitionRef` const names (extend
  `localFieldNamesByGeneratedModule` to gather all exported const identifiers from the module source,
  not just `Variable` ones).
- `generatedComponentVarEntries`: keep feeding the (now combined) module source into the semantic
  project so the checker sees `TransitionRef` annotations. Update the `vars` dir paths to `modals`.

**Step F — Docs + comments.**
- `src/core/props/vars.ts` doc comment: `<source>.vars.ts` → `<source>.modals.ts`.
- `docs/intro/quickstart.md`: import line → `./App.modals`; prose → `<source>.modals.ts`; add a short
  note showing a transition handle usage (`enabled(app_save)` style).

**Step G — Regenerate examples.**
Run extraction for the example apps so `*.modals.ts` files are produced and `app.props.ts` imports
updated. Update `examples/todo-app/app.props.ts` import to `./App.modals`. Remove the stale
`examples/todo-app/.modality/vars/App.d.ts` (regeneration should no longer emit a `vars/` dir).

## 7. Per-step files to edit

- A: `src/core/props/index.ts`.
- B: `src/cli/codegen/transition-handles.ts` (new).
- C: `src/cli/codegen/component-state.ts` (+ import from B; reuse `model.ts` helpers).
- D: `src/cli/features/extract/command.ts`.
- E: `src/cli/properties/resolve-symbols.ts`.
- F: `src/core/props/vars.ts`, `docs/intro/quickstart.md`.
- G: `examples/**` (generated), `examples/todo-app/app.props.ts`.

## 8. Acceptance criteria

1. Running extract on a model emits `<source>.modals.ts` (no `*.vars.ts`), containing a `// state`
   section identical in content to today's vars output plus a `// transitions` section.
2. Each `model.transitions` entry with a source file gets exactly one exported handle typed
   `TransitionRef<"<exact id>">` whose value string equals the id.
3. Handle names: testId/role-name/text-derived where available; writes-derived fallback otherwise;
   duplicates suffixed `_2`, `_3`, … deterministically; all are valid TS identifiers.
4. A property file importing a transition handle and passing it to `enabled(...)` /
   `stepTransitionId(...)` type-checks, and at check time the loader rewrites it to the literal id and
   strips the import — producing identical check results to the old magic-string form.
5. Importing a **non-existent** handle name from `*.modals.ts` fails extraction/check with the
   existing "could not resolve imported symbol" diagnostic (drift is loud).
6. `pnpm typecheck`, `pnpm test`, `pnpm architecture`, `pnpm ci:examples` all pass.
7. No remaining references to the `.vars.ts` convention in `src/` or `docs/intro/` (grep clean,
   excluding `model.vars` data references and `modality-ts/vars` system module).

## 9. Tests to add or update

- New `src/cli/codegen/transition-handles.test.ts`: unit-test `transitionHandleName` for testId,
  role+name, click text, writes fallback, positional fallback, and collision numbering.
- New/extended `test/<cli>/component-state` (or alongside existing codegen tests): assert the
  combined module contains both sections, correct imports (and omission when a section is empty), and
  `TransitionRef<"id">` lines.
- Update `src/cli/features/extract/command.run.test.ts:1310–1312` to expect `App.modals.ts` and the
  combined content.
- Add a resolve-symbols test: a props file importing a transition handle from `*.modals.ts` is
  rewritten to the literal id and its import stripped; an unknown handle throws.
- Update any other test asserting `.vars.ts` / `App.vars` / `componentVars=` (grep before editing).

## 10. Verification commands

```
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm ci:examples
rtk pnpm fix
```

Targeted while iterating:
```
rtk pnpm vitest run src/cli/codegen/transition-handles.test.ts
rtk pnpm vitest run src/cli/features/extract/command.run.test.ts
rtk pnpm vitest run src/cli/properties
```

## 11. Risks, ambiguities, and stop conditions

- **Architecture boundary**: codegen importing from `src/extract/**` (for `safeId`) may violate
  dependency-cruiser rules. Mitigation: replicate `safeId`/camelCase locally in
  `src/cli/codegen/transition-handles.ts`. If `pnpm architecture` still flags the `Transition` type
  import, import the type from `modality-ts/core` (type-only), not from the extract engine. **Stop and
  report** if a clean import path for `Transition` does not exist.
- **`TransitionRef` brand assignability**: the rewrite emits a bare string literal that must satisfy
  `TransitionRef<string>` parameters. Using an *optional* brand property keeps plain strings
  assignable. If a stricter brand is desired later, the rewrite would need to emit a cast — out of
  scope. Verify `enabled("literal")` still type-checks after the change.
- **Transitions without a `source` file** (system/library/internal `cls`): they have no owning module.
  Decision: **skip** transitions whose `source[0].file` is absent (do not emit handles for them);
  authors keep using `enabled("…")` strings for those. Confirm none of the example properties depend
  on a handle for a sourceless transition.
- **Name collisions across components sharing one module file** (multiple components in one source):
  the `component_` prefix plus collision numbering must disambiguate. Ensure numbering is global per
  module file, not per component.
- **Specifier matcher breadth**: broadening `isGeneratedVarsSpecifier` to `./modals` etc. must not
  swallow unrelated user modules literally named `modals`. Keep the match anchored to the same shapes
  used for `vars` today; **report** if any example/app legitimately imports a non-generated `./modals`.
- **Stale `.modality/vars/` artifacts**: if regeneration still writes a `vars/` directory anywhere,
  the rename is incomplete — **stop and audit** all `componentVarsDir` callers.
- **`pnpm phase7` / differential checks**: this change alters generated file names but not checker
  semantics; phase7 is not expected to be required. If any phase7 snapshot references `.vars.ts`,
  **report** before regenerating snapshots.
- If repo state differs from §3 (e.g. emitter already renamed, or `TransitionRef` already exists),
  **stop and report** rather than forcing the diff.
