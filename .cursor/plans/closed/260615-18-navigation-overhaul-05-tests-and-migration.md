# 260615 — Navigation Overhaul · Phase 05: Tests, Golden Migration, Framework-Fit

Prereq: Phases 00–04. This phase makes the whole suite green again after the intended model
change, proves framework-agnosticism with a second adapter, and regenerates goldens/baselines.

## Goal

- Update/extend unit + integration tests for the new navigation model.
- Regenerate model/report/example/phase7 baselines that legitimately changed.
- Add a Next.js-style **interface-fit** test (fake adapter) — no production Next adapter.
- Confirm architecture boundaries and formatting.

## Non-goals

- No new behavior. No production Next.js adapter.
- Do not "fix" red goldens by editing source to match a stale snapshot — regenerate the snapshot
  only when the new output is *correct per Phases 02–04*.

## Current-state findings

- Extract integration tests: `src/cli/features/extract/command.test.ts` — asserts `sys:route`
  domains (e.g. `:378-379`, `:1399-1400`), transition id lists (`:1410-1424`), `result.lines`
  (`:37-39`), `coverage` (`:171`, `:282`). Several will change.
- Snapshots / expected models: tests using `--expect-model` / `assertMatchesExpectedModel`
  (`command.ts:801-815`) and example fixtures under `examples/` (`app.model`/expected json).
- Differential/parity: `pnpm phase7`, example checks: `pnpm ci:examples`.
- Engine nav tests under `src/extract/engine/**` (updated in Phase 03) — re-verify.

## Atomic steps

1. **Extract command tests** (`command.test.ts`): add cases for (a) file/props-mode manifest
   discovery → all UI routes in `sys:route`; (b) `resource` route excluded + present in
   `report.routeCoverage` with `classification:"api"`; (c) redirect-only route → one auto
   `replace` transition to its target; (d) reduced `sys:history` inner domain ⊆ `sys:route`;
   (e) `routes configured=… modeled=…` line present with a manifest, absent without one; keep the
   `lines[0]` assertion. Update the existing directory test (`:1236`) expectations to the new
   `sys:route`/history/transition output.
2. **Adapter unit tests** (if not already complete in Phase 02): redirect literal vs non-literal,
   `routeForComponent` resolution + ambiguity → `undefined`, history reduction + unbound-push
   fallback + subset invariant.
3. **Next.js interface-fit test** (new, e.g. `src/extract/engine/navigation-adapter-fit.test.ts`):
   define a minimal fake adapter implementing `NavigationAdapter` for Next-style primitives
   (`useRouter().push/replace/back`, `redirect()`, `<Link href>`, FS-style inventory). Run the
   engine + lowering against a small fixture and assert it produces a sensible model — **proving
   the engine carries no react-router assumptions.** Do not ship a real Next adapter.
4. **Regenerate expected models / example fixtures**: re-run extraction for `examples/*` and
   update committed `app.model`/expected-model artifacts; run `rtk pnpm ci:examples` and fix
   genuine breakages (not by reverting behavior).
5. **Regenerate phase7 baselines**: `rtk pnpm phase7`; review the diff for checker-semantics /
   TLA+ parity. Since the IR is unchanged (decision #2), parity should differ only by the new
   route/history/redirect content — confirm no unexpected semantic drift; update baselines.
6. **Architecture + format**: `rtk pnpm architecture` (dependency-cruiser) — ensure the new
   `discover.ts`/`redirects.ts` modules and CLI→adapter imports respect layering; `rtk pnpm fix`.
7. **Full green**: `rtk pnpm test`. Triage any remaining failures against Phases 02–04 intent.

## Acceptance criteria

- `rtk pnpm test`, `rtk pnpm architecture`, `rtk pnpm phase7`, `rtk pnpm ci:examples` all pass.
- The Next.js-style fit test passes, demonstrating a second adapter drives the same engine.
- The TinyURL global acceptance (overview §"Global acceptance criteria") holds end-to-end.

## Verification

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm ci:examples
rtk pnpm fix
```

## Risks / stop conditions

- **STOP & REPORT** if `phase7` shows checker-semantic drift beyond the route/history/redirect
  content (e.g. unrelated transitions changing) — that means a Phase 03/04 change leaked beyond
  navigation; investigate before updating baselines.
- If an example app's state space grows beyond check bounds after including all UI routes, verify
  the `sys:history` reduction is actually applied (it is the primary blowup control); if growth
  persists, **STOP & ASK** whether to lower `maxHistory` for that example rather than silently
  bumping bounds.
- Do not commit regenerated `dist/` or any non-fixture artifacts.
