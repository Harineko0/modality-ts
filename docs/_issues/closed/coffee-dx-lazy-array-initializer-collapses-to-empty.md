# Coffee DX lazy array initializer collapses to empty length category

## Summary

`app/_drip2/home.tsx` initializes `laneSlots` with three entries:

```ts
const [laneSlots, setLaneSlots] = useState<LaneSlot[]>(() =>
  Array.from({ length: LANE_COUNT }, buildIdleSlot),
);
```

The extracted model gives `local:DripHome.laneSlots` a `lengthCat` domain but initializes it to `"0"` instead of `"many"`.

## Reproduction

```bash
cd /Users/hari/proj/coffee-dx/apps/web
pnpm exec modality extract app/_drip2/home.tsx \
  --out .modality/probe-drip2.model.json \
  --app-model .modality/probe-drip2.app.model.ts
```

Observed generated app model:

```ts
"local:DripHome.laneSlots": "0" | "1" | "many";
// initialState contains:
"local:DripHome.laneSlots": "0"
```

## Impact

Properties for the physical three-lane drip UI become misleading. The model starts from an impossible empty-lane-list state, and a reachability check for `"many"` is vacuous.

## Expected capability

The extractor should evaluate common lazy initializers such as `Array.from({ length: CONST }, factory)` when the length is statically finite, or report a caveat when the initializer cannot be represented exactly.
