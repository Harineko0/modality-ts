# 260620-01 Property API Vitest-Style Overhaul

## 1. Goal

Replace the current `(model) => Property[]` property-authoring API with a Vitest-style,
side-effecting, registration-based API:

```ts
import { reachable, always, group, eq, and, not, lessThan, add, s } from "modality-ts/properties";
import { authAtom } from "./auth";        // module-scoped state: real symbol import
import { CustomerHome } from "./home";     // component, for its useState locals

const { phase } = s(CustomerHome);
const { capacity, count } = s(Cart);

reachable("customerCanReachConfirmPhase", eq(phase, "confirm"));

group("cart", () => {
  always("withinCapacity", not(lessThan(capacity, add(count, 1))));
  always("guestCannotReachAdmin", not(and(eq(authAtom, "guest"), eq(phase, "confirm"))));
});
```

Concretely:
- Builders accept `Operand = ExprIR | VarHandle | Value` (auto-lift primitives to `lit`,
  handles to `read`), so `readVar(...)`/`lit(...)` are no longer required at call sites.
- Rename `andExpr/orExpr/notExpr` → `and/or/not`; add comparison/arithmetic builders
  `lessThan/lessThanOrEqual/greaterThan/greaterThanOrEqual` and `add/sub/mod`.
- Property builders (`reachable/always/alwaysStep/reachableFrom/leadsToWithin`) drop their
  `model` first argument and **register** specs into a module-level collector instead of
  returning a `Property`. `group(name, fn)` nests a name prefix.
- Two ways to reference state:
  - **Module-scoped state** (atoms/stores/signals/context/consts): authored as a *real*
    `import { x } from "./source"`. The loader resolves the imported symbol → its
    `SourceAnchor` → `varId` via the TypeScript compiler and rewrites references to
    `readVar(varId)`. No generated runtime code; IDE rename propagates natively.
  - **`useState` locals** (function-local, not importable): referenced via
    `s(Component).field`; a **types-only** generated `.d.ts` makes the field set type-checked
    so drift is a compile error. Runtime `s` builds `local:<componentId>.<field>` handles.
- The CLI loader (`src/cli/properties/load-properties.ts`) resets the collector, imports the
  module (side effects register), harvests specs, and finalizes them against the `Model`
  (reads + enabledTransitions inference, currently done inside the builders).

## 2. Non-goals

- Do NOT add a virtual-module resolver so `useState` locals can be written as
  `import { phase } from "./home"`. This is impossible (locals have no module identity) and is
  explicitly out of scope; the `s(Component).field` accessor is the agreed alternative.
- Do NOT preserve backward compatibility. The `properties` / `propertiesFor` / `default`
  exports and the `(model) => Property[]` factory contract are removed (repo principle:
  experimental, no back-compat).
- Do NOT change the checker, model IR semantics, TLA+ export, or the `Property` wire shape in
  `src/core/ir/types.ts` (`Property`, `StatePredicateIR`, `StepPredicateIR` stay identical).
- Do NOT introduce runtime execution of user `.tsx` source during checking. Symbol resolution
  is type-level only (TS Program), never executes app code.
- Do NOT move the TypeScript dependency into `src/core` (architecture forbids it).

## 3. Current-state findings

- Builders live in `src/core/props/index.ts`. Each property builder takes `(model, predicate,
  options)` and returns a `Property`; `model` is used only by `propertyReads` (calls
  `inferReads`) and `propertyEnabledTransitions` (calls `inferEnabledTransitions`).
- Expression builders present today: `readVar`, `readPreVar`, `readOpArg`, `lit`, `eq`, `neq`,
  `andExpr`, `orExpr`, `notExpr`, `enabled(model, id)`, `enabledTransitionPrefix(model, prefix)`.
  There are **no** `lt/lte/gt/gte/add/sub/mod` builders — examples write raw IR objects
  (`{ kind: "lt", args: [...] }`).
- `PropertyFactory = (model: Model) => readonly Property[]` and `PropertyExport` are declared in
  `src/core/props/index.ts` and consumed by the loader.
- `src/core/index.ts` re-exports `./props/index.js` via `export *`.
- The loader `src/cli/properties/load-properties.ts`:
  - `loadProperties(model, propsPaths)` maps `propsPaths` with `Promise.all` (parallel).
  - For `.ts` props it transpiles with `typescript.transpileModule` (no type info) to a temp
    `.mjs`, then dynamic-imports. For other extensions it imports directly (copying under
    `.modality/import-cache` when `VITEST`).
  - It reads `module.propertiesFor` / `module.properties` (function or array) / `module.default`
    (array or `{schemaVersion, properties}`), then `assertSerializableProperty` per item.
