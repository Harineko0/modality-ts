# Workflow And CLI

Use this reference for project setup, artifact flow, command selection, CI, and repo
validation.

## Adoption Loop

1. Create or locate a `*.props.ts` file beside each modeled component. Empty props files
   are valid target-registration signals.
2. Generate typed handles before writing properties that read local `useState` values:

```bash
npx modality init
npx modality generate
npx modality generate src/App.tsx
```

3. Write properties in the props file, importing component handles from sibling modules
   such as `./App.modals`.
4. Extract the model:

```bash
npx modality extract
npx modality extract src/App.tsx --effect-api api.placeOrder
npx modality extract src/App.tsx --report .modality/extraction-report.json
```

5. Check the model:

```bash
npx modality check
npx modality check .modality/model.json src/App.props.ts
```

6. Replay failures:

```bash
npx modality replay .modality/traces/<property>.violated.trace.json
npx modality replay .modality/traces/<property>.violated.trace.json --mode action --harness test/replay-harness.ts
```

## Commands

- `modality init`: create the default local workspace and starter files.
- `modality generate [source.tsx ...]`: write sibling `*.modals.ts` typed state and
  transition handles from source analysis. With no sources, targets are discovered from
  `*.props.ts` files.
- `modality extract [source.tsx ...]`: write `.modality/model.json` from React +
  TypeScript source. Important flags: `--out`, `--app-model`, `--report`, `--overlay`,
  `--config`, `--package-json`, `--disable-plugin`, repeatable `--effect-api`,
  `--expect-model`, `--explain-drift`.
- `modality check [model.json] [props.ts ...]`: evaluate properties. Important flags:
  `--report`, `--overlay`, `--traces`, `--replay-tests`,
  `--action-replay-tests`, `--states`, `--max-states`, `--max-edges`,
  `--max-frontier`, `--memory-guard-mb`, `--no-search-limits`, `--artifact`.
- `modality replay <trace.json>`: classify a counterexample as `reproduced`,
  `not-reproduced`, or `inconclusive`.
- `modality conform`: generate or replay random walks for proactive conformance.
- `modality export [model.json] --format tla --out .modality/model.tla`: export a
  conservative TLA+ model.
- `modality ci <model.json> [props.ts] --artifacts .modality`: write model, report,
  traces, conformance output, and baseline-comparison artifacts for automation.

## Artifact Reading Order

1. Props file: property intent, imports, and whether targets are registered.
2. Generated `*.modals.ts`: actual component-local state and transition handles available
   to property authors.
3. `.modality/model.json`: variable IDs, domains, transitions, bounds, labels, effects,
   and provenance.
4. Extraction/check reports: trust ledger, warnings, diagnostics, confidence, traces,
   and bound/search-limit details.
5. Trace JSON and generated replay tests: the shortest violating path and replayability
   blockers.

## CI Gating

Use `modality ci ... --artifacts .modality` for repeatable automation. Gate hard on:

- reproduced counterexamples;
- stale model hashes or overlay drift;
- new severe trust-ledger caveats such as global taints or unsound-risk caveats;
- new or changed model-slack caveats when the team is ratcheting model precision;
- conformance pass-rate drops.

Treat `not-reproduced` violations as model-maintenance work until the model is stable
enough to make them hard failures. Treat `inconclusive` replay as harness debt.

## Repository Validation

When changing this repository, prefer:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm fix
```

Run the checks that match the risk of the change. For docs/skill-only changes, at least
validate the skill metadata and inspect the diff.
