# Drip2 discovered-model property fixes (Coffee DX)

After `enabledTransitionPrefix` lands in `modality-ts`, update
`/Users/hari/proj/coffee-dx/apps/web/app/_drip2/home.props.mjs`:

1. **`drip2LaneSlotsRemainEmptyInExtractedModel`** — the source initializes a fixed
   lane inventory (`Array.from({ length: LANE_COUNT }, buildIdleSlot)`), so the extracted
   `lengthCat` initial is `"many"`, not `"0"`. Rename or rewrite to assert the fixed
   inventory, e.g. `eq(readVar("local:DripHome.laneSlots"), lit("many"))` with name
   `drip2LaneSlotsRemainFixedInExtractedModel`.

2. **`drip2TimerResetAlwaysEnabled`** — replace `enabled(model, resetTimer)` with
   `enabledTransitionPrefix(model, "LaneTimer.onClick.draftSec")` because the discovered
   model only has suffixed ids (`…gpspae`, `…1ku31x`, `…e4lq40`, `…1sxiol`).

Re-run:

```bash
cd /Users/hari/proj/coffee-dx/apps/web
rtk pnpm exec modality check .modality/models/app/_drip2/home.model.json app/_drip2/home.props.mjs \
  --max-states 50000 --max-edges 150000
```
