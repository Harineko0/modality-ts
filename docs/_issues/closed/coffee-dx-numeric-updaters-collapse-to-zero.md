# Coffee DX numeric updaters collapse to zero

## Summary

In `app/_drip2/home.tsx`, timer controls from `LaneTimer` are extracted, but `local:LaneTimer.draftSec` receives a bounded integer domain with `min: 0` and `max: 0`. Increment buttons are then represented as unrepresentable havoc writes over a one-value domain, so `+10秒`, `+1分`, and `+3分` cannot change the modeled timer value.

## Reproduction

```bash
cd /Users/hari/proj/coffee-dx/apps/web
pnpm exec modality extract app/_drip2/home.tsx \
  --out .modality/probe-drip2.model.json \
  --report .modality/probe-drip2.extraction-report.json
```

Observed variable:

```json
{
  "id": "local:LaneTimer.draftSec",
  "domain": { "kind": "boundedInt", "min": 0, "max": 0 }
}
```

Observed increment handlers:

- `LaneTimer.onClick.draftSec.unrepresentable.gpspae`
- `LaneTimer.onClick.draftSec.unrepresentable.1ku31x`
- `LaneTimer.onClick.draftSec.unrepresentable.e4lq40`

## Impact

Timer properties cannot be expressed meaningfully:

- increment buttons should increase draft seconds;
- reset should return draft seconds to zero;
- submitting a positive timer should pass a positive `targetDurationSec`.

## Expected capability

Numeric updater inference should derive a finite bounded domain from literal increments and clamps, or provide a concise overlay/config refinement path for route-local numeric state.
