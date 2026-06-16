# Coffee DX imported interactions are not modeled

## Summary

While adding `*.props.ts` files for `/Users/hari/proj/coffee-dx/apps/web`, explicit extraction of `app/_customer/home.tsx` did not model the imported `MenuItemCard` add/remove handlers as transitions that mutate `local:CustomerHome.cart`.

This makes core customer-order properties impossible to write honestly. The model can reach `phase === "confirm"` through the parent click handlers, but `cart` never becomes non-empty, so properties about "confirm only after selecting an item" or "close complete clears the selected items" are either vacuous or reason over an impossible state.

## Reproduction

```bash
cd /Users/hari/proj/coffee-dx/apps/web
pnpm exec modality extract app/_customer/home.tsx \
  --out .modality/probe-customer.model.json \
  --app-model .modality/probe-customer.app.model.ts \
  --report .modality/probe-customer.extraction-report.json
```

Observed transition list includes `CustomerHome.onClick.isFree_phase...` and dialog/settings handlers, but no `MenuItemCard` transition writing `local:CustomerHome.cart`.

## Impact

This blocks properties for the primary customer flow:

- selecting menu items increases cart quantity;
- removing the last quantity deletes the cart line;
- confirm is reachable only with a non-empty cart;
- completed order close clears cart and completion metadata.

## Expected capability

The extractor should connect imported child component event handlers back to parent state setter props when the parent passes callbacks such as `onAdd={() => handleAdd(item)}` and `onRemove={() => handleRemove(item.id)}`.
