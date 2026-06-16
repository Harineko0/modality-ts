# Search Limits Do Not Prevent OOM

## Summary

`modality check` can still exhaust the Node.js heap before producing a structured search-limit diagnostic, even when explicit `--max-states`, `--max-edges`, and `--max-frontier` limits are provided.

## Why This Matters

Search limits are the main escape hatch when a real app model grows too quickly. If the checker allocates enough intermediate state before honoring those limits, users still get a raw V8 crash instead of a useful report with explored counts, dominant variables, and suggested bounds.

## Reproduction

Use the sibling GDGJP wiki app after extracting the ingest route:

```bash
cd /Users/hari/proj/gdgjp/wiki
rtk node /Users/hari/proj/modality-ts/dist/cli/cli.js extract 'app/routes/ingest.$sessionId.tsx' \
  --out .modality/ingest-session.model.json \
  --app-model .modality/ingest-session.model.ts \
  --report .modality/ingest-session.extraction-report.json
rtk node /Users/hari/proj/modality-ts/dist/cli/cli.js check .modality/ingest-session.model.json \
  'app/routes/ingest.$sessionId.props.ts' \
  --report .modality/ingest-session.report.json \
  --max-states 20000 \
  --max-edges 80000 \
  --max-frontier 20000
```

Observed failure:

```text
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
process terminated by signal 6
```

The same model also OOMed without explicit limits. The extracted model reported:

```text
state-space≈47.2bits top:sys:pending(24.8),sys:route(4.7),sys:history(2.3)
```

## Expected Behavior

The checker should stop before heap exhaustion and emit a normal report indicating which limit was hit, current frontier size, stored state count, edge count, depth, and dominant variables.

## Observed Behavior

The process reached the V8 heap limit and aborted before writing a useful bounded-search diagnostic.

## Possible Fix Directions

- Check state, edge, frontier, and memory guards before constructing large successor arrays.
- Avoid `flatMap` or whole-layer materialization on hot paths where limits can be checked incrementally.
- Add a lower default `--memory-guard-mb` for CLI runs.
- Emit periodic progress diagnostics while exploring large slices.
- Add a regression test with a synthetic large `sys:pending` domain that verifies limits return a structured result instead of crashing.
