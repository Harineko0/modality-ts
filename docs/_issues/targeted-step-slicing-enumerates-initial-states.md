# Targeted Step Slicing Enumerates Initial States

## Summary

Targeted `alwaysStep` slicing can call full model initial-state generation while merely deciding whether a target transition guard is enabled initially. On real app models, this makes slice construction itself hang before Rust search starts.

This was observed on Coffee DX after the 0.0.25 to 0.0.27 updates. Slice construction printed the first 11 property slices quickly, then stalled on the first targeted `alwaysStep` property.

## Why This Matters

Slicing is supposed to reduce checker cost before search. If slicing invokes stabilized initial-state enumeration, focused step properties can become slower than full search and search limits cannot help because Rust search has not started yet.

## Reproduction

Use the Coffee DX customer home model and props:

```bash
cd /Users/hari/proj/modality-ts
rtk proxy pnpm exec tsx -e 'import { readFileSync } from "node:fs"; import { pathToFileURL } from "node:url"; import { performance } from "node:perf_hooks"; import { parseModelArtifact } from "./src/core/index.ts"; import { sliceModelForCheckProperty } from "./src/check/slicing/slice-model.ts"; (async()=>{ const model=parseModelArtifact(readFileSync("/Users/hari/proj/coffee-dx/apps/web/.modality/models/app/_customer/home.model.json","utf8")); const mod:any=await import(pathToFileURL("/Users/hari/proj/coffee-dx/apps/web/app/_customer/home.props.ts").href); const props=(mod.properties ?? mod.propertiesFor)(model); for (const p of props){ const t=performance.now(); const s=sliceModelForCheckProperty(model,p); console.log(JSON.stringify({property:p.name, ms:Math.round(performance.now()-t), vars:s.model.vars.length, transitions:s.model.transitions.length, mode:s.mode})); } })()'
```

Observed output reached:

```text
densityOneRequiresConnectedPrinter vars=21 transitions=20 mode=state
densitySevenDisabledWhenPrinterDisconnected vars=21 transitions=20 mode=state
loadMoreOrdersEnabledOnlyWithCursorAndIdleDialog vars=21 transitions=20 mode=state
```

Then the command stalled on the first `alwaysStep` property:

```text
autoPrintSwitchTogglesValue
```

Calling `modelInitialStates()` on the same full model did not return within 30s.

## Expected Behavior

Targeted step slicing should decide whether guard dependency expansion is needed without enumerating stabilized initial states for the full model.

## Observed Behavior

`computeTargetedStepSliceClosure()` calls `targetGuardEnabledAtInitial()` for each target transition. That helper calls `modelInitialStates(model).some(...)`. `modelInitialStates()` delegates to Rust initial-state generation, which compiles the model, normalizes mount locals, and stabilizes internal transitions.

Relevant code:

- `src/check/slicing/dependency-graph.ts`: `computeTargetedStepSliceClosure()`
- `src/check/slicing/dependency-graph.ts`: `targetGuardEnabledAtInitial()`
- `src/check/model-api.ts`: `modelInitialStates()`
- `crates/checker/src/search.rs`: `model_initial_states()`

## Possible Fix Directions

- Replace `targetGuardEnabledAtInitial()` with a syntactic or abstract guard check for the target transition.
- Evaluate guards only against declared initial values needed by the guard, without stabilization.
- Cache initial guard decisions per model and transition if exact evaluation remains necessary.
- Treat unknown guard-initial status conservatively and run dependency closure instead of enumerating initial states.
- Add a regression test where targeted `alwaysStep` slicing over a model with wide internal initial stabilization returns quickly.
