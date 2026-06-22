# Discovery-mode `extract`/`check` silently ignore sibling overlays and `--effect-api`, degrading models

## Summary

The documented no-argument "discovery" flow (`modality extract` / `modality
check` with no sources, which discovers targets via `*.props.ts` and writes
`.modality/models/**`) does **not** apply sibling `*.overlay.ts` files and does
**not** carry effect-API registrations. Overlays are only applied via an explicit
`--overlay <path>` flag (`src/cli/overlay.ts` `loadAndApplyOverlay` is only
reached when `overlayPath` is set), and effect APIs only via `--effect-api` on an
explicit per-source `extract`. The discovery flow emits no warning that a
co-located overlay or effect configuration was ignored, so models silently
degrade.

## Reproduction

```bash
cd /Users/hari/proj/supabase/apps/studio

# A sibling overlay refining the domain exists next to the props/source:
#   RestartServerButton.overlay.ts  -> serviceToRestart enum ['none','database','project'], initial 'none'
#   ApiAuthorization.Valid.overlay.ts -> approvalState enum ['indeterminate','approving','declining']

# Discovery mode (no sources): overlay + effect-api NOT applied
npx modality extract
node -e 'const f=process.cwd()+"/.modality/models/components/interfaces/Settings/General/Infrastructure/RestartServerButton.model.json";
const v=require(f).vars.find(x=>x.id.includes("serviceToRestart"));
console.log("discovery:",JSON.stringify(v.domain),"initial=",v.initial)'

# Explicit mode with --overlay: applied correctly
npx modality extract \
  components/interfaces/Settings/General/Infrastructure/RestartServerButton.tsx \
  --overlay components/interfaces/Settings/General/Infrastructure/RestartServerButton.overlay.ts \
  --out .modality/models/components/interfaces/Settings/General/Infrastructure/RestartServerButton.model.json
node -e 'const f=process.cwd()+"/.modality/models/components/interfaces/Settings/General/Infrastructure/RestartServerButton.model.json";
const v=require(f).vars.find(x=>x.id.includes("serviceToRestart"));
console.log("explicit :",JSON.stringify(v.domain),"initial=",v.initial)'
```

## Observed

```text
discovery: {"kind":"enum","values":["database","project"]} initial= database
explicit : {"kind":"enum","values":["none","database","project"]} initial= none
```

For `ApiAuthorization.Valid`, discovery mode degraded `approvalState` all the way
to an opaque token domain:

```text
discovery: {"count":1,"kind":"tokens"} initial= "tok1"
explicit (--overlay): {"kind":"enum","values":["indeterminate","approving","declining"]} initial= "indeterminate"
```

The token degradation also flipped a previously-passing invariant
(`approvalStateIsOneOfKnownSubmittingStates`) to `violated` at the initial state,
purely as an artifact of the ignored overlay.

No warning was printed in either run indicating the sibling overlay was skipped.

## Expected

- Discovery mode should auto-discover and apply a sibling `*.overlay.ts` (matching
  the props/source base name), the same way it discovers `*.props.ts`; or
- If auto-application is intentionally opt-in, the run should emit a clear warning
  like `found sibling overlay X.overlay.ts but no --overlay was passed; ignoring`,
  and similarly note that effect-API config is not applied in discovery mode.
- Effect-API registration usable by discovery mode (e.g. from `modality.config.ts`
  or a sibling file), so the discovery and explicit flows produce the same model.

## Impact

The documented "create `*.props.ts`, run `modality extract` / `modality check`"
workflow produces under-refined models (coarse/token domains, wrong initials,
missing pending ops) that differ from the explicit flow, with no signal to the
user. This silently weakens or invalidates every property checked in discovery
mode.

## Environment

- `modality-ts@^0.0.34`
- App: Supabase Studio (`apps/studio`).
