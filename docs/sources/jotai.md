---
id: jotai
title: Jotai
sidebar_label: Jotai
---

Jotai is the best case for extraction: atoms are global, declared statically, and derived
atoms hand you a dependency graph and pure derivations for free. Variables are named
`atom:<name>` (with a `@store:<id>` qualifier when scoped).

## What is discovered

The plugin resolves Jotai's module graph by **import alias** (not callee name), across
`jotai`, `jotai/utils`, and family packages:

| Kind | Handling |
| --- | --- |
| Primitive atoms (`atom(value)`) | record the initial-value expression + inferred type → domain |
| Utility atoms (`atomWithStorage`, `atomWithReset`, `atomFamily`, `loadable`, …) | carry plugin metadata (`storageKey`, `familyParam`, …) for warnings + conservative fallbacks |
| Derived read-only atoms (`atom(get => …)`) | dependency sets recorded; simple bodies may use token domains with explicit warnings |
| Writable derived atoms | write functions summarized into underlying primitive-atom writes when the body only does supported `set(atom, value)` calls |
| Static `atomFamily(...)` instances | discovered from the module graph |

## Store scoping

`createStore`, `Provider`, `useStore`, and `useAtom(atom, { store })` qualify atom IDs
(`atom:count@store:myStore`). `getDefaultStore` keeps the legacy global ID **and emits a
global taint** — because `getDefaultStore().set` can be called from external code, the
default store is an escape-analysis loophole that the plugin closes by tainting any
project import of `getDefaultStore`.

## Write channels

The plugin declares `useAtom`/`useSetAtom`/`useResetAtom` setter usages and `store.set` as
its write channels. Anything not declared is treated by
[escape analysis](../architecture/extraction-pipeline.md#p5--escape-analysis-the-e1-enforcer)
as an unknown call → taint, never a silent miss.

## What stays conservative

Dynamic family params, dynamic Provider stores, async storage, and unbounded observables
emit **Jotai-specific extraction warnings** instead of silent exact models. These are
honest over-approximations or `unextractable` markers, surfaced in the
[trust ledger](../soundness/trust-ledger.md).

## Observation in replay

Atoms are **directly observable**: the [harness](../architecture/conformance-and-replay.md)
owns the `Provider` store, so the generated test holds the store handle and reads
`store.get(atom)` directly — full fidelity, no observation declaration needed.

## Hydration

`useHydrateAtoms` initial overrides are recognized and applied as initial-value
overrides, so the model's initial states match a hydrated app.
