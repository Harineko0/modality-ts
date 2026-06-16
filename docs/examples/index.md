---
id: index
slug: /examples
title: Examples
sidebar_label: Overview
---

The repository includes small apps under `examples/` that exercise common modeling
patterns and double as integration tests. Each pairs an `App.tsx` with an
`app.props.mjs` property file.

| Example | Demonstrates |
| --- | --- |
| [Todo app](./todo.md) | local state + a Jotai auth atom + an SWR query + an async create |
| [Checkout app](./checkout.md) | a multi-step wizard with auth, quote loading, payment, review, submit |
| [Demo app](./demo.md) | three intentionally seeded interleaving bugs |

The patterns these show — guarding actions on auth, bounding concurrent submits,
rejecting stale resolves, keeping a flow's steps reachable — are the shapes
`modality-ts` is built for. Start from the closest example and adapt its property file.
