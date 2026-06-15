# Unextractable Handlers Cause Broad Over-Approximation

## Summary

Extraction on the TinyURL app reported many `unextractableHandlers`. Several resulting transitions used `havoc`, which broadens the model and can both inflate the state space and produce counterexamples that are artifacts of imprecision.

## Why This Matters

Over-approximation is useful for bug finding, but a large number of havoc transitions makes results harder to trust. It also appears to contribute to state explosion because unrelated variables can take many combinations.

## Reproduction

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk pnpm exec modality extract
rtk node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(".modality/model.json","utf8")); console.log(m.metadata.extractionCaveats.unextractableHandlers.map(h=>h.id).join("\n"))'
```

Representative handlers reported as unextractable included:

```text
AnalyticsDateButton.onChange
AnalyticsFilterButton.onPick
AnalyticsFilterButton.onToggle
CreateLinkDialog.onOpenChange
CreateLinkForm.onBlur
CreateLinkForm.onChange
EditLink.onChange
EditLink.onDiscard
TagCombobox.onClick
Tags.onClose
Tags.onDelete
Tags.onDone
UserMenu.onSelect
```

Representative havoc transitions can be listed with:

```bash
cd /Users/hari/proj/gdgjp/tinyurl
rtk node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(".modality/model.json","utf8")); for (const t of m.transitions) if (JSON.stringify(t.effect).includes("\"havoc\"")) console.log(t.id, "writes=", (t.writes||[]).join(","));'
```

Examples observed included:

```text
AnalyticsFilterButton.onOpenChange.open_pickedDim_query.seq.gfnk51 writes= local:AnalyticsFilterButton.open,local:AnalyticsFilterButton.pickedDim,local:AnalyticsFilterButton.query
TabbedBarCard.onClick.active.unrepresentable writes= local:TabbedBarCard.active
CreateLinkForm.onClick.slug.unrepresentable writes= local:CreateLinkForm.slug
ShareForm.onValueChange.principalType.unrepresentable writes= local:ShareForm.principalType
```

## Expected Behavior

The extraction report should make it easy to understand why each handler was unextractable, which syntax pattern caused the fallback, and whether the fallback is likely to affect checked properties.

## Observed Behavior

The report names the handler but uses generic reasons such as `Unextractable handler ...`. The checker then treats some affected transitions as broad havoc writes.

## Possible Fix Directions

- Include specific unsupported AST patterns in each caveat.
- Attach source spans for the exact expression that forced over-approximation.
- Classify over-approximations by severity, such as "safe local toggle", "domain-wide havoc", or "cross-property relevant".
- Teach extraction more common React handler shapes: callback props, `onOpenChange`, setter forwarding, and small helper functions.
- Let property checks fail fast or warn when a property reads a variable written by a havoc transition.
