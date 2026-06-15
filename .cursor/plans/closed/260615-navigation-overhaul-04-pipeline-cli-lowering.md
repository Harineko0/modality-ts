# 260615 — Navigation Overhaul · Phase 04: Discovery, Location Lowering, Redirects, Coverage

Prereq: Phases 00–03. This phase **wires it together** and **intentionally changes model
output**: the route manifest is discovered in all modes, `sys:route` is driven by the classified
inventory, `sys:history` is reduced, redirect-only routes get auto-edges, and the report gains a
route-coverage section. This is the phase that fixes the issue.

## Goal

- Discover the `RouteInventory` via `adapter.discoverRoutes` in **file/props AND directory**
  modes (IO lives in the CLI).
- Lower location state via `adapter.locationVars(inventory, options, lowering)` (reduced history).
- Synthesize redirect transitions from `inventory[].redirectTo`.
- Emit a `routeCoverage` report section (byproduct of the inventory) + a CLI summary line.
- Delete the obsolete CLI manifest parser + the scavenged `discoveredRoutes` dump.

## Non-goals

- No IR changes (redirects lower to the existing `navigate` `replace` effect).
- No `check/**`/TLA+ changes.
- No new `--include-low-state-routes` flag — UI routes (`page`/`index`) are now included by
  default; `resource` exclusions are *explained* in the report.

## Current-state findings

- `command.ts:264-351` `loadExtractionProject` / `loadMultiFileExtractionProject` produce
  `project.sources` (`{path,text}[]`), `project.routes`, `project.entryFile`, `configStartDir`.
- `command.ts:105-129` runs the pipeline then builds `discoveredRoutes` (scavenged) and calls
  `routerPlugin.routeVars(...)`. **Replace** with inventory-driven `locationVars`.
- `command.ts:548-581` `parseReactRouterRoutes`/`reactRouterPathPattern` — **delete** (moved to
  the adapter in Phase 02; remove the temporary re-export too).
- `command.ts:160-163` (pipeline) and `command.ts:1066-1087` (`transitionNavigatedRoutes`) both
  compute navigated routes — reuse for the `LocationLowering` summary.
- Report is built by `createExtractionReport(...)` (`command.ts:861-936`); it already attaches
  `stateContributors`. Add `routeCoverage` the same way. Type lives in
  `src/core/report/types.ts:135-159` (`ExtractionReport`).
- `engine/pipeline/index.ts:160-177` builds `routes` + `routeVars` inside the pure pipeline — it
  must accept an `inventory` + `lowering` and call `locationVars`; redirect synthesis can live
  here (pure, given the inventory) or in the CLI. **Put redirect synthesis in the pipeline**
  (pure) and discovery/IO in the CLI.

## Files to edit / add

- `src/core/report/types.ts` — add optional `routeCoverage` + types
- `src/cli/features/extract/command.ts` — discovery (IO), lowering, coverage, CLI line, deletions
- `src/extract/engine/pipeline/index.ts` — accept inventory/lowering; `locationVars`; redirect synth
- `src/extract/sources/router/redirects.ts` *(new, or in discover.ts)* — `synthesizeRedirectTransitions(inventory)`
- tests updated in Phase 05

## Atomic steps

1. **Report types** (`core/report/types.ts`): add
   ```ts
   export type RouteCoverageClassification = "api" | "redirect-only" | "no-client-state" | "unsupported";
   export interface RouteCoverageEntry { pattern: string; modeled: boolean; classification?: RouteCoverageClassification; reason?: string }
   export interface RouteCoverage { configured: number; modeled: number; routes: readonly RouteCoverageEntry[] }
   ```
   and `routeCoverage?: RouteCoverage;` on `ExtractionReport` (optional, additive; `schemaVersion`
   stays `1`).
2. **Discover inventory in the CLI** (`loadExtractionProject` + multi-file): after loading
   `sources`, call `await adapter.discoverRoutes({ rootDir: configStartDir, files: sources, readFile })`
   and store `project.inventory: RouteInventory`. Do this in **both** branches (file/props and
   directory) so behavior is mode-consistent. Drop reliance on `project.routes` for the model
   (keep it only if still used for `routePatterns` normalization input — pass
   `inventory.routes.map(r=>r.pattern)` as `routePatterns`).
