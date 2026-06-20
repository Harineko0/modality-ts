# 260620-03 — Nested transition handles (`Component.onClick.<key>`)

## 1. Goal

Replace the flat, derived transition handle exports in generated `*.modals.ts`
(`export const customerHome_value_2: TransitionRef<…> = …`) with a **nested object** keyed by the
transition id's own structure, so authors reference transitions the way the id reads:

```ts
// home.modals.ts (generated, transitions section)
export const CustomerHome = {
  onClick: {
    isHistoryOpen: "CustomerHome.onClick.isHistoryOpen" as TransitionRef<"CustomerHome.onClick.isHistoryOpen">,
    isPrinterSettingsOpen: "CustomerHome.onClick.isPrinterSettingsOpen" as TransitionRef<"CustomerHome.onClick.isPrinterSettingsOpen">,
    "isFree_phase.seq.pj0iff": "CustomerHome.onClick.isFree_phase.seq.pj0iff" as TransitionRef<"CustomerHome.onClick.isFree_phase.seq.pj0iff">,
    // …
  },
  onSubmit: {
    "ACTION /order.start": "CustomerHome.onSubmit.ACTION /order.start" as TransitionRef<"CustomerHome.onSubmit.ACTION /order.start">,
    // …
  },
  useEffect: {
    printerStatus_printerStatusData_optimisticDensity:
      "CustomerHome.useEffect.printerStatus_printerStatusData_optimisticDensity" as TransitionRef<"…">,
    // …
  },
};
```

Authoring:

```ts
import { phase, CustomerHome } from "./home.modals";
enabled(CustomerHome.onClick.isHistoryOpen);
stepTransitionId(CustomerHome.onSubmit["ACTION /order.start"]);
```

This removes the meaningless derived names (`customerHome_value`, `customerHome_resolve_2`) and gives
autocomplete grouped by component → event. The keys are the raw id remainder, so they match traces and
error output exactly.

## 2. Non-goals

- No change to transition **id synthesis** (`handlers.ts` / `ids.ts`) or the ids themselves.
- No change to the **state** section of `*.modals.ts` (flat `Variable` exports stay as-is).
- No change to `TransitionRef` type, `enabled` / `stepTransitionId` signatures (already accept
  `string | TransitionRef<string>`).
- No locator/text-based key derivation. Keys are the literal id remainder (deterministic). The earlier
  locator-derivation approach in `transition-handles.ts` is removed, not extended.
- No backward-compat for the old flat handle exports (experimental tool; old form is dropped).
- Do not edit the external `coffee-dx` app; it is re-extracted separately. Its
  `home.modals.ts`/`home.props.ts` are reference fixtures only.

## 3. Current-state findings (as implemented by the prior plan)

- `src/cli/codegen/transition-handles.ts`
  - `safeId`, `camelCase`, `lowerCamelComponent`, `componentIdFromTransitionId`, `writesToken`,
    `tokenFromLabel`, `transitionHandleName(transition)`, `assignTransitionHandleNames(transitions)` —
    produce flat collision-numbered names. **This file is rewritten** (see §6 Step A).
- `src/cli/codegen/component-state.ts`
  - `interface TransitionEntry { name; transitionId }`.
  - `transitionsByModule(model)` groups `model.transitions` (skipping sourceless ones via
    `transition.source[0]?.file`) by `modulePathForSource`, then calls `assignTransitionHandleNames`,
    returning `{ name, transitionId }[]` per module.
  - `transitionHandleType(id)` → `TransitionRef<"id">` via `stringLiteralType`.
  - `emitModuleSource(fields, transitions)` emits the `// transitions` block as
    `export const <name>: <Type> = "<id>" as <Type>;`, sorted by name.
  - `emitComponentModalModules(model, appModelPath)` merges state + transition modules by path.
  - Imports `quoteProperty, stringLiteralType` from `./model.js`; `assignTransitionHandleNames` from
    `./transition-handles.js`.
