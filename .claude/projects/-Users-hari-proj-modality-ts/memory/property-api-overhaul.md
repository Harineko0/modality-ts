---
name: property-api-overhaul
description: Vitest-style property API overhaul — handles, registration, and the removed-API split
metadata:
  type: project
---

Overhaul of the property-authoring API toward a Vitest-style surface (`src/core/props`, `src/cli/properties`). Implemented by Cursor from `.cursor/plans/260620-01-property-api-vitest-overhaul.md`; reviewed + finished 2026-06-20.

**Authoring surface (`modality-ts/properties` = `src/core/props/index.ts`):** top-level `reachable("name", eq(handle, "x"))` / `always` / `alwaysStep` / `reachableFrom` / `leadsToWithin`, optional `group(name, fn)`. Builders take no `model` arg; they register specs into a module-level registry (`registry.ts`), harvested + finalized against the model by the loader (`load-properties.ts` → `finalizeProperties`). `andExpr/orExpr/notExpr` → `and/or/not`; added `lessThan/lessThanOrEqual/greaterThan/greaterThanOrEqual` + `add/sub/mod`; builders accept `Operand = ExprIR | VarHandle | Value` (auto-lift).

**Referencing state — two regimes:** module-scoped state (atoms/stores) is a *real* `import { x } from "./src"`, resolved to its `varId` by `resolve-symbols.ts` (TS Program over the props file, matched against `model.metadata.varAnchors`, rewritten to `varHandle("...")`) — no codegen, IDE-rename-safe. `useState` locals use `s(Component).field` (runtime Proxy → `local:<id>.<field>`), typed by a generated types-only `.component-state.d.ts`. Extractor already stamps `StateVarDecl.origin` with `{file,line,column}`.

**Removed-API decision (user: "no backward compat"):** the authoring entry must NOT expose `lit`/`readVar`/`readPreVar`. Replacements: primitives auto-lift (no `lit`); `varHandle(id)` + `handle.at(...path)` (no `readVar`); `pre(handle)` (no `readPreVar`). `readOpArg` KEPT (op-args aren't state vars). The rewrite emits `varHandle(...)`. The raw-IR builders `readVar`/`readPreVar`/`lit` still live in `src/core/props/raw-ir.ts`, exported ONLY from `modality-ts/core` (via `core/index.ts`), for internal IR construction + hand-model checker tests (`test/checker/checker.test.ts` has 200+ `eq(readVar,lit)` sites, import from core, NOT migrated). Do NOT re-export raw-ir from `props/index.ts` or it leaks into the authoring API. `VarHandle` has an `at()` method → assert handle shape with `toMatchObject`, not `toEqual`.

Verified: `pnpm typecheck`, full `vitest run` (84 files / 1053 tests), `pnpm architecture`, `pnpm ci:examples` all green. Pre-existing biome debt remains in untouched files (`async.ts`, `contributors.ts`, `export/command.ts`, `project.ts`) — not part of this work. See [[property-api-current-shape]].
