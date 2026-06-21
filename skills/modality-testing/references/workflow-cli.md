# Workflow And CLI

Use this reference for project setup, artifact flow, command selection, CI,
conformance, export, and repo validation.

## Quickstart Order

1. Initialize:

```bash
npx modality init
```

2. Create empty `*.props.ts` files beside modeled components. They register the
   `*.tsx` targets before properties are written.
3. Generate typed handles:

```bash
npx modality generate
npx modality generate src/App.tsx
```

4. Write properties in the props file, importing from sibling generated modules such
   as `./App.modals`.
5. Extract:

```bash
npx modality extract
npx modality extract src/App.tsx --effect-api api.placeOrder
npx modality extract src/App.tsx --report .modality/extraction-report.json
```

6. Check:

```bash
npx modality check
npx modality check .modality/model.json src/App.props.ts
```

7. Replay violations:

```bash
npx modality replay .modality/traces/<property>.violated.trace.json
npx modality replay <trace.json> --mode action --harness test/replay-harness.ts
```

## Commands

- `modality init`: create the local `.modality/` workspace and starter files.
- `modality generate [source.tsx ...]`: write sibling `*.modals.ts` typed handles
  from source analysis alone. With no sources, targets are discovered via
  `*.props.ts`; at least one empty props file must exist to register targets.
- `modality extract [source.tsx ...]`: write `.modality/model.json` from React +
  TypeScript source. Use repeatable `--effect-api` to model named async effects;
  use `--report` for the extraction report/trust ledger; use `--overlay`,
  `--config`, `--disable-plugin`, and `--explain-drift` as needed.
- `modality check [model.json] [props.ts ...]`: evaluate properties. Use
  `--report`, `--traces`, `--replay-tests`, `--action-replay-tests`, `--states`,
  search-limit flags, `--no-search-limits`, and `--artifact` as needed.
- `modality replay <trace.json>`: classify a counterexample as `reproduced`,
  `not-reproduced`, or `inconclusive`; use `--mode abstract|action`, `--harness`,
  `--states`, `--observed`, and `--report` as needed.
- `modality conform`: generate or replay random walks for proactive conformance.
- `modality export [model.json] --format tla --out .modality/model.tla`: export a
  conservative TLA+ model.
- `modality ci <model.json> [props.ts] --artifacts .modality`: run the bundled
  automation workflow and write model, report, traces, and conformance artifacts.
  CI can also derive the model path from a discovered props file.

## Artifact Reading Order

1. `*.props.ts`: target registration, property intent, imports.
2. `*.modals.ts`: generated source-anchored state and transition handles.
3. `.modality/model.json`: variables, domains, transitions, bounds, labels,
   effects, and metadata.
4. Extraction report: handlers classified as `exact`, `over-approx`,
   `unextractable`, or `overlay`; caveats, domains, coverage, warnings, and effect
   operations.
5. Check report: verdicts, traces, diagnostics, confidence, and trust ledger.
6. Trace/replay artifacts: shortest violating paths and replay blockers.

## CI Gating

Use `modality ci ... --artifacts .modality` for package-user automation. Gate hard
on reproduced counterexamples, stale model hashes, overlay drift, new severe trust
ledger caveats, and conformance pass-rate drops. Treat `not-reproduced`
violations as model-maintenance work until the model stabilizes; treat
`inconclusive` replay as harness debt.

Inside this repository, maintainer workflows are pnpm scripts, not extra public CLI
commands:

```bash
rtk pnpm ci:conformance
rtk pnpm ci:canaries
rtk pnpm ci:examples
rtk pnpm benchmarks
rtk pnpm phase7
```

Run `pnpm phase7` for checker, extraction, export, or semantics-sensitive changes.

## Repository Validation

For code changes, choose from:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm fix
```

For docs/skill-only changes, validate the skill metadata and inspect the diff.