3. **Build the `LocationLowering` summary** in `runExtractCommand` from the extracted
   transitions: `pushTargets` = literal `to` of push/replace navigate effects;
   `pushOrigins` = resolved route patterns of components that emit those (via
   `adapter.routeForComponent`); `hasUnboundPush` = any push/replace whose origin can't be
   resolved. Reuse `transitionNavigatedRoutes` logic.
4. **Lower location** (`command.ts`): replace the `discoveredRoutes`/`routeVars` block (`:114-136`
   region) with `const routeVars = adapter.locationVars(project.inventory, { route, bounds: { maxHistory: 4 } }, lowering);`
   Remove the scavenged `discoveredRoutes` array entirely.
5. **Synthesize redirects**: add `synthesizeRedirectTransitions(inventory)` (pure) →
   for each node with a literal `redirectTo = T`, emit an auto-transition
   `{ id:"route:"+pattern+".redirect."+safeId(T), cls:"nav", guard: eq(sys:route, lit(pattern)),
   effect:{kind:"navigate", mode:"replace", to:lit(T)}, reads:["sys:route","sys:history"],
   writes:["sys:route","sys:history"], confidence:"exact" }`. Call it in
   `pipeline/index.ts` (or CLI) and append to `transitions` **before** building the report.
   Ensure `T` is a modeled route value (it should be, since redirect targets are UI routes).
6. **Pipeline signature** (`engine/pipeline/index.ts`): add `inventory?: RouteInventory` +
   `lowering?: LocationLowering` to `ExtractionPipelineOptions`; replace the internal
   `routes`/`routeVars` (`:160-174`) with `locationVars` + redirect synthesis. Keep the pure/no-IO
   contract (discovery already happened in the CLI).
7. **Route coverage** (`command.ts`, in/near `createExtractionReport`): compute from
   `project.inventory` vs the final `sys:route` enum values —
   `modeled` = pattern ∈ sys:route values; for non-modeled set `classification`:
   `resource`→`api`; node has `redirectTo` but excluded→`redirect-only`; pattern has `*`→
   `unsupported`; else `no-client-state` (+ matching `reason`). Attach `routeCoverage` to the
   report. Add a CLI summary line (after `state-space≈…`), only when `inventory.routes.length>0`:
   `routes configured=<n> modeled=<m> omitted=<n-m> [api=<a>,…]`. Keep `lines[0]` unchanged.
8. **Delete dead code**: remove `parseReactRouterRoutes`, `reactRouterPathPattern`, the temporary
   re-export, and any now-unused `transitionNavigatedRoutes`/`discoveredRoutes` helpers in
   `command.ts`. Typecheck.

## Acceptance criteria

- File/props-mode extraction of an app with `app/routes.ts` now yields a `sys:route` enum
  containing all `page`/`index` routes (incl. `/signin`, `/notfound`, `/:slug`, `/no-chapter`),
  with `resource` routes excluded and present in `report.routeCoverage` (classification `api`).
- `sys:history` inner domain is the reduced set (or full set via the documented fallback), and is
  a subset of `sys:route` values.
- A redirect-only route emits exactly one auto `replace` transition to its (modeled) target.
- `report.routeCoverage.configured/modeled` are correct; the CLI prints the `routes …` line when a
  manifest exists and omits it otherwise; `lines[0]` is still `extracted vars=… transitions=…`.
- Directory and file modes produce the **same** route modeling for the same app.

## Tests to add/update (full set in Phase 05)

- Extend `command.test.ts`: file-mode manifest discovery; `sys:route` inclusion of UI routes;
  `resource` exclusion + coverage entry; redirect auto-edge; reduced `sys:history` domain;
  CLI `routes …` line present/absent.

## Verification

```bash
rtk pnpm typecheck
rtk pnpm exec vitest run src/cli/features/extract src/extract/engine/pipeline
```

## Risks / stop conditions

- **STOP & ASK** if a redirect target `T` is not a modeled `sys:route` value (would create a
  dangling enum value) — either add `T` to the route domain or drop the auto-edge and report it.
- If `discoverRoutes` finds **no** manifest in file/props mode (no `app/routes.ts` upward),
  `inventory.routes` is empty → behavior must match today's "navigated routes only" model (no
  coverage section, no `routes …` line). Verify this fallback keeps simple single-file fixtures
  byte-stable.
- Keep redirect synthesis deterministic (sorted by pattern then target) for stable model output.
