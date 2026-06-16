---
id: index
slug: /concepts
title: Concepts
sidebar_label: Overview
---

`modality-ts` rests on a small set of ideas borrowed from explicit-state model
checking and adapted to React. This section explains them in the order you need to
understand a verdict.

```mermaid
flowchart LR
  ts["Transition system<br/>M = (S, S₀, A, →)"] --> dom["Abstract domains<br/>(finite state)"]
  dom --> tr["Transitions<br/>(guards + effects + labels)"]
  tr --> stab["Macro-steps<br/>+ stabilization"]
  stab --> prop["Properties<br/>(safety + bounded response)"]
  prop --> ssc["State-space control<br/>(bounds, slicing, abstraction)"]
```

| Page | What it covers |
| --- | --- |
| [The transition system](./transition-system.md) | The formal object: states, initial states, actions, transition relation. |
| [State & abstract domains](./state-and-domains.md) | How React state becomes finite, including numeric domains and tokens. |
| [Transitions](./transitions.md) | Transition classes, guards, structured effects, and async splitting. |
| [Macro-steps & stabilization](./stabilization.md) | Run-to-completion semantics for `useEffect` reactions. |
| [Properties](./properties.md) | The closed combinator DSL and its normative semantics. |
| [State-space control](./state-space-control.md) | Bounds, cone-of-influence slicing, and abstraction — sound vs heuristic. |

A theme runs through all of them: **the model is finite by construction, and every way
the tool keeps it finite is either sound (the verdict still reads "verified within
bounds") or loudly labelled as heuristic.** Knowing which is which is the whole game.