- `src/cli/properties/resolve-symbols.ts`
  - `transitionIdFromHandleDeclaration(decl)` reads `TransitionRef<"…">` from a **VariableDeclaration**
    type annotation; `handleTransitionIdForIdentifier(node, checker)` resolves a bare imported
    **identifier** to that id.
  - `visit()` (L466+) handles `ts.isIdentifier(node)` only: rewrites var handles to `variable("id")`
    (L487–499) and flat transition identifiers to `JSON.stringify(id)` (L500–510); otherwise (L511–520)
    throws "Could not resolve imported symbol …" for identifiers imported from a modal specifier.
    L471–478 already skips an identifier that is the `.name` of a property access.
  - `isGeneratedModalSpecifier`, `resolvedGeneratedModalModulePath` (note: confirm actual name at
    L235/246), `componentIdFromGeneratedModalSpecifier` handle `.modals` specifiers.
  - `localFieldNamesByGeneratedModule(model, file)` collects **all** exported const identifiers from
    each emitted module source (every `VariableStatement` declaration name) → already includes a
    top-level `export const CustomerHome = …`. `generatedImportDiagnostics` uses that set, so
    `import { CustomerHome }` will validate without change.
  - `generatedComponentVarEntries` feeds emitted module source into the semantic project so the checker
    can type member-access chains.
  - `rewriteImportedSymbols` → `removeRewrittenImports(source, rewrittenSymbolNames)` strips imports
    whose specifier name is in the rewritten set.
- `src/cli/codegen/model.ts` — `quoteProperty(key)` returns a valid object key (bare identifier or
  quoted literal); `stringLiteralType(value)` returns a quoted string-literal type. Reuse both.
- Actual id shapes observed in `coffee-dx/.../home.modals.ts`:
  `CustomerHome.onClick.isHistoryOpen`, `CustomerHome.onClick.isFree_phase.seq.pj0iff`,
  `CustomerHome.onSubmit.ACTION /order.success` (contains space, slash, dots),
  `CustomerHome.useEffect.printerStatus_printerStatusData_optimisticDensity`.
  → component = segment[0]; event = segment[1]; restKey = `segments.slice(2).join(".")` (may contain
  dots/spaces/slashes → must be quoted).

## 4. Exact file paths and relevant symbols

Edit:

- `src/cli/codegen/transition-handles.ts` — replace flat-name logic with tree-builder
  `buildTransitionTree(transitions)`.
- `src/cli/codegen/component-state.ts` — change `transitionsByModule` to carry the tree; change the
  `// transitions` emission in `emitModuleSource` to nested objects.
- `src/cli/properties/resolve-symbols.ts` — add member/element-access resolution to `visit()`; add
  `transitionIdFromPropertyDeclaration` + `transitionIdFromAccessExpression`; guard the root namespace
  identifier from the unresolved-var diagnostic.
- `src/cli/codegen/transition-handles.test.ts` — rewrite for the tree builder.
- Tests asserting transition emission / loader rewrite (grep `TransitionRef`, `.modals`, `customerHome_`
  in `src/**/*.test.ts` and `test/**`).
- `docs/intro/quickstart.md` — if it shows a transition handle, update to the nested form.

Do **not** edit:

- `src/core/props/index.ts` (TransitionRef + signatures unchanged).
- The state section of `emitModuleSource`.
- `handlers.ts` / `ids.ts` / `ui.ts`.

## 5. Existing patterns to follow

- Object key quoting: use `quoteProperty` from `./model.js` (already imported in `component-state.ts`)
  for event keys and rest keys.
- Type literal: use `stringLiteralType` / existing `transitionHandleType` for `TransitionRef<"id">`.
- Deterministic ordering: sort components, then events, then leaf keys by `localeCompare`, mirroring
  the state section's sort.
- Loader resolution: mirror `varIdFromHandleDeclaration` / `handleVarIdForIdentifier` style — read the
  literal straight from the `TransitionRef<"…">` type node on the property's `as` cast; resolve the
  accessed property symbol via `checker.getSymbolAtLocation`.
- Import stripping: add the **root namespace identifier** (`CustomerHome`) to `rewrittenSymbolNames`
  so `removeRewrittenImports` drops it, exactly as bare handles are stripped today.

## 6. Atomic implementation steps