- Var keys are strings: `local:<Component>.<field>`, `sys:pending`, `atom:<name>`,
  `swr:<...>`, `sys:route`, etc. Component = segment between `local:` and first `.`.
- Every `StateVarDecl.origin` already carries a precise `SourceAnchor { file; line?; column? }`
  for real declarations (see `src/extract/engine/ts/components.ts:522` for useState,
  `src/extract/sources/jotai/discover.ts:218` for atoms,
  `src/extract/engine/ts/transition/concurrent.ts:63`,
  `src/extract/engine/ts/react-source-transitions.ts:465`). System vars use `"system"`.
- `Model.metadata` is assembled in `src/cli/features/extract/command.ts` around lines 405–419
  (spread into `attachNumericReductions`/`attachFieldPruning`). Codegen `emitAppModel` is wired
  at `command.ts:479` (`await writeFile(appModelPath, emitAppModel(model), "utf8")`); the path is
  computed at `command.ts:191` (`app.model.ts` next to model path).
- Codegen helpers: `src/cli/codegen/model.ts` exports `emitAppModel(model)` and contains
  `typeForDomain`, `quoteProperty`, `stringLiteralType` (reusable for `.d.ts` emission).
- `package.json` `exports` includes `./core` and `./core/props` (mapped to
  `dist/core/props/index.js`). Build is `tsc -b`; no bundler. There is no `./properties` subpath.
- Architecture rules in `tools/depcruise.config.cjs`:
  - `core-is-stable-center`: `^src/core` must NOT depend on `^src/(check|extract|cli)`.
  - `runtime-imports-core-props-subpath-only`: `^src/cli/runtime` may only reach core via
    `^src/core/props/`.
  - `cli-feature-slices-do-not-import-each-other`.
  Implication: registry, builders, `VarHandle`, and `s()` must stay in `src/core/props`
  (pure, no `typescript`); the TS-Program symbol resolution + rewrite stays in `src/cli`.
- Examples to migrate: `examples/checkout-app/app.props.ts`, `examples/demo-app/app.props.ts`,
  `examples/todo-app/app.props.ts` (all use `andExpr/orExpr/notExpr/readVar/lit` and the
  `export const properties: PropertyFactory` form; `demo-app` defines a runtime helper
  `atMostOnePendingOp` and uses path reads like `readVar("sys:pending", ["0","opId"])`).

## 4. Exact file paths and relevant symbols

Create:
- `src/core/props/operand.ts` — `VarHandle`, `isVarHandle`, `varHandle`, `Operand`, `lift`.
- `src/core/props/registry.ts` — collector: `PendingSpec`, `resetRegistry`, `harvest`,
  `group`, and the registering property functions.
- `src/core/props/accessor.ts` — `s(Component, idOverride?)` Proxy + `ComponentLike` type.
- `src/cli/properties/resolve-symbols.ts` — TS-Program-based imported-symbol → `varId`
  resolver + AST rewrite (CLI side, may import `typescript`).
- `src/cli/codegen/component-state.ts` — `emitComponentStateTypes(model)` → types-only `.d.ts`.
- `examples/*/app.props.ts` rewrites (3 files).

Edit:
- `src/core/props/index.ts` — re-export new modules; rewrite expression builders to use
  `Operand`/`lift`; rename `andExpr/orExpr/notExpr`→`and/or/not`; add numeric builders; move
  property builders to register (delegate to `registry.ts`); add `finalizeProperties(model,
  specs)`; drop `PropertyFactory`/`PropertyExport`; `enabled(id)`/`enabledTransitionPrefix(prefix)`
  drop `model`.
- `src/core/ir/types.ts` — add optional `varAnchors?: Record<string, SourceAnchor>` to
  `Model.metadata`.
- `src/cli/features/extract/command.ts` — populate `metadata.varAnchors` from `model.vars`;
  emit the component-state `.d.ts` alongside `app.model.ts`; staleness check.
- `src/cli/properties/load-properties.ts` — serialize imports; run `resolve-symbols` rewrite
  before transpile; `resetRegistry()` → import → `harvest()` → `finalizeProperties(model, …)`.
