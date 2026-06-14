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
