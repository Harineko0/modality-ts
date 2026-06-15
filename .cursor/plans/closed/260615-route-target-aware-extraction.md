# Goal

Make extraction target-aware so each generated model starts on, and scopes route-local state to, the route represented by the source/props file being extracted. This fixes models like `app/routes/tags.tsx`, `app/routes/analytics.tsx`, and `app/routes/links.$id.tsx` currently assigning every `useState` declaration to route `/`.

For the tinyurl case, the generated models should contain:

- `app/routes/analytics.tsx` state scoped to `/analytics`
- `app/routes/tags.tsx` state scoped to `/tags`
- `app/routes/links.$id.tsx` state scoped to `/links/:id`
- `app/routes/home.tsx` state scoped to `/`

The config format may change. Do not preserve the old scalar `route: "/"` semantics for props-driven route extraction.

# Non-goals

- Do not change checker property semantics in this plan; mounted-only property evaluation is a separate plan.
- Do not teach the extractor new callback shapes in this plan; controlled callback extraction is a separate plan.
- Do not alter `Model`, `Transition`, `StateVarDecl`, or route inventory schema.
- Do not redesign artifact paths beyond what is needed to pass route context into each extraction.
- Do not retain a compatibility layer that silently applies one configured route to every source file.

# Current-state findings

- `/Users/hari/proj/gdgjp/tinyurl/modality.config.ts` currently has `route: "/"`.
- `src/cli/features/extract/command.ts`
  - `ModalityConfig` exposes `route?: string`.
  - `runExtractCommand()` computes `const route = options.route ?? config.route ?? "/"` before route inventory is attached.
  - That `route` is passed into `runExtractionPipeline()` and `routerAdapter.locationVars()`.
- `src/extract/engine/ts/react-source-transitions.ts`
  - `extractReactSourceTransitions()` computes `const route = options.route ?? "/"`.
  - `useState` vars are scoped with `{ kind: "route-local", route }` at the declaration site.
  - The file already resolves component route patterns for navigation guards through `resolveComponentRoutePattern()`, but state scoping still uses the single `route` option.
- `src/extract/sources/router/discover.ts`
  - `discoverRoutes()` parses React Router route manifests into `{ pattern, file, kind }`.
  - `routeForComponent()` only works when a component name matches route file names; it does not cover every default route component reliably.
- `src/cli/defaults.ts`
  - `inferExtractTargetsFromProps()` already maps each `*.props.mjs` to a sibling `.tsx` and artifact paths under `.modality/models`.
  - This is the right place to carry target metadata if needed.

# Exact file paths and relevant symbols

- `src/cli/features/extract/command.ts`
  - `ModalityConfig`
  - `ExtractCommandOptions`
  - `runExtractCommand()`
  - `loadExtractionProject()`
  - `loadMultiFileExtractionProject()`
  - `attachRouteInventory()`
  - `buildLocationLowering()`
- `src/cli/defaults.ts`
  - `ExtractTargetFromProps`
  - `inferExtractTargetsFromProps()`
  - `artifactPathsForPropsFile()`
- `src/cli/cli.ts`
  - no-argument `extract` branch around `inferExtractTargetsFromProps()`
  - explicit-source `extract` branch around `runExtractCommand()`
- `src/extract/engine/pipeline/index.ts`
  - `runExtractionPipeline()`
  - `route` option plumbing
- `src/extract/engine/ts/react-source-transitions.ts`
  - `extractReactSourceTransitions()`
  - `route` local
  - `useState` state var declaration block
- `src/extract/sources/router/discover.ts`
  - `discoverRoutes()`
  - `parseReactRouterRoutes()`
  - `routeForComponent()`
- Tests:
  - `src/cli/features/extract/command.test.ts`
  - `test/modality/cli-defaults.test.ts`
  - `test/modality/cli.test.ts`
  - `test/extraction/extraction.test.ts`

# Existing patterns to follow

