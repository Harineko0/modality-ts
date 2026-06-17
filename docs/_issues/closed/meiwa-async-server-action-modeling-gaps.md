# Meiwa async server-action flows need sharper modeling

## Status

Most generic gaps called out for Meiwa-style Next server-action and settings flows are now covered by shared extractor improvements. Residual limitations are listed below.

## Resolved (generic extractor)

- Async handlers can await modeled effect APIs in `const result = await api.action(...)` form inside `try/catch/finally`, with continuation assignments driven by `asyncOutcomes` or `readOpArg` outcome keys.
- Nested finite string-literal unions inside response records are preserved during semantic domain inference instead of collapsing to opaque tokens.
- Pre-await guard returns (empty prompt/label, stale-result checks after await) apply to async `.start` transitions or continuation `if` effects using existing guard parsing.
- `window.confirm` / `confirm` early-return patterns produce accepted enqueue paths plus a `.declined` user transition with no enqueue.
- Simple drag/drop handlers (`onDragStart`, `onDragOver`, `onDrop`, `onDragEnd`) with direct modeled setters extract transitions instead of `no-extractable-effect`.
- Submit guards combine disabled submit buttons, required empty-value inputs, and handler early returns.
- Imported Next server actions canonicalize to a single `ACTION …#name` pending op id (friendly import aliases map to the discovered action id).

## Residual / intentionally deferred

- Exact drag/drop list permutation is still bounded-list havoc unless indices are statically known; Meiwa definition reorder properties may remain over-approximated.
- `asyncOutcomes` must be supplied (or inferred later) for exact continuation payload literals when TypeScript result types are unavailable to the skeleton extractor.
- `useEffect` cleanup and other Meiwa settings-page effect hooks called out in the original report are outside this generic handler/async scope.
- `lineAccountChangeClearsConsultState_bug` and related alwaysStep slicing issues are tracked separately.

## Original context

While adding `*.props.ts` files under tenant Meiwa pages (`FreeConsultPage`, `AttributesSettingsPage`), extraction initially reported `awaited-effect-in-block`, tokenized nested statuses, missing confirm/drag/drop modeling, empty-label submits, and duplicate server-action pending op ids. The generic fixes above target those root causes without Meiwa-specific overlays.
