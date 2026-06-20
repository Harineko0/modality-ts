# TanStack Router Support Plan 4: End-to-End Examples, Docs, and Conformance

## 1. Goal

Add end-to-end TanStack Router fixtures, examples, documentation, and conformance coverage so "TanStack Router support" is verifiable from route discovery through extraction, checking, replay-harness generation, and user-facing docs.

This plan depends on:

- `260621-01-tanstack-router-route-inventory.md`
- `260621-02-tanstack-router-navigation-and-route-state.md`
- `260621-03-tanstack-router-loaders-cache-and-module-boundaries.md`

Official documentation checked:

- https://tanstack.com/router/latest/docs/routing/file-based-routing
- https://tanstack.com/router/latest/docs/routing/code-based-routing
- https://tanstack.com/router/latest/docs/guide/navigation
- https://tanstack.com/router/latest/docs/guide/data-loading
- https://tanstack.com/router/latest/docs/faq

Relevant TanStack findings:

- File-based routing is the preferred path and most docs assume it.
- Code-based routing is supported through the same route tree concept.
- `routeTree.gen.ts` should be committed and treated as runtime source.
- Navigation uses shared `from`, `to`, `params`, `search`, `hash`, and `state` options.
- Loader/beforeLoad and cache behavior are central to TanStack Router apps.

## 2. Non-goals

- Do not introduce a production example app that requires installing `@tanstack/react-router` unless the repo already accepts new example dependencies.
- Do not add generated build output.
- Do not test TanStack Router's own runtime; test Modality extraction/model behavior.
- Do not add a marketing page or broad docs rewrite.

## 3. Current-State Findings

- Examples live under `examples/`.
- Conformance fixtures live under `test/conformance/fixtures/`.
- User-facing docs live under `docs/`; internal specs live under `docs/_specs/`.
- Architecture docs already describe routing through `NavigationAdapter` and built-in React Router/Next adapters.
- Existing commands:
  - `pnpm test`
  - `pnpm typecheck`
  - `pnpm architecture`
  - `pnpm ci:examples`
  - `pnpm phase7`
  - `pnpm fix`
- `docs/build/` exists but should not be edited by hand.

## 4. Existing Patterns to Follow

- Add focused fixtures near the subsystem under test rather than one giant integration fixture.
- Keep example app dependencies minimal.
- Update docs and specs alongside behavior changes.
- Preserve no-`dist/` and no-generated-artifact policy.
- Keep route examples small enough to make model state spaces understandable.

## 5. Atomic Implementation Steps

1. Add a minimal file-based TanStack Router extraction fixture.
   - Suggested location: `test/conformance/fixtures/tanstack-file-routing/app/` or `test/extraction/fixtures/tanstack-file-routing/` depending on existing fixture conventions.
   - Include:
     - `src/routes/__root.tsx`
     - `src/routes/index.tsx`
     - `src/routes/posts.tsx`
     - `src/routes/posts.$postId.tsx`
     - committed `src/routeTree.gen.ts` fixture if the adapter parses it
     - a small component with `useState`
     - `<Link to="/posts">`
     - `useNavigate({ from: "/posts" })` with `navigate({ to: "/posts/$postId", params: ... })`

2. Add a minimal code-based TanStack Router fixture.
   - Include `createRootRoute`, `createRoute`, `addChildren`, and `createRouter({ routeTree })`.
   - Include one pathless layout route and one dynamic route.
   - Include one imperative navigation and one Link.

3. Add a loader/beforeLoad/cache fixture.
   - Include a route `loader`.
   - Include a route `beforeLoad` with static redirect to `/login`.
   - Include server/helper imports that should not inflate client interaction extraction.
   - Include a client component that reads route data only if current support models it; otherwise keep the fixture focused on operation provenance and cache vars.

4. Add focused extraction tests for end-to-end behavior.
   - Use existing CLI/extraction test harnesses.
   - Verify route coverage includes TanStack routes.
   - Verify plugin provenance includes TanStack adapter/provider ids.
   - Verify `sys:route` enum contains UI routes and excludes layout-only routes.
   - Verify nav transitions are present and exact for static targets.
   - Verify loader/beforeLoad effect operations and cache vars appear when implemented.