- `package.json` — add `"./properties"` export subpath.
- `tools/depcruise.config.cjs` — only if a new allowed edge is required (see Risks); prefer not.
- Tests + docs as listed in §9.

## 5. Existing patterns to follow

- Builder style: small pure functions returning IR objects (current `src/core/props/index.ts`).
- Reads/enabledTransitions inference: reuse the existing `inferReads` / `inferStepFactReads` /
  `inferEnabledTransitions` walkers verbatim — only relocate where `model` is injected (into a
  new `finalizeProperties`), do not rewrite their logic.
- `.ts`/`.mjs` transpile + temp-cache pattern in `load-properties.ts`
  (`transpiledTypeScriptModule`, `importableModulePath`, `.modality/import-cache`).
- Codegen emit style in `src/cli/codegen/model.ts` (`emitAppModel`, `typeForDomain`,
  `quoteProperty`, `stringLiteralType`); the `.d.ts` emitter should reuse `typeForDomain`.
- `assertSerializableProperty` post-validation in the loader stays the final gate.
- `serialize-properties.ts` / `src/check/serialize-properties.ts` remain the wire format — the
  finalized `Property[]` must still pass `assertSerializableProperty`.

## 6. Atomic implementation steps

Each step is independently buildable (`pnpm typecheck`) and testable. Do them in order.

**Step 1 — Operands + handles (`src/core/props/operand.ts`).**
- Define `VarHandle<D = AbstractDomain>` as a branded readonly object:
  `{ readonly __modalityVar: true; varId: string; path?: readonly string[]; domain?: AbstractDomain }`.
- `varHandle(varId, domain?, path?)`, `isVarHandle(x)`.
- `type Operand = ExprIR | VarHandle | Value`.
- `lift(op): ExprIR` — `isVarHandle`→`{kind:"read", var, path}`; `isExprIR(op)`→passthrough
  (detect via `"kind" in op` and a known kind set); otherwise `{kind:"lit", value: op}`.
- Export from `src/core/props/index.ts`.

**Step 2 — Expression builders (`src/core/props/index.ts`).**
- Rewrite `eq/neq` to `(left: Operand, right: Operand)` using `lift`.
- Add `and(...args: Operand[])`, `or(...args: Operand[])`, `not(arg: Operand)`.
- Remove `andExpr/orExpr/notExpr`.
- Add `lessThan/lessThanOrEqual/greaterThan/greaterThanOrEqual` → `{kind:"lt"|"lte"|"gt"|"gte"}`
  and `add/sub/mod` → `{kind:"add"|"sub"|"mod"}`, all `(a: Operand, b: Operand)` via `lift`.
- Keep `readVar/readPreVar/readOpArg/lit` as escape hatches.
- `enabled(transitionId: string)` and `enabledTransitionPrefix(prefix: string)` drop `model`.

**Step 3 — Registry + group (`src/core/props/registry.ts`) and finalize.**
- `interface PendingSpec` capturing the raw builder inputs + computed `name` (with group prefix)
  + a discriminant per kind (always/alwaysStep/reachable/reachableFrom/leadsToWithin) +
  raw predicates/triggers/options.
- Module-level `let specs: PendingSpec[] = []` and `let prefix: string[] = []`.
- `resetRegistry()`, `harvest(): PendingSpec[]` (returns and clears).
- `group(name, fn)`: push name, run `fn()`, pop (try/finally).
- Registering builders `reachable/always/alwaysStep/reachableFrom/leadsToWithin`: signature
  `(name, predicate/…, options?)`; push a `PendingSpec` with `name = [...prefix, name].join(" > ")`.
  These REPLACE the old returning builders in `src/core/props/index.ts` (re-export from registry).
- `finalizeProperties(model: Model, specs: PendingSpec[]): Property[]` — builds the final
  `Property` objects, calling the relocated `propertyReads`/`propertyEnabledTransitions`
  (now taking `model` here) so `transitionEnabled`/prefix reads resolve. `reads` for the common
  case derive from handles/`read` nodes already in the predicate (unchanged walker).
- Remove `PropertyFactory` / `PropertyExport` types.

**Step 4 — `s()` accessor (`src/core/props/accessor.ts`) + types-only codegen.**
- Runtime: `s(component, idOverride?)` returns a `Proxy` whose `get(_, field)` returns
  `varHandle(\`local:${idOverride ?? component.name}.${String(field)}\`)`. Support destructuring
  (each get returns a handle). `ComponentLike = { name?: string } | ((...a:any)=>any)`.
