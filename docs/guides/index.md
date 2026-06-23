---
id: index
slug: /guides
title: Guides
sidebar_label: Overview
---

Task-oriented guides for the day-to-day workflow: extract a model, make it precise
enough, check properties, and turn failures into small reproducible traces.

| Guide | When you need it |
| --- | --- |
| [Writing properties](./writing-properties.md) | expressing what must hold, with the right combinator |
| [Refining domains & overlays](./refining-domains-and-overlays.md) | when extraction's defaults are too coarse, or a handler is unextractable |
| [Modeling side effects](./modeling-side-effects.md) | naming async APIs so races appear in the model |
| [Diagnostics & search limits](./diagnostics-and-search-limits.md) | taming state explosion; reading the diagnostics |
| [Debugging counterexamples](./debugging-counterexamples.md) | replaying a failing trace and reading the verdict |
| [CI integration](./ci-integration.md) | gating pull requests on checks and the trust ledger |
| [Exporting to TLA+](./exporting-to-tla.md) | external model-checking and differential validation |
| [Building extraction plugins](./building-extraction-plugins.md) | adding support for your own state, schema, routing, or framework library |

If you are new, do the [Quickstart](../intro/quickstart.md) first; these guides assume
you have a model and a property file.
