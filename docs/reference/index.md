---
id: reference
title: Reference
sidebar_label: Reference
---

This page summarizes the public CLI and package entry points.

## CLI

The package installs the `modality` binary.

### `modality init`

Create the default local project files.

```bash
npx modality init
```

### `modality extract`

Extract a transition model from React and TypeScript source.

```bash
npx modality extract [source.tsx ...]
```

Common options:

| Option | Meaning |
| --- | --- |
| `--out <path>` | Write the JSON model to a specific path. |
| `--app-model <path>` | Write the generated app model module. |
| `--report <path>` | Write an extraction report. |
| `--overlay <path>` | Apply manual overlay refinements. |
| `--config <path>` | Use a modality config file. |
| `--package-json <path>` | Resolve package context from a specific package file. |
| `--disable-plugin <id>` | Disable a built-in extraction plugin. |
| `--effect-api <name>` | Model a named API function as a side effect. |
| `--explain-drift` | Include model drift explanation when comparing expected output. |

### `modality check`

Check one model against one or more property files.

```bash
npx modality check [model.json] [props.mjs ...]
```

Common options:

| Option | Meaning |
| --- | --- |
| `--report <path>` | Write the check report. |
| `--overlay <path>` | Apply an overlay at check time. |
| `--traces <dir>` | Write violation traces. |
| `--replay-tests <dir>` | Write generated replay tests. |
| `--action-replay-tests <dir>` | Write action replay tests. |
| `--states <path>` | Write explored states. |
| `--max-states <n>` | Stop after a maximum number of states. |
| `--max-edges <n>` | Stop after a maximum number of edges. |
| `--max-frontier <n>` | Stop after a maximum frontier size. |
| `--memory-guard-mb <n>` | Stop after a memory guard threshold. |
| `--no-search-limits` | Disable default checker search limits. |
| `--artifact` or `-A` | Show artifact paths in human output. |

### `modality replay`

Replay a counterexample trace.

```bash
npx modality replay <trace.json>
```

Options:

| Option | Meaning |
| --- | --- |
| `--mode abstract\|action` | Choose abstract state replay or DOM/action replay. |
| `--harness <path>` | Use a replay harness module. |
| `--states <path>` | Read expected state sequence. |
| `--observed <path>` | Write observed states. |
| `--report <path>` | Write a replay report. |

### `modality conform`

Generate or replay random walks for conformance checks.

```bash
npx modality conform [--model .modality/model.json] [--count 8] [--depth 4]
```

Options include `--walks`, `--seed`, `--mode`, `--harness`, and `--report`.

### `modality export`

Export a model to another model-checking format.

```bash
npx modality export [model.json] --format tla --out .modality/model.tla
```

### `modality ci`

Run extraction-adjacent checks and write artifacts for automation.

```bash
npx modality ci <model.json> [props.mjs] --artifacts .modality
```

Common options include `--baseline`, `--source`, `--conform-count`, and `--min-transition-conform-pass-rate`.

## Package Entry Points

| Entry point | Purpose |
| --- | --- |
| `modality-ts` | CLI default export target. |
| `modality-ts/cli` | Programmatic CLI API. |
| `modality-ts/core` | IR types, domain helpers, property helpers, traces, reports, and overlays. |
| `modality-ts/core/props` | Property helper APIs. |
| `modality-ts/check` | Programmatic checker APIs. |
| `modality-ts/extract` | Extraction APIs. |
| `modality-ts/extract/engine` | Extraction engine APIs. |
| `modality-ts/extract/engine/pipeline` | Extraction pipeline APIs. |
| `modality-ts/extract/engine/spi` | Source plugin interfaces. |
| `modality-ts/extract/sources/use-state` | Built-in local state source support. |
| `modality-ts/extract/sources/jotai` | Built-in Jotai source support. |
| `modality-ts/extract/sources/swr` | Built-in SWR source support. |
| `modality-ts/extract/sources/router` | Built-in router source support. |
| `modality-ts/cli/harness` | Replay harness helpers. |
| `modality-ts/cli/runtime` | Runtime assertion helpers. |

## Property Helpers

Property files commonly import:

| Helper | Purpose |
| --- | --- |
| `readVar(id, path?)` | Read a model variable. |
| `readPreVar(id, path?)` | Read the pre-state value in a step property. |
| `lit(value)` | Create a literal expression. |
| `eq(a, b)` / `neq(a, b)` | Compare expressions. |
| `andExpr(...items)` / `orExpr(...items)` / `notExpr(item)` | Compose boolean expressions. |
| `stepEnqueued(op)` | Match an async enqueue transition. |
| `stepResolved(op, outcome)` | Match an async resolve transition. |

Use generated model variable IDs and keep each property's `reads` list aligned with the variables the predicate reads.
