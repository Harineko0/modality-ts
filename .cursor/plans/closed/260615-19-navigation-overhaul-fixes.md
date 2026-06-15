# 260615 — Navigation Overhaul: Correctness Fixes

Fix plan for defects found reviewing the navigation-overhaul implementation against
`.cursor/plans/260615-navigation-overhaul-00-overview.md`. Audience: Cursor Composer 2.
**Minimal diffs. Keep the reduced-history design (Decision #3) and the framework-agnostic
abstraction. Do not re-architect.**

## 1. Goal

1. **(Critical)** Make reduced-`sys:history` models valid. `locationVars` emits a `sys:history`
   inner domain that is a strict subset of `sys:route`, but `validateModel` requires exact
   equality, so `checkModel` and TLA+ export reject the model. Relax the validator to accept a
   **subset**.
2. **(Soundness)** Restore navigation targets to the `sys:route` domain. `locationVars` currently
   drops `lowering.pushTargets` from the route domain whenever a manifest yields UI patterns, so a
   navigated route absent from the manifest becomes an out-of-domain `sys:route` value. Restore the
   union the original plan specified.
3. **(Regression test)** Add an end-to-end test that extracts a route-bound-push app **and runs
   `checkModel`/`validateModel` on the result** — the missing coverage that hid both defects.
4. **(Minor)** Remove dead `routeVars` / `navigationCall` members from `NavigationAdapter`; fix the
   `to`-attribute assumption in `isNavigationJsxTag`.

## 2. Non-goals / must NOT change

- Do **not** abandon or alter the history-reduction algorithm in `locationVars`
  (`pushOrigins ∪ pushTargets ∪ initial`, with `hasUnboundPush` → full domain). Only its
  *route-domain* line (goal #2) and the *validator* (goal #1) change.
- Do **not** change `schemaVersion`, `EffectIR`/label unions, `domainFingerprint`, the runtime
  navigation semantics (`src/check/runtime/navigation.ts`), the harness, redirect lowering
  (still `navigate`/`replace`), or route classification (`discover.ts`).
- Do **not** weaken any validator rule other than the single `sys:history`-inner check. In
  particular keep the `sys:route must use enum`, `sys:pending`, and navigate-target checks intact.
- Do **not** touch `examples/*` model artifacts by hand — regenerate via the existing flow if
  `ci:examples` requires it (see §10).

## 3. Current-state findings (verified)

- **Validator enforces equality.** `src/core/ir/validator.ts:160-166`
  (`validateSystemVarShapes`): `domainFingerprint(history.domain.inner) !== domainFingerprint(route.domain)`
  → pushes `"sys:history inner domain must match sys:route domain"`. `sameDomain` is pure
  fingerprint equality (`:957-959`).
- **Proven failure.** Running `validateModel` on a model whose `sys:history.inner` =
  `["/", "/signin"]` and `sys:route` = `["/", "/signin", "/links"]` returns
  `{"ok":false,"errors":["sys:history inner domain must match sys:route domain"]}`.
- **Validation runs in the hot paths.** `src/check/engine/check-model.ts:207-208`
  (`if (!validation.ok) return invalidModelResult(...)`) and
  `src/cli/features/export/command.ts:73,118`. Extraction itself does **not** validate, so
  `runExtractCommand` writes an invalid model that `check`/`export` later reject.
- **`locationVars` route domain drops push targets.** `src/extract/sources/router/routes.ts:16-20`:
  `uiPatterns.length > 0 ? [options.route, ...uiPatterns] : [options.route, ...lowering.pushTargets]`.
  The plan specified `uniqueRoutes([options.route, ...uiPatterns, ...lowering.pushTargets])`.
- **Navigate-target check is literal-blind.** `validator.ts:730-742` only fires when
  `inferExprDomain(effectNode.to)` is defined; `inferLiteralDomain` returns `undefined` for
  strings (`:861-864`). So goal #2 is a *latent* soundness bug (out-of-domain enum value reachable
  by the checker / enumerated in TLA+), **not** a hard validation error for literal targets. Fix it
  anyway for soundness + plan conformance.
- **Missing test coverage.** The reduction test `src/cli/features/extract/command.test.ts:503`
  only asserts `historyValues ⊆ routeValues`; it never calls `checkModel`/`validateModel`.
  `src/extract/sources/router/routes.test.ts:44` asserts a strict-subset history. No test runs a
  reduced model through the checker.
- **Dead interface surface.** `NavigationAdapter.routeVars` / `navigationCall` are **required**
  (`src/extract/engine/spi/index.ts:200-209`, tagged "removed after Phase 02"). They are NOT
  required by `validateRouterPlugin` (`src/cli/registry/index.ts:126-148`) and not called outside
  the router source (the engine uses its own `navigationCall` wrapper in
  `engine/ts/transition/navigation.ts:54` + `classifyNavigationCall`). The react-router adapter
  still wires them (`src/extract/sources/router/index.ts:45-47`) from legacy
  `routeVars` (`routes.ts:56-83`) / `navigationCall` (`router/navigation.ts`).
- **`isNavigationJsxTag` assumes `to`.** `engine/ts/transition/navigation.ts:118-126` probes
  `new Map([["to", ""]])`; used by `static-navigation.ts:48`. A Next-style `<Link href>` adapter is
  missed on the static-navigation path (the handler path uses real attrs, which is why the fit test
  passes).

## 4. Exact files & symbols

| Path | Symbol | Change |
| --- | --- | --- |
| `src/core/ir/validator.ts` | `validateSystemVarShapes` (`:147-178`) | equality → subset check for `sys:history` inner |
| `src/extract/sources/router/routes.ts` | `locationVars` (`:8-54`) | route domain = union incl. `pushTargets` |
| `src/extract/engine/navigation-adapter-fit.test.ts` | `fitLocationVars` (`:12-56`) | mirror the union |
| `src/cli/features/extract/command.test.ts` | new test | extract → `validateModel`/`checkModel` |
| `src/extract/engine/spi/index.ts` | `NavigationAdapter` (`:169-210`) | drop `routeVars`/`navigationCall` members |
| `src/extract/sources/router/index.ts` | `reactRouterAdapter` (`:20-49`) | stop wiring the dropped members |
| `src/extract/sources/router/routes.ts` | legacy `routeVars` (`:56-83`) | remove if unreferenced |
| `src/extract/sources/router/navigation.ts` | legacy `navigationCall` | remove if unreferenced |
| `src/extract/engine/ts/transition/navigation.ts` | `isNavigationJsxTag` (`:118-126`) | don't hardcode `to` |

## 5. Existing patterns to follow

- Validator error style: one `errors.push("…")` per rule in `validateSystemVarShapes`; reuse the
  enum `values` arrays already present on `route.domain`/`history.domain.inner`.
- `uniqueRoutes` helper already in `routes.ts:93-95`; `clampToRouteDomain` (`:85-91`) stays as the
  safety net (it becomes a no-op once the union holds).
- Test scaffolding: `mkdtemp(join(tmpdir(), "modality-extract-…"))` + `runExtractCommand({ sourcePath: dir, modelPath })`,
  and `checkModel(result.model, [reachable(...)])` as in `command.test.ts:389-395`.

## 6. Atomic implementation steps

### Step 1 — Relax the validator (critical)
In `src/core/ir/validator.ts`, `validateSystemVarShapes`, replace the `else if` equality branch
(`:160-166`) with a subset check:
```ts
} else if (route) {
  const inner = history.domain.inner;
  const within =
    inner.kind === "enum" && route.domain.kind === "enum"
      ? inner.values.every((v) => route.domain.values.includes(v))
      : domainFingerprint(inner) === domainFingerprint(route.domain);
  if (!within)
    errors.push("sys:history inner domain must be a subset of sys:route domain");
}
```
(Equal domains remain valid; only strict supersets/foreign values now error.) Grep tests for the
old message string `"sys:history inner domain must match"` and update them to the new wording.

### Step 2 — Restore the route-domain union (soundness)
In `src/extract/sources/router/routes.ts` `locationVars`, replace the conditional `routeValues`
(`:16-20`) with:
```ts
const routeValues = uniqueRoutes([
  options.route,
  ...uiPatterns,
  ...lowering.pushTargets,
]);
```
Leave the `historyRoutes` computation and `clampToRouteDomain` unchanged.

### Step 3 — Mirror the union in the fit test helper
In `src/extract/engine/navigation-adapter-fit.test.ts`, update `fitLocationVars`
(`:20-26`) to the same union so the test exercises the real shape (not the old flawed branch).

### Step 4 — End-to-end regression test (the missing coverage)
Add a test to `src/cli/features/extract/command.test.ts` that reuses the route-bound-push fixture
shape from `:503-545` (manifest with `/`, `/links`, `/signin`; `home.tsx` has
`<Link to="/signin">`), then:
- `expect(validateModel(result.model).ok).toBe(true);` (import `validateModel` from `modality-ts/core`).
- `const check = checkModel(result.model, [reachable(result.model, s => s["sys:route"] === "/signin", { name: "signinReachable", reads: ["sys:route"] })]);`
  and assert `check.verdicts[0]?.status` is **not** `"error"` (i.e., the model was actually checked,
  not short-circuited by `invalidModelResult`).
- Assert every navigate `to` literal across `result.model.transitions` is a member of the
  `sys:route` enum values (guards goal #2 directly).

### Step 5 — Remove dead interface members (minor cleanup)
1. Grep first: `rg "\.routeVars\b|\.navigationCall\b" src` — confirm no consumer outside
   `src/extract/sources/router/*` and the fit test. **If any other consumer exists, STOP** and
   report instead of removing.
2. Delete `routeVars` and `navigationCall` from `NavigationAdapter`
   (`spi/index.ts:200-209`).
3. Remove their wiring from `reactRouterAdapter` (`index.ts:45-47`), the legacy `routeVars`
   (`routes.ts:56-83`) and legacy `navigationCall` (`router/navigation.ts`) **if now unreferenced**
   (the discover/route unit tests may import them — update or delete those assertions).
4. Remove the `routeVars`/`navigationCall` members from the fake adapters in
   `navigation-adapter-fit.test.ts:110-111` and any test fixture adapter.

### Step 6 — Fix `isNavigationJsxTag` attribute assumption (minor)
In `engine/ts/transition/navigation.ts:118-126`, probe a representative set of target attributes
instead of only `to`, e.g. try `["to", "href"]`:
```ts
export function isNavigationJsxTag(adapter: NavigationAdapter | undefined, tag: string): boolean {
  if (!adapter?.classifyNavigationJsx) return false;
  return ["to", "href"].some(
    (attr) => adapter.classifyNavigationJsx!(tag, new Map([[attr, ""]])) !== "unsupported",
  );
}
```
(Keeps react-router working; lets a Next-style `href` adapter be recognized on the static path.)

### Step 7 — (Optional) report unmodeled redirect targets
`src/extract/sources/router/redirects.ts:21` silently skips redirects whose target isn't modeled.
If low-risk, surface these in the route-coverage report (a `redirect-only` entry whose `reason`
notes the unmodeled target) so the drop is visible. **Skip if it complicates the diff.**

## 7. Per-step file map

- Step 1: `src/core/ir/validator.ts` (+ any test asserting the old message)
- Step 2: `src/extract/sources/router/routes.ts`
- Step 3: `src/extract/engine/navigation-adapter-fit.test.ts`
- Step 4: `src/cli/features/extract/command.test.ts`
- Step 5: `src/extract/engine/spi/index.ts`, `src/extract/sources/router/index.ts`,
  `src/extract/sources/router/routes.ts`, `src/extract/sources/router/navigation.ts`,
  `navigation-adapter-fit.test.ts`, router unit tests
- Step 6: `src/extract/engine/ts/transition/navigation.ts`
- Step 7 (optional): `src/extract/sources/router/redirects.ts`, `src/cli/features/extract/command.ts`

## 8. Acceptance criteria

- A model with `sys:history.inner` ⊊ `sys:route` passes `validateModel` (`ok: true`); a model whose
  history inner contains a value **not** in `sys:route` still fails with the new subset message.
- `checkModel` on an extracted route-bound-push app returns real verdicts (no `invalidModelResult`),
  and `modality export` succeeds on it.
- Every navigate `to` literal in an extracted model is a member of the `sys:route` enum.
- `NavigationAdapter` no longer declares `routeVars`/`navigationCall`; `pnpm typecheck` passes and
  no code references them.
- `pnpm test`, `pnpm architecture`, `pnpm phase7`, `pnpm ci:examples` all pass.

## 9. Tests to add/update

- New e2e test (Step 4) — the primary guard.
- Update `routes.test.ts` / `discover.test.ts` for any removed legacy exports (Step 5) and for the
  route-domain union if they asserted the old behavior.
- Update any test asserting the old validator message (Step 1).
- Add a `validateModel` subset test (unit): equal domains ok; strict subset ok; foreign value errors.

## 10. Verification commands

```bash
rtk pnpm typecheck
rtk pnpm exec vitest run src/core src/extract/sources/router src/extract/engine src/cli/features/extract
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm ci:examples   # likely FAILING before this plan (reduced-history models rejected); must pass after
rtk pnpm fix
```

## 11. Risks, ambiguities, stop conditions

- **Intended deviation from the overview.** The overview said "keep check-side untouched"; Step 1
  necessarily edits `src/core/ir/validator.ts`. This is the corrected decision — the original plan
  under-specified the validator invariant. Touch **only** the `sys:history` inner rule.
- **Soundness of subset history.** Relaxing to subset is safe only because `locationVars` derives
  the subset from push origins/targets with a `hasUnboundPush` → full-domain fallback. Do not
  loosen the validator further (e.g., to allow history values outside the route domain). If you
  find a path where the runtime pushes a route not in `history.inner`, **STOP & ASK** — that is a
  lowering bug, not a validator bug.
- **Step 5 removals.** Only remove the deprecated members if the grep in Step 5.1 finds no external
  consumer. If `validateRouterPlugin` or any plugin author contract depends on them, **STOP**.
- **`ci:examples` / `phase7` baselines.** If these legitimately changed (route-domain union may add
  values for apps that navigate outside the manifest), regenerate baselines via the established
  flow — do not hand-edit committed model artifacts. If a regenerated example blows past check
  bounds, **STOP & ASK** rather than bumping bounds.
- **Do not** revert the history reduction to "full domain always" as a shortcut for Step 1 — that
  discards Decision #3 and the whole point of the reduction.
