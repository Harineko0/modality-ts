---
id: concepts
title: Concepts
sidebar_label: Concepts
---

`modality-ts` is built around a transition-system model. The extractor turns supported React and TypeScript patterns into a finite graph; the checker explores that graph; replay maps failing paths back to user-visible actions.

## Model

A model contains:

| Part | Purpose |
| --- | --- |
| State variables | Finite domains for component, library, route, async, and system state. |
| Transitions | User actions, navigation, environment completions, timers, and internal effects. |
| Labels | Replay-facing descriptions such as clicks, inputs, submits, resolves, and navigation. |
| Source anchors | Links from model pieces back to source locations and extraction confidence. |

Models are serialized JSON so behavior changes can be reviewed in pull requests.

## Domains

Every state variable has a finite domain. Common domains include booleans, enums, bounded integers, option values, records, discriminated unions, tokens, list length categories, and bounded lists.

The extractor intentionally avoids unbounded strings and numbers. If the source type is too broad, it abstracts the value into a finite representation. Use overlays when a property needs a sharper domain.

## Transitions

Each transition has a guard, effect, read set, write set, class, source anchor, and replay label. Transition classes include:

| Class | Meaning |
| --- | --- |
| `user` | A user interaction such as click, submit, or input. |
| `nav` | Route changes and history movement. |
| `env` | External outcomes such as an async operation resolving. |
| `internal` | React effects, derived resets, and stabilization steps. |
| `library` | State-source behavior supplied by a template or plugin. |

The checker explores every enabled transition from each reached state.

## Properties

Properties describe what must hold across the explored graph. The common starting points are:

| Kind | Use it for |
| --- | --- |
| `always` | Invariants over every reachable stable state. |
| `alwaysStep` | Rules about a specific transition from pre-state to post-state. |

Property predicates should declare the variables they read. That read set helps reporting and slicing.

## Bounds

The model is finite by construction, but finite does not mean tiny. Search limits protect everyday checks from runaway state spaces. Bounds can come from domains, async queues, route history, list windows, and checker limits.

A bound hit is not the same thing as a proof. Treat it as a prompt to tighten the model, slice the property, or raise the limit deliberately.

## Replay

Replay takes a counterexample trace and drives the real app or an abstract harness through the same steps. The trace is only fully replayable when extracted transitions have enough locator information. Missing locators still produce useful abstract traces, but action replay may need an overlay or harness.

## Good Fits

`modality-ts` works best when important behavior is represented as bounded, deterministic state transitions in TypeScript:

- Local `useState` flows.
- Supported state/data sources such as Jotai, SWR, and router state.
- Named side effects such as `api.placeOrder`.
- Business rules expressible as safety properties over reachable states.

It is less suited to DOM layout, CSS, animation timing, canvas rendering, browser quirks, or external services that are not modeled.