- The public typed signature is provided by generated `.d.ts` augmentation (below); the runtime
  `.ts` keeps a permissive generic return so `core` stays self-contained.
- `src/cli/codegen/component-state.ts`: `emitComponentStateTypes(model)` emits a types-only
  module declaring, per component, an interface of its local fields → `VarHandle<domain>` and a
  typed `s` overload set (or a `ComponentStateMap` consumed by a generic `s`). Reuse
  `typeForDomain`. Emit only components that have `local:` vars.

**Step 5 — Model anchors + loader symbol resolution.**
- `src/core/ir/types.ts`: add `varAnchors?: Record<string, SourceAnchor>` to `Model.metadata`.
- `src/cli/features/extract/command.ts`: when building `metadata` (around lines 405–419),
  set `varAnchors` from `model.vars` where `decl.origin` is a `SourceAnchor` object
  (`typeof origin === "object"`), keyed by `decl.id`.
- `src/cli/properties/resolve-symbols.ts`: given the props file path + `Model`, build a
  `ts.Program`/`LanguageService` using the nearest `tsconfig`, find imported identifiers used as
  operands, resolve each to its declaration node, match the declaration's `{file,line}` against
  `model.metadata.varAnchors`, and rewrite the identifier reference to a `readVar(varId)` call
  (or wrap as `varHandle`). Only rewrite symbols whose declaration anchor is found in
  `varAnchors`; leave everything else untouched. Emit the rewritten source for the existing
  transpile path.
- `src/cli/properties/load-properties.ts`: change `Promise.all` to a sequential loop; for each
  path: `resetRegistry()` → apply `resolve-symbols` rewrite → transpile/import → `harvest()` →
  `finalizeProperties(model, specs)` → `assertSerializableProperty` each. Remove the
  `properties/propertiesFor/default` branching.

**Step 6 — Package export.**
- `package.json`: add `"./properties": { "types": "./dist/core/props/index.d.ts", "default":
  "./dist/core/props/index.js" }`. (Authoring API lives in `core/props`; keep `./core/props`
  too.) Confirm `tsc -b` emits these unchanged.

**Step 7 — Migrate examples + tests + docs (see §9).**

## 7. Per-step files to edit

- Step 1: create `src/core/props/operand.ts`; edit `src/core/props/index.ts` (export).
- Step 2: edit `src/core/props/index.ts`.
- Step 3: create `src/core/props/registry.ts`; edit `src/core/props/index.ts`.
- Step 4: create `src/core/props/accessor.ts`, `src/cli/codegen/component-state.ts`; edit
  `src/cli/features/extract/command.ts` (emit + path).
- Step 5: edit `src/core/ir/types.ts`, `src/cli/features/extract/command.ts`,
  `src/cli/properties/load-properties.ts`; create `src/cli/properties/resolve-symbols.ts`.
- Step 6: edit `package.json`.
- Step 7: edit `examples/checkout-app/app.props.ts`, `examples/demo-app/app.props.ts`,
  `examples/todo-app/app.props.ts`; tests + docs per §9.

## 8. Acceptance criteria

- `eq(handle, "confirm")` and `eq(readVar("x"), "y")` both compile and produce the same IR as
  the old `eq(readVar("x"), lit("y"))`.
- `and/or/not` exist; `andExpr/orExpr/notExpr` no longer exported (grep returns 0 in `src`).
- `lessThan/lessThanOrEqual/greaterThan/greaterThanOrEqual/add/sub/mod` produce the matching IR
  `kind`s and pass `assertSerializableProperty` through a property.
- Property builders take no `model` argument; calling them at module top level registers specs;
  `group("g", () => reachable("p", …))` yields a property named `g > p`.
- `loadProperties(model, [propsPath])` returns the same finalized `Property[]` (same `reads`,
  `enabledTransitions`, `predicate`) as the pre-overhaul examples produced — verify on at least
  one migrated example via a golden comparison.
- A props file using `import { authAtom } from "./auth"; eq(authAtom, "guest")` resolves to
  `readVar("atom:authAtom")` via `varAnchors`, with no committed generated handle file.
- `s(CustomerHome).phase` (and destructured `const { phase } = s(CustomerHome)`) yields a handle
  with `varId === "local:CustomerHome.phase"`; the generated `.d.ts` flags an unknown field as a
  type error.
