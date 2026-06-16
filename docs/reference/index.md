---
id: index
slug: /reference
title: Reference
sidebar_label: Overview
---

Precise reference for the public surfaces of `modality-ts`.

| Page | Covers |
| --- | --- |
| [CLI](./cli.md) | the `modality` binary and every command's options |
| [Property API](./property-api.md) | combinators and expression helpers from `modality-ts/core` |
| [Domains](./domains.md) | every `AbstractDomain` kind |
| [Config & overlay API](./config-and-overlay-api.md) | the overlay builder and config knobs |
| [Schemas](./schemas.md) | the `model.json`, `trace.json`, and `report.json` shapes |
| [Package entry points](./package-entry-points.md) | every subpath export |

All artifacts carry `schemaVersion: 1`. Readers reject newer-major artifacts with a
"re-run extract" message — [artifact compatibility *is* the tool's compatibility
story](../architecture/index.md), because feature slices communicate through artifacts.
