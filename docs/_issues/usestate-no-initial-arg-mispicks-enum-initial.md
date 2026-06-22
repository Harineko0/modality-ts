# `useState<T>()` with no initial argument mis-picks the enum initial (unsound initial state)

## Summary

When a component calls `useState<T>()` with **no initial argument**, the runtime
initial value is `undefined`. Extraction drops the `undefined` member from the
type-derived domain and silently picks the **first remaining union member** as the
model's `initial`. The resulting model starts in a state the real component can
never be in at mount, which is a soundness problem: invariants about the initial
state are verified against the wrong starting point.

This was found on Supabase Studio's `RestartServerButton`, where the
restart-confirmation modal's visibility is driven by
`serviceToRestart === undefined`. The model instead starts with
`serviceToRestart = "database"`, i.e. it believes the destructive "Restart
database" confirmation dialog is **already open at mount**.

## Reproduction

```bash
cd /Users/hari/proj/supabase/apps/studio
npx modality extract \
  components/interfaces/Settings/General/Infrastructure/RestartServerButton.tsx \
  --out .modality/restart-server.model.json
node -e 'const m=require(process.cwd()+"/.modality/restart-server.model.json");
const v=m.vars.find(x=>x.id.includes("serviceToRestart"));
console.log(JSON.stringify({domain:v.domain, initial:v.initial}))'
```

Source shape:

```ts
// initial value is undefined
const [serviceToRestart, setServiceToRestart] =
  useState<'project' | 'database'>()
// ...
<ConfirmationModal visible={serviceToRestart !== undefined} ... />
```

## Observed

```json
{ "domain": { "kind": "enum", "values": ["database", "project"] }, "initial": "database" }
```

- The `undefined` initial member is gone from the domain.
- `initial` is `"database"` — the first enum member — not a representation of
  `undefined`.
- No caveat / taint / warning is emitted about the dropped initial.

## Expected

One of:

- Model the no-arg `useState<T>()` initial as a distinct `undefined`/absent member
  of the domain (and use it as `initial`), so `x !== undefined` guards are
  faithful; or
- At minimum, emit an extraction caveat/taint flagging that the declared initial
  was `undefined` and a domain member was substituted, so downstream invariants
  are not silently checked against a fabricated start state.

## Impact

- Any `value === undefined` / `value !== undefined` gating (modals, "no selection
  yet", optional state) is mis-modeled.
- `reachable(...)` witnesses and `always(...)` invariants about the initial state
  pass or fail against a state the component can never start in — false
  assurance in both directions.

## Workaround

A domain-refinement overlay restores a faithful initial:

```ts
overlay().refineDomain(
  'local:RestartServerButton.serviceToRestart',
  { kind: 'enum', values: ['none', 'database', 'project'] },
  { initial: 'none' }
)
```

(Requires explicit `--overlay`; see the discovery-mode overlay issue.)

## Environment

- `modality-ts@^0.0.34`
- App: Supabase Studio (`~/proj/supabase`, `apps/studio`), Next.js pages router,
  React 19.