**Step A — Rewrite `transition-handles.ts` as a tree builder.**
Remove `camelCase`, `lowerCamelComponent`, `writesToken`, `tokenFromLabel`, `transitionHandleName`,
`assignTransitionHandleNames` (and the `EventLabel` import if now unused). Keep nothing locator-based.
Add:
```ts
export interface TransitionLeaf { key: string; transitionId: string }
export interface TransitionEventGroup { event: string; leaves: TransitionLeaf[] }
export interface TransitionComponentGroup { component: string; events: TransitionEventGroup[] }
export function buildTransitionTree(
  transitions: readonly Transition[],
): TransitionComponentGroup[];
```
Derivation per transition id: `const [component, event, ...rest] = id.split(".")`;
`key = rest.join(".")`. If `rest.length === 0`, use `key = "_"` (edge; see §11). Group by component →
event → push `{ key, transitionId: id }`. Sort components, events, and leaves deterministically. No
collision numbering — `key` is unique within a (component, event) because the full id is unique.
`component` is the object's export name; assume it is a valid identifier (PascalCase component id). If a
component id is not identifier-safe, sanitize with a local `safeId` (keep `safeId` in this file).

**Step B — Emit nested objects in `component-state.ts`.**
- Change `transitionsByModule` to return, per module path, the `TransitionComponentGroup[]` from
  `buildTransitionTree(entry.transitions)` (replace the `TransitionEntry[]` shape). Update
  `ComponentModalModule` plumbing types accordingly.
- In `emitModuleSource`, replace the flat transition loop with nested emission. For each component
  group emit:
  ```
  export const <component> = {
    <quoteProperty(event)>: {
      <quoteProperty(key)>: "<id>" as TransitionRef<"<id>">,
      …
    },
    …
  };
  ```
  Indent two spaces per level to match repo style; keep one `export const` per component. Reuse
  `transitionHandleType(id)` for the `as` cast and the leaf value `JSON.stringify(id)`.
- Keep the `import type { TransitionRef } …` line gated on `hasTransitions`, and the `// transitions`
  comment + blank-line separation unchanged.

**Step C — Loader: resolve member/element access.**
In `resolve-symbols.ts`:
- Add:
  ```ts
  function transitionIdFromPropertyDeclaration(decl: ts.Declaration): string | undefined
  ```
  Accept `ts.isPropertyAssignment(decl)` whose `initializer` is `ts.isAsExpression` with a
  `TransitionRef<"literal">` type node; return the literal text. (Shorthand/other forms → undefined.)
- Add:
  ```ts
  function transitionIdFromAccessExpression(
    node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    checker: ts.TypeChecker,
  ): string | undefined
  ```
  `const symbol = checker.getSymbolAtLocation(node)` (works for property access and string-literal
  element access); resolve alias; for each declaration call `transitionIdFromPropertyDeclaration`.
- In `visit()`, **before** the `ts.isIdentifier` branch, add:
  ```ts
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const id = transitionIdFromAccessExpression(node, checker);
    if (id) {
      replacements.push({ start: node.getStart(), end: node.getEnd(), text: JSON.stringify(id) });
      const root = leftmostIdentifier(node);
      if (root) rewrittenSymbolNames.add(root.text);
      rewrittenNodes.add(node); // do not descend → inner identifiers untouched
      return;
    }
    // fall through to descend
  }
  ```
  Add helper `leftmostIdentifier(expr)` that walks `.expression` through property/element accesses to
  the base `ts.Identifier`.
- Guard the root namespace identifier from the var diagnostic: in the identifier branch, when
  `node.parent` is a property/element access and `node` is its `.expression` (object side), skip the
  L511–520 diagnostic (descend only). This prevents a false "could not resolve … modeled state
  variable" for `CustomerHome` when a leaf fails to resolve; missing leaves are caught by TS typing in
  the editor.
- Keep the existing flat-identifier transition path (L500–510) as-is (harmless; supports hand-written
  flat handles).