- Keep route inventory discovery in the router source plugin.
- Keep extraction orchestration in `src/cli/features/extract/command.ts` and CLI fan-out in `src/cli/cli.ts`.
- Preserve deterministic output ordering by sorting targets and route matches.
- Use path helpers from `node:path` (`resolve`, `relative`, `dirname`, `join`) rather than string-only path manipulation, except for known suffix replacement.
- Tests should use existing temp-project patterns with `mkdtemp`, `mkdir`, `writeFile`, and subprocess CLI helpers.

# Atomic implementation steps

1. Replace scalar config route with target-aware navigation config.

   Files to edit:
   - `src/cli/features/extract/command.ts`
   - `src/cli/features/init/command.ts`
   - `test/modality/cli.test.ts`

   Implementation:
   - Remove `route?: string` from `ModalityConfig`.
   - Add a small explicit shape such as:
     - `navigation?: { initialRoute?: string; routeBySource?: Record<string, string> }`
   - `initialRoute` is only a fallback when a source cannot be matched to a discovered route.
   - `routeBySource` keys are project-relative source paths, for manual override.
   - Update `modality init` to stop writing `route: "/"`; write no navigation block by default.
   - Do not preserve `config.route`.

2. Resolve the route after route inventory is available.

   Files to edit:
   - `src/cli/features/extract/command.ts`

   Implementation:
   - Move route resolution until after `const project = await attachRouteInventory(...)`.
   - Add a helper, for example:
     - `resolveExtractionRoute(project, config, options): string`
   - Resolution order:
     - `options.route`, if the command API still supports explicit override;
     - `config.navigation?.routeBySource` for a matching project-relative source path;
     - route inventory file match for the extraction target;
     - `config.navigation?.initialRoute`;
     - `/`.
   - A source file matches a route when `resolve(manifestDir, node.file) === resolve(sourcePath)` for a `page` or `index` route.
   - For single-source props extraction, choose the matching route for that source.
   - For multi-source merged extraction, use `config.navigation?.initialRoute ?? "/"`; if multiple route files are present and no initial route is configured, report a clear error rather than guessing.

3. Thread the resolved route through existing extraction.

   Files to edit:
   - `src/cli/features/extract/command.ts`

   Implementation:
   - Pass the resolved route into `runExtractionPipeline({ route })`.
   - Pass the same route into `routerAdapter.locationVars()`.
   - Ensure `result.lines` optionally includes `route=<resolvedRoute>` for diagnosability.
   - Do not change `runExtractionPipeline()` internals unless type errors require option shape updates.

4. Carry source path identity through target discovery if needed.

   Files to edit:
   - `src/cli/defaults.ts`
   - `src/cli/cli.ts`

   Implementation:
   - If `runExtractCommand({ sourcePath })` has enough information, keep `ExtractTargetFromProps` unchanged.
   - If route override is easier through `options.route`, add `route?: string` to `ExtractTargetFromProps` and compute it from the nearest `app/routes.ts` manifest. Prefer resolving inside `runExtractCommand()` so library callers get the same behavior.

5. Add route target unit coverage.

   Files to edit:
   - `src/cli/features/extract/command.test.ts`

   Test case:
   - Build a temp React Router project with `app/routes.ts` containing:
     - `index("routes/home.tsx")`
     - `route("analytics", "routes/analytics.tsx")`
     - `route("tags", "routes/tags.tsx")`
     - `route("links/:id", "routes/links.$id.tsx")`
   - Extract each route source independently with `runExtractCommand()`.
   - Assert route-local vars have the expected `scope.route`.
   - Assert `sys:route.initial` equals the expected route.

6. Add no-argument CLI regression coverage.

   Files to edit:
   - `test/modality/cli.test.ts`

   Test case:
   - Create the same temp project with `.props.mjs` files beside the route `.tsx` files.
   - Run `modality extract` with no source args.
   - Read generated per-props model JSON files under `.modality/models`.
   - Assert each generated route-local var is scoped to the route corresponding to the props/source path.
   - Assert no generated route model scopes all route-local state to `/`.

