# State Explosion on Real App Check

## Summary

Running `modality check` on a realistic React Router app can exhaust the Node.js heap before producing a report. The TinyURL app extracted successfully, but checking the full model reached the V8 heap limit.

## Why This Matters

This blocks the intended workflow for larger apps: `extract` succeeds, but `check` cannot complete. It also makes it hard to distinguish a real property failure from a search-space scalability failure.

## Reproduction

Use the sibling TinyURL app:

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality extract
rtk pnpm exec modality check
```

The app had colocated `*.props.mjs` files under `app/routes/`. The full extraction completed with:

```text
extracted vars=45 transitions=46
plugins=router:router@0.1.0,state-source:use-state@0.1.0
model=.modality/model.json
appModel=.modality/app.model.ts
```

The check failed with:

```text
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command was killed with SIGABRT (Aborted): modality check
```

Checking only one props file still reproduced the issue:

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality check .modality/model.json app/routes/analytics.props.mjs
```

That command also reached the Node heap limit.

## Expected Behavior

The checker should either complete within reasonable memory for this model, or stop with a structured diagnostic that explains the explored-state count, frontier size, dominant variables, and suggested bounds/slicing changes.

## Observed Behavior

The process aborts with a raw V8 out-of-memory crash.

## Possible Fix Directions

- Add state-count/frontier-count progress reporting and a graceful memory guard.
- Improve slicing so checking one props file only explores transitions relevant to that file's `reads`.
- Add partial-order reduction or independence reduction for unrelated local UI state.
- Provide a per-route or per-source extraction/check mode that does not pull in the whole shared app shell.
- Make default bounds more conservative for extracted real apps, or auto-suggest lower bounds when the graph grows too quickly.

## Implemented Notes

The checker now addresses the main scalability path without rewriting search:

- `modality check` enables per-property slicing by default when every loaded property declares or infers `reads`. Properties without `reads` keep full-model search and the report records that slicing was skipped.
- Slicing uses the spec cone-of-influence rule: seed from property reads and `enabled(...)` transition vars, grow through transitions that **write** into the cone, and do not blindly include every `sys:*` variable.
- `alwaysStep` properties fall back to full-model search because reader-only transitions may be semantically relevant to step predicates.
- Structured diagnostics (`CheckResult.diagnostics` / `report.json` `diagnostics`) report slicing summaries, frontier/states/depth stats, optional dominant variables, and graceful search-limit stops (`maxStates`, `maxFrontier`, `maxEdges`, optional `memoryGuard`).
- CLI output adds compact `slicing=...` and `search-limit=...` lines when relevant; detailed per-depth stats remain in `report.json`.
- `modality check` now exposes `--max-states`, `--max-edges`, `--max-frontier`, `--memory-guard-mb`, and `--no-search-limits`, with conservative CLI defaults when no search-limit flags are provided.

Re-run the reproduction commands above after upgrading; a single props file should explore a much smaller slice, and configured limits should fail with a structured diagnostic instead of a raw V8 heap abort.
