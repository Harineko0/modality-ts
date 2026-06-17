# Focused alwaysStep properties can still hit search limits

## Context

In the Meiwa tenant attribute settings model, three single-transition postcondition properties verify with `--no-search-limits` but error under the default-style edge budget.

Target app:

```text
~/proj/magica/curoco/frontend/tenant-meiwa
```

Property file:

```text
src/app/settings/attributes/AttributesSettingsPage.props.ts
```

Check command that errors:

```bash
npx modality check \
  .modality/models/settings-attributes/AttributesSettingsPage.model.json \
  src/app/settings/attributes/AttributesSettingsPage.props.ts \
  --report .modality/models/settings-attributes/check-report.json \
  --max-states 50000 \
  --max-edges 150000
```

Observed:

```text
cancelAlwaysClosesCreateForm error: search limit exceeded: maxEdges=150000
createDefinitionSubmitResetsDraft error: search limit exceeded: maxEdges=150000
optionAddSubmitResetsDraft error: search limit exceeded: maxEdges=150000
```

The same properties pass with:

```bash
npx modality check \
  .modality/models/settings-attributes/AttributesSettingsPage.model.json \
  src/app/settings/attributes/AttributesSettingsPage.props.ts \
  --report .modality/models/settings-attributes/check-report-unbounded.json \
  --no-search-limits
```

That run explored about 13.5k states and 260k edges.

## Expected

Properties that are explicitly scoped to one transition via both `stepTransitionId(...)` and `enabledTransitions: [...]` should slice to that transition and its direct read/write dependencies, or at least avoid exploring unrelated navigation/pending-operation combinations.

## Actual

The slice still includes a wide `sys:pending` domain and unrelated navigation/history behavior. The focused transition declarations did not reduce the reported edge count enough to avoid search-limit errors.

## Additional Ergonomics Note

Positive postcondition-style `alwaysStep` predicates produced confusing counterexamples on unrelated transitions during initial authoring. Rewriting them as negated bad-step predicates followed the pattern used by existing examples and produced the expected result. This may need clearer docs or stricter predicate validation.

## Implemented Notes

- Negated bad-step `alwaysStep` properties with a syntactic `stepTransitionId(...)` / `transitionId` in the step predicate use a **targeted edge slice** when per-property slicing is enabled. `enabledTransitions` alone does not trigger this mode, and positive targeted predicates stay full-model.
- Targeted slicing grows dependency vars with the usual backwards writer closure from property reads and target guard reads, then adds target transitions and execution vars. Target-transition writes such as enqueueing into `sys:pending` stay in the slice but do not recursively pull unrelated transitions that merely share those infrastructure writes.
- Untargeted `alwaysStep` and `leadsToWithin` still use full-model search. Slice grouping keys include both var and transition sets; `sliceSummaries` may report `mode: "targetedStep"`.
- Authoring guidance now recommends negated bad-step predicates for focused postconditions instead of positive target+post pairs.