7. Update config tests and init expectations.

   Files to edit:
   - `test/modality/cli.test.ts`
   - `src/cli/features/extract/command.test.ts`

   Implementation:
   - Update tests that expect generated config to contain `route: "/"`.
   - Add a config-load test for `navigation.initialRoute`.
   - Add a config-load test for `navigation.routeBySource`.

# Per-step files to edit

- Step 1:
  - `src/cli/features/extract/command.ts`
  - `src/cli/features/init/command.ts`
  - `test/modality/cli.test.ts`
- Step 2:
  - `src/cli/features/extract/command.ts`
- Step 3:
  - `src/cli/features/extract/command.ts`
- Step 4:
  - `src/cli/defaults.ts`
  - `src/cli/cli.ts`
- Step 5:
  - `src/cli/features/extract/command.test.ts`
- Step 6:
  - `test/modality/cli.test.ts`
- Step 7:
  - `test/modality/cli.test.ts`
  - `src/cli/features/extract/command.test.ts`

# Acceptance criteria

- `analytics.model.json` generated from `app/routes/analytics.tsx` has `sys:route.initial === "/analytics"`.
- `tags.model.json` generated from `app/routes/tags.tsx` has `sys:route.initial === "/tags"`.
- `links.$id.model.json` generated from `app/routes/links.$id.tsx` has `sys:route.initial === "/links/:id"`.
- Route-local `useState` vars in those models use matching `scope.route` values.
- `modality init` no longer writes `route: "/"`.
- A scalar `route` in `modality.config.ts` is no longer required or honored.
- Multi-source merged extraction without an explicit `navigation.initialRoute` fails with a clear message when sources map to more than one route.
- Existing route inventory and route coverage reports still include configured UI routes.

# Tests to add or update

- `src/cli/features/extract/command.test.ts`
  - Add route source to route-local scope tests for `analytics`, `tags`, `links/:id`, and index route.
  - Add config tests for `navigation.initialRoute` and `navigation.routeBySource`.
  - Update/remove old expectations around `config.route`.
- `test/modality/cli.test.ts`
  - Add no-argument props-driven extraction test verifying each generated model uses its own route.
  - Update init config expectations.
- `test/modality/cli-defaults.test.ts`
  - Add target discovery assertions only if target route metadata is added there.
- `test/extraction/extraction.test.ts`
  - Update low-level route-local expectations only if the route option shape changes at the pipeline/test helper level.

# Verification commands

Run from `/Users/hari/proj/modality-ts`:

```bash
rtk pnpm test -- src/cli/features/extract/command.test.ts test/modality/cli.test.ts test/modality/cli-defaults.test.ts
rtk pnpm test -- test/extraction/extraction.test.ts
rtk pnpm typecheck
rtk pnpm architecture
rtk pnpm fix
```

Manual tinyurl check:

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality extract
rtk node -e 'const fs=require("fs"); for (const p of ["analytics","tags","links.$id"]) { const m=JSON.parse(fs.readFileSync(`.modality/models/app/routes/${p}.model.json`,"utf8")); console.log(p, m.vars.filter(v => v.id==="sys:route" || v.id.startsWith("local:")).map(v => [v.id, v.initial, v.scope])); }'
```

# Risks, ambiguities, and stop conditions

- Stop and report if route inventory is unavailable for a props-driven route source. Do not fall back to `/` silently.
- Stop and report if one source path maps to multiple UI route patterns. Require `navigation.routeBySource` to disambiguate.
- Stop and report if multi-source extraction is still needed by a test as the default behavior. The new behavior should require an explicit `navigation.initialRoute` for merged models.
- Risk: shared components imported into a route file may have state. For this plan, imported shared component state should be scoped to the route currently being extracted unless it is detected as a provider/global component.
- Risk: `routeForComponent()` remains name-based. Do not rely on it for state scoping; file-to-route matching is the source of truth.
- Do not attempt to solve mounted-only property evaluation in this plan. Even with correct route scopes, properties can still fail after navigation until the mounted semantics plan is implemented.