**Step D — Update tests.**
- `transition-handles.test.ts`: assert `buildTransitionTree` groups by component/event, uses raw
  remainder keys, quotes nothing itself (quoting is the emitter's job), handles the `useEffect` and
  space/slash id cases, and is deterministically sorted.
- Codegen emission test: assert the nested `export const CustomerHome = { onClick: { … } }` shape,
  correct `TransitionRef<"id">` casts, quoted keys for non-identifier remainders, and state section
  unchanged.
- Loader test: a props file with `enabled(CustomerHome.onClick.isHistoryOpen)` and
  `stepTransitionId(CustomerHome.onSubmit["ACTION /order.start"])` rewrites to the literal ids and
  drops the `CustomerHome` import; a bad path is not silently accepted (TS/type error or diagnostic).
- Grep and fix any test still asserting flat `customerHome_*` exports.

**Step E — Docs + examples.**
- Update `docs/intro/quickstart.md` transition example to the nested form if present.
- Regenerate `examples/**` `*.modals.ts` and adjust example `*.props.ts` transition usages to the
  nested form (`pnpm ci:examples`).

## 7. Per-step files to edit

- A: `src/cli/codegen/transition-handles.ts`.
- B: `src/cli/codegen/component-state.ts`.
- C: `src/cli/properties/resolve-symbols.ts`.
- D: `src/cli/codegen/transition-handles.test.ts`, codegen emission test, loader test (+ grep hits).
- E: `docs/intro/quickstart.md`, `examples/**`.

## 8. Acceptance criteria

1. Generated `*.modals.ts` transitions section is one `export const <Component> = { … }` per component,
   nested `event → key`, with each leaf `"<id>" as TransitionRef<"<id>">`. No flat `customerHome_*`
   exports remain.
2. Keys are the raw id remainder after `Component.event.`; identifier-safe remainders are bare keys,
   others are quoted; events are object keys (quoted if needed).
3. `enabled(CustomerHome.onClick.isHistoryOpen)` and
   `stepTransitionId(CustomerHome.onSubmit["ACTION /order.start"])` type-check, are rewritten by the
   loader to the literal ids, and the `CustomerHome` import is stripped — producing identical check
   results to the prior flat-handle and original magic-string forms.
4. State section of `*.modals.ts` is byte-identical to before this change.
5. `pnpm typecheck`, `pnpm test`, `pnpm architecture`, `pnpm ci:examples`, `pnpm fix` pass.
6. No remaining references to `assignTransitionHandleNames` / flat transition naming in `src/`.

## 9. Tests to add or update

See Step D. Minimum: tree-builder unit test, nested-emission codegen test, member+element-access loader
rewrite test, and removal of stale flat-name assertions.

## 10. Verification commands

```
rtk pnpm vitest run src/cli/codegen/transition-handles.test.ts
rtk pnpm vitest run src/cli/properties
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm ci:examples
rtk pnpm fix
```

## 11. Risks, ambiguities, and stop conditions

- **Member-access resolution via `getSymbolAtLocation`**: confirm the semantic project
  (`generatedComponentVarEntries`) makes the nested object's property types visible so
  `transitionIdFromAccessExpression` resolves. If the symbol/declaration is not reachable, fall back to
  reading the literal from `checker.getTypeAtLocation(node)` (extract the string-literal constituent of
  the `TransitionRef` intersection). **Stop and report** if neither resolves.
- **Element access with quoted keys**: ensure `checker.getSymbolAtLocation` resolves
  `obj["ACTION /order.start"]` to the property symbol; if not, resolve by matching the string-literal
  argument against the object type's properties. Cover both `onSubmit["ACTION /order.start"]` and
  `onClick["isFree_phase.seq.pj0iff"]` in tests.
- **Import stripping correctness**: adding the root identifier (`CustomerHome`) to
  `rewrittenSymbolNames` strips its import. If a props file also uses `CustomerHome` for something other
  than a rewritten transition access, the import would be wrongly dropped. Acceptable for generated
  usage; **report** if any example legitimately reuses the name.
- **Hash-only keys remain ugly**: the three `CustomerHome.onClick.isFree_phase.seq.<hash>` leaves are
  still distinguished only by hash; nesting groups them but cannot name them. Out of scope here;
  locator-derived leaf keys are a possible future enhancement. **Do not** reintroduce locator naming in
  this change.
- **Empty remainder (`rest.length === 0`)**: only 2-segment ids would hit this; none observed. Using
  `"_"` as the key is the fallback. **Report** if a real id needs a better rule.
- **Component-name vs state-export collision**: a top-level `export const <Component>` could in
  principle collide with a state export of the same name. Components are PascalCase, state fields
  camelCase — collision is unlikely but **stop and report** if the emitter detects a duplicate export
  name within one module.
- If the repo differs from §3 (e.g. `transition-handles.ts` already produces a tree, or the loader
  already resolves member access), **stop and report** instead of forcing the diff.
