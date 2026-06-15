# 260615 — Navigation Overhaul (Overview / Index)

Implementation plan series for `docs/issues/route-inference-misses-low-state-routes.md`.
Audience: Cursor Composer 2. **This is the index.** Execute the phase files in order. Each
phase file is self-contained (≤ ~9 steps). **Do not refactor beyond what each step names.**

## Why (root cause)

Today `sys:route` is derived **backwards**: the route domain is scavenged from literal
`navigate()`/`<Link>` targets during transition extraction, and the route manifest is only
parsed in directory mode (single-file/props mode sets `routes: []` —
`src/cli/features/extract/command.ts:270-289`). Framework knowledge is **smeared into the
engine**: `src/extract/engine/ts/transition/navigation.ts:67-82` hardcodes
`navigate`/`.push`/`.replace`/`.back` as a fallback *even when the adapter returns
`"unsupported"`*, `<Link>` is hardcoded to the literal `"Link"` tag (`:94`), and
component→route uses name-matching heuristics in `src/extract/engine/ts/routes.ts:88-109`.

## Goal

Make navigation a **framework-agnostic abstraction** owned by a pluggable adapter:

- **Nodes = the route manifest** (a classified `RouteInventory`), **edges = navigation
  intents** (`push`/`replace`/`back`). The route domain is driven by the manifest, not by
  scavenged literals.
- The **engine becomes framework-blind**: it only ever asks the adapter
  (`classifyNavigationCall`, `classifyNavigationJsx`, `routeForFile`, `discoverRoutes`,
  `locationVars`). All react-router specifics live in one adapter.