- `pnpm typecheck`, `pnpm test`, `pnpm architecture`, `pnpm ci:examples`, `pnpm phase7` all pass.

## 9. Tests to add or update

Add:
- `test/core/props/operand.test.ts` — `lift` for handle/primitive/ExprIR; `eq/and/not/lessThan/
  add` IR shapes.
- `test/core/props/registry.test.ts` — registration order, `group` name prefixing, `reset/harvest`
  isolation, `finalizeProperties` reads + enabledTransitions parity with old `inferReads`.
- `test/core/props/accessor.test.ts` — `s(Component).field` and destructuring → correct `varId`;
  `idOverride`.
- `test/cli/properties/resolve-symbols.test.ts` — imported module-scoped symbol → `varId` rewrite
  using a fixture model `varAnchors`; unknown symbol left untouched / reported.
- A loader golden test: load a migrated example props file against its model and deep-equal the
  finalized `Property[]` to the pre-overhaul output.

Update (search and fix):
- Any test importing `andExpr|orExpr|notExpr|PropertyFactory|PropertyExport` or asserting the
  `properties`/`propertiesFor` export contract. Grep: `rtk grep -rn "andExpr\|orExpr\|notExpr\|
  PropertyFactory\|propertiesFor" test src examples docs`.
- `src/cli/properties/load-properties.ts` existing tests (loader behavior).
- `src/cli/codegen/*` tests if present (add `.d.ts` emission coverage).

## 10. Verification commands

Run after each step where applicable, all before completion:
- `rtk pnpm typecheck`
- `rtk pnpm test`
- `rtk pnpm architecture`
- `rtk pnpm fix`
- `rtk pnpm ci:examples`
- `rtk pnpm phase7`
- Sanity grep: `rtk grep -rn "andExpr\|orExpr\|notExpr\|PropertyFactory" src test examples` → empty.

## 11. Risks, ambiguities, and stop conditions

- **Architecture (hard rule).** `src/core/props` must not import `typescript` or anything under
  `src/(check|extract|cli)`. Keep `VarHandle`, builders, registry, `s()` pure. If any of these
  appear to need `typescript`, STOP — the design is wrong; resolution belongs in `src/cli`.
- **Singleton registry races.** The loader currently imports props files with `Promise.all`.
  With a module-level collector this races. MUST serialize. If serialization is infeasible for a
  reason discovered in the repo, STOP and report (do not silently parallelize).
- **Symbol resolution cost/complexity (Step 5).** Building a full `ts.Program` per props file is
  the riskiest piece. If a referenced imported symbol's declaration anchor is not present in
  `model.metadata.varAnchors`, do NOT guess — throw a clear error naming the symbol and file, and
  report. Steps 1–4 + 6–7 are shippable without Step 5 (authors can use `readVar`/`s()` until
  then); if Step 5 balloons, land it separately.
- **`Component.name` reliability.** `s(Component)` derives the component id from `Component.name`,
  which is unreliable under `memo`/`forwardRef`/HOC/minification. Mitigation: `idOverride` param +
  the generated `.d.ts` keyed by extractor `componentId`. If an example component’s runtime
  `.name` ≠ extractor `componentId`, STOP and report rather than emitting a wrong `varId`.
- **`demo-app` path reads.** `readVar("sys:pending", ["0","opId"])` and the `atMostOnePendingOp`
  runtime helper must still work. Handles need `.at(path)` or keep `readVar(id, path)` usable
  inside helpers. Verify the migrated `demo-app` produces byte-identical finalized properties.
- **No back-compat.** Removing `properties/propertiesFor/default` will break any not-yet-migrated
  props file. Migrate all three examples in the same change; if other in-repo props files exist
  (grep `rtk grep -rln "PropertyFactory\|export const properties" examples test`), migrate or
  STOP and list them.
- **`varAnchors` size.** Adding anchors to `model.metadata` enlarges the serialized model and may
  shift golden/snapshot fixtures. If model snapshot tests fail only due to the new metadata field,
  update snapshots; if they fail for other reasons, STOP and report.
- **Ambiguity — authoring entry path.** Plan adds `modality-ts/properties` mapped to
  `dist/core/props/index.js`. If the user prefers keeping only `modality-ts/core`, that is a
  trivial swap; default to adding `./properties`.
```
