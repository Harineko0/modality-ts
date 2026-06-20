---
id: cli
title: CLI
sidebar_label: CLI
---

The package installs the `modality` binary (`npx modality <command>`). Commands
communicate through `.modality/` artifacts, so each is independently scriptable.

## `modality init`

Create the default local workspace and starter files.

```bash
npx modality init
```

## `modality extract`

Extract a transition model from React + TypeScript source.

```bash
npx modality extract [source.tsx ...]
```

| Option | Meaning |
| --- | --- |
| `--out <path>` | write the JSON model to a path |
| `--app-model <path>` | write the generated app-model (state types) module |
| `--report <path>` | write the extraction report (the [trust ledger](../soundness/trust-ledger.md)) |
| `--overlay <path>` | apply manual [overlay](./config-and-overlay-api.md) refinements |
| `--config <path>` | use a specific modality config file |
| `--package-json <path>` | resolve package/plugin context from a specific package file |
| `--disable-plugin <id>` | disable a built-in [state-source plugin](../architecture/state-sources.md) |
| `--effect-api <name>` | model a named API function as an [async effect](../guides/modeling-side-effects.md) (repeatable) |
| `--expect-model <path>` | compare output against an expected model |
| `--explain-drift` | explain model/overlay drift against expected output |

## `modality generate`

Write sibling `*.modals.ts` typed-handle modules from source analysis alone. No
properties or prior `model.json` required. With no sources, targets are discovered via
`*.props.ts` files (at least one empty props file must exist to register targets).

```bash
npx modality generate [source.tsx ...]
```

| Option | Meaning |
| --- | --- |
| `--app-model <path>` | app-model path used for modal module resolution |
| `--config <path>` | use a specific modality config file |
| `--package-json <path>` | resolve package/plugin context from a specific package file |
| `--disable-plugin <id>` | disable a built-in [state-source plugin](../architecture/state-sources.md) |
| `--effect-api <name>` | model a named API function as an [async effect](../guides/modeling-side-effects.md) (repeatable) |

## `modality check`

Check one model against one or more property files.

```bash
npx modality check [model.json] [props.ts ...]
```

| Option | Meaning |
| --- | --- |
| `--report <path>` | write the check report |
| `--overlay <path>` | apply an overlay at check time |
| `--traces <dir>` | write violation traces |
| `--replay-tests <dir>` | write generated replay tests |
| `--action-replay-tests <dir>` | write action-replay tests |
| `--states <path>` | write explored states |
| `--max-states <n>` | stop after a maximum number of states |
| `--max-edges <n>` | stop after a maximum number of edges |
| `--max-frontier <n>` | stop after a maximum frontier size |
| `--memory-guard-mb <n>` | stop after a memory threshold |
| `--no-search-limits` | disable default [search limits](../guides/diagnostics-and-search-limits.md) |
| `--artifact`, `-A` | show artifact paths in human output |

A run stopped by a limit produces an `error` verdict with a limit reason — never
`verified-within-bounds`.

## `modality replay`

Replay a counterexample trace against the real app.

```bash
npx modality replay <trace.json>
```

| Option | Meaning |
| --- | --- |
| `--mode abstract\|action` | abstract state replay or DOM/action replay |
| `--harness <path>` | replay harness module |
| `--states <path>` | read the expected state sequence |
| `--observed <path>` | write observed states |
| `--report <path>` | write a replay report |

Verdicts: `reproduced` / `not-reproduced` / `inconclusive`. See
[Debugging counterexamples](../guides/debugging-counterexamples.md).

## `modality conform`

Generate or replay random walks for [proactive conformance](../architecture/conformance-and-replay.md).

```bash
npx modality conform [--model .modality/model.json] [--count 8] [--depth 4]
```

| Option | Meaning |
| --- | --- |
| `--model <path>` | model to walk |
| `--count <n>` / `--walks <n>` | number of random walks |
| `--depth <n>` | walk depth bound |
| `--seed <n>` | deterministic seed |
| `--mode <m>` / `--harness <path>` | replay mode and harness |
| `--report <path>` | write a conformance report |

## `modality export`

Export a model to another model-checking format.

```bash
npx modality export [model.json] --format tla --out .modality/model.tla
```

[Opaque effects](../architecture/ir.md#the-opaque-escape-hatch) export as conservative
`havoc` over their declared writes, so the export is a stated over-approximation. See
[Exporting to TLA+](../guides/exporting-to-tla.md).

## `modality ci`

Run the bundled workflow and write all artifacts for automation.

```bash
npx modality ci <model.json> [props.ts] --artifacts .modality
```

| Option | Meaning |
| --- | --- |
| `--artifacts <dir>` | directory for model, report, traces, conformance output |
| `--baseline <path>` | compare against a previous report (regression detection) |
| `--source <path>` | source root for staleness/drift detection |
| `--conform-count <n>` / `--conform-depth <n>` | size the conformance walks |
| `--min-conform-pass-rate <r>` | fail if overall conformance drops below `r` |
| `--min-transition-conform-pass-rate <r>` | fail if any single transition drops below `r` |

See [CI integration](../guides/ci-integration.md).