- `sys:route` / `sys:history` stay as the **lowering target** (the checker's location state),
  produced by one navigation-lowering step — not hand-wired across the codebase.

## Design decisions (locked — do not relitigate)

1. **Full decouple.** Remove ALL hardcoded react-router knowledge from the engine; route
   everything through the adapter. **Keep** `sys:route`/`sys:history` as the fixed location
   convention (they are referenced by the *check* engine in 6 files — `check/engine/mounts.ts`,
   `check/slicing/slice-model.ts`, `check/traces/step-facts.ts`, `check/runtime/navigation.ts`,
   `check/runtime/effects.ts`, plus `core/ir/validator.ts`; **do not** touch those to rename).
2. **Lower redirects to existing IR.** A loader/route `redirect(T)` becomes an automatic
   route-bound `replace` transition (`{kind:"navigate", mode:"replace", to:lit(T)}`). **No new
   `EffectIR`/label kind.** `forward`/`go` are **out of scope** (deferred until the IR is
   extended later). `NavIntent.mode` stays `"push" | "replace" | "back"` to match the IR.
3. **Reduce history domain.** `sys:route` domain grows to all UI routes; `sys:history` **inner**
   domain is reduced to the navigation-relevant subset (push origins ∪ push targets ∪ initial),
   with a **sound global fallback** to the full `sys:route` domain when an unbound/global push
   exists. `maxHistory` default unchanged (4).

**Naming:** rename the SPI interface `RouterPlugin` → `NavigationAdapter`; keep
`RouterPlugin` as a `@deprecated` type alias. Rename the factory `routerSource()` →
`reactRouterAdapter()`; keep `routerSource` as an alias export. **Keep** the ctx/option field
name `routerPlugin` (renaming it ripples through pipeline/command/registry for no semantic gain
— out of scope).

**IR neutrality:** because of decision #2, **`EffectIR`/label, `core/ir/validator.ts`,
`check/**`, and `cli/features/export/command.ts` (TLA+) need NO changes.** If you find yourself
editing any of those for navigation semantics, **stop** — you have drifted from the plan.

## Phase map (execute in order)

| File | Scope | Steps | Changes model output? |
| --- | --- | --- | --- |
| `…-01-navigation-adapter-spi.md` | Define `NavigationAdapter` + nav types; registry validation; alias `RouterPlugin` | ~6 | No (additive) |
| `…-02-react-router-adapter.md` | Implement the react-router adapter (`discoverRoutes`, `classify*`, `routeForFile`, `locationVars`, redirect detection) | ~8 | No (not wired yet) |
| `…-03-engine-decouple.md` | Make engine framework-blind; remove fallbacks/`<Link>`/name heuristics; thread adapter+inventory | ~8 | Possibly (route binding) |
| `…-04-pipeline-cli-lowering.md` | Discover inventory in all modes; lower location (reduced history); synth redirects; route-coverage report | ~8 | **Yes (intended)** |
| `…-05-tests-and-migration.md` | Unit tests, golden/example/phase7 regen, Next.js interface-fit test | ~7 | Regen only |

Dependency order is strict: 01 → 02 → 03 → 04 → 05.

## Glossary (shared types — defined in Phase 01)

- `NavMode = "push" | "replace" | "back"`
- `NavIntent = { mode: NavMode; to?: string }`
- `RouteKind = "page" | "index" | "layout" | "resource"` (dynamic/`:param` and splat `*` are
  pattern *attributes*, not kinds; they stay `page`/`index`)
- `RouteNode = { pattern: string; kind: RouteKind; file?: string; redirectTo?: string }`
- `RouteInventory = { routes: readonly RouteNode[] }`
- **Modeled routes** (→ `sys:route` enum) = kinds `page` + `index`. `resource`/`layout` are
  excluded (reported in route coverage). Redirect-only pages are modeled (with an auto-edge).

## Global acceptance criteria

- For the TinyURL manifest (`docs/issues/route-inference-misses-low-state-routes.md`):
  `/`, `/links`, `/links/:id`, `/analytics`, `/tags`, `/signin`, `/no-chapter`, `/notfound`,
  `/:slug` are all in `sys:route`; `/api/links`, `/api/auth/*`, and `.ts` resource routes are
  excluded from `sys:route` and listed in the route-coverage report with a reason; any
  redirect-only route emits an automatic `replace` transition to its target.
- The engine contains **zero** react-router-specific identifiers
  (`grep -rn "navigate\|\\bLink\\b\|react-router" src/extract/engine` returns only
  generic/adapter-routed references — verify in Phase 03).
- `sys:history` inner domain ⊆ `sys:route` domain and is the reduced subset (or the full set
  via the documented sound fallback).
- The same engine drives a second (fake Next.js-style) adapter in a test (Phase 05),
  proving framework-agnosticism. **No production Next.js adapter is shipped.**

## Global verification (run after Phase 05; per-phase commands are in each file)

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm ci:examples
rtk pnpm fix
```

## Sequencing / green-ness note

Phases 01–02 are additive and keep all tests green. Phase 03 may shift route-binding output;
update the affected engine unit tests **within** Phase 03. Phase 04 deliberately changes model
output; **the full golden/example/phase7 regeneration is Phase 05** and the branch is not
"done" until Phase 05 passes. Intermediate phases keep their own targeted unit tests green but
may leave integration snapshots stale until Phase 05.

## Cross-cutting risks & stop conditions

- **STOP & ASK** if achieving the reduced `sys:history` subset cannot be proven sound for a
  given app (e.g. ambiguous push origins) — fall back to the full `sys:route` domain (sound)
  and note it, rather than guessing a smaller set.
- **STOP & REPORT** if a route manifest uses shapes the parser doesn't cover (`layout`,
  `prefix`, nested children, computed paths) — do **not** silently miscount; surface it.
- **STOP** if any change to `EffectIR`/`validator`/`check/**`/TLA+ export seems necessary for
  navigation — that violates decision #2; redirects must lower to the existing `navigate` effect.
- Do **not** rename the `routerPlugin` field or touch the 6 check-side `sys:route` references.
- Do **not** change `schemaVersion` (stays `1`).