5. Add replay-harness generation coverage.
   - Generate or inspect generated replay harness text to ensure TanStack observation provider wiring follows the generic registry path.
   - Do not require a live browser/TanStack runtime if current replay harness uses abstract providers.

6. Add docs updates.
   - `docs/architecture/navigation.md`: add TanStack Router to built-in adapters table with route model: file/code route tree, optional route-tree/search/cache vars.
   - `docs/architecture/state-sources.md`: mention TanStack Router under Navigation/capabilities if the table lists examples.
   - `docs/_specs/02-extraction.md`: include TanStack Router extraction semantics: file/code route discovery, loader/beforeLoad effect APIs, cache approximation, module boundaries.
   - README support matrix, if present, should mention TanStack Router support at the same level as React Router/Next.

7. Add user-facing guide if docs already have router setup guides.
   - Suggested `docs/guides/tanstack-router.md` only if there is a guide pattern to follow.
   - Include minimal extraction invocation and caveats:
     - commit `routeTree.gen.ts`
     - static route trees extract best
     - dynamic route construction may need config/overlay
     - loader/cache modeling is bounded and conservative

8. Update example CI if a real example app is added.
   - If adding `examples/tanstack-router-app`, include it in `tools/examples-ci.ts` only if dependencies are available and install cost is acceptable.
   - Otherwise keep TanStack coverage in tests/fixtures and avoid example CI churn.

9. Add trust-ledger regression tests.
   - Dynamic route target emits model-slack caveat.
   - Dynamic loader/cache key emits model-slack caveat.
   - Ambiguous component-to-route mapping emits warning or returns undefined without exact mount scope.

10. Run a final cross-router regression pass.
    - React Router support remains unchanged.
    - Next support remains unchanged.
    - TanStack support coexists with state sources (`use-state`, `jotai`, `swr`, `zustand`).

## 6. Tests to Add or Update

- Add tests under `test/extraction/` or `src/cli/features/extract/` for:
  - file-based TanStack extraction
  - code-based TanStack extraction
  - TanStack loader/beforeLoad effect operation provenance
  - TanStack route coverage report
  - TanStack route tree/pathless mountedness

- Add conformance fixture tests if existing conformance tooling can run them without installing TanStack runtime.

- Update:
  - `src/cli/features/extract/output` tests if route coverage/plugin labels change.
  - `test/modality/registry.test.ts` if user-facing registry output is asserted there.
  - `tools/examples-ci.ts` only if a new example app is added.

## 7. Verification

Run:

- `rtk pnpm test -- src/extract/sources/tanstack-router`
- `rtk pnpm test -- src/cli/features/extract`
- `rtk pnpm test -- test/extraction`
- `rtk pnpm test`
- `rtk pnpm typecheck`
- `rtk pnpm architecture`
- `rtk pnpm ci:examples`
- `rtk pnpm phase7`
- `rtk pnpm fix`

If full `pnpm test` or `pnpm phase7` is too slow locally, run the focused TanStack and router-related suites first, then report the skipped full command with the reason.

## 8. Acceptance Criteria

- A small TanStack file-based app can be extracted and checked with route inventory, route state, nav transitions, and local state scopes.
- A small TanStack code-based app can be extracted for static route trees.
- Loader/beforeLoad and cache behavior are visible in the model/report according to plan 3's scope.
- Route coverage reports modeled vs excluded TanStack routes clearly.
- Documentation describes supported TanStack patterns and conservative limitations.
- All focused TanStack tests pass.
- Existing React Router and Next suites pass.
- No generated docs build, `dist/`, or local env artifacts are committed.

## 9. Risks, Ambiguities, and Stop Conditions

- Stop and report if adding a real example app requires dependency churn that conflicts with repo policy; prefer fixtures.
- Stop and report if conformance tooling requires a live TanStack runtime that is not available in dev dependencies.
- Stop and report if docs would overstate dynamic code-based routing support; document static support and caveats honestly.
- Stop and report if full support requires a general URL-search-state abstraction larger than this router adapter work.
