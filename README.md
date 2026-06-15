# modality-ts

[![npm version](https://img.shields.io/npm/v/modality-ts.svg)](https://www.npmjs.com/package/modality-ts)
[![CI](https://github.com/Harineko0/modality-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/Harineko0/modality-ts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)

`modality-ts` is a model-checking-based testing tool for React state-transition bugs.

It extracts a finite transition model from React + TypeScript code, checks developer-defined properties against every reachable state within stated bounds, and turns counterexamples into replayable tests.

## Install

Install `modality-ts` as a dev dependency in the app you are checking. Property files such as `app.props.mjs` import `modality-ts/core`, so the package must resolve from that app's dependency graph.

```bash
npm install -D modality-ts
```

(`pnpm add -D modality-ts` and `yarn add -D modality-ts` work the same way.)

## Usage

Start by extracting a model from a React component:

```bash
npx modality init
npx modality extract
```

If your component calls side-effect APIs that should appear in the model, name them explicitly:

```bash
npx modality extract --effect-api api.placeOrder
```

Check the extracted model against a property file:

```bash
npx modality check
```

`modality check` applies conservative default search limits (`--max-states`, `--max-edges`, `--max-frontier`, `--memory-guard-mb`). Use `--no-search-limits` for intentionally unbounded runs.

When a property fails, replay the generated counterexample trace:

```bash
npx modality replay .modality/traces/noDoubleSubmit.violated.trace.json
```

For CI, write all verification artifacts into one directory:

```bash
npx modality ci .modality/model.json src/app.props.mjs --artifacts .modality
```

Useful commands:

```bash
npx modality init
npx modality extract [source.tsx ...]
npx modality check [model.json] [props.mjs ...] [--max-states N] [--max-edges N] [--max-frontier N] [--memory-guard-mb N] [--no-search-limits]
npx modality replay <trace.json>
npx modality conform --count 8 --depth 4
npx modality export
npx modality ci <model.json> [props.ts] --artifacts .modality
```

## Limitation

`modality-ts` verifies the model it can extract, not arbitrary browser behavior. It works best for React apps where important behavior is represented as bounded, deterministic state transitions in TypeScript.

Good fits include:

- Components with local `useState` transitions.
- Apps that use supported state/data sources such as Jotai, SWR, and router state.
- Flows with finite domains, bounded collections, and named side effects.
- Business rules that can be expressed as safety properties over reachable states.

Current weak fits include:

- Apps whose correctness depends mainly on DOM layout, CSS, animation timing, canvas rendering, or browser quirks.
- Unbounded or highly numeric behavior without explicit finite bounds.
- External services that are not modeled as effects or bounded data.
- Concurrency, timers, and network races that are not represented in the extracted model.
- Code patterns outside the supported React + TypeScript extraction subset.

For those cases, use `modality-ts` alongside regular unit, integration, and end-to-end tests.

## License

MIT
