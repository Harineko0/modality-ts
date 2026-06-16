---
id: type-library-adapters
title: Type-library adapters
sidebar_label: Type-library adapters
---

Zod, ArkType, and future schema libraries integrate as **domain refinement
providers** — not state sources. They recover finite constraints from schema
initializer chains when TypeScript erases those constraints from inferred types.

## Where they live

```text
src/extract/type-libraries/<library>/
  domains.ts   — library-specific AST recognition
  index.ts     — public factory (e.g. zodDomainRefinementProvider)
```

The extraction engine defines the `DomainRefinementProvider` SPI and orchestrates
resolution (`resolveDomainRefinements`). Built-in providers are wired through the
[CLI registry](../reference/package-entry-points.md) when the app's `package.json`
lists the library (or when dependencies are unknown, matching state-source defaults).

`src/extract/sources/` remains reserved for **state providers** (`useState`, Jotai,
Zustand, SWR). Do not place schema adapters there.

## What providers do

- Inspect **static** TypeScript syntax on initializer chains (no runtime `zod` /
  `arktype` dependency in the extractor).
- Return exact finite domains when constraints are provable on the schema AST.
- Abstain (or emit a caveat) when bounds are dynamic or grammar is unsupported.
- Do **not** interpret full schema runtimes; non-numerical shapes flow through
  TypeScript semantic mapping when `z.infer` / `typeof schema.infer` preserves
  finite structure.

## ArkType static subset

The ArkType adapter intentionally supports only a narrow, sound grammar on
`type("…")` initializer strings:

| ArkType grammar | Modality domain |
| --- | --- |
| `'a' \| 'b'` string literal unions | `enum` |
| `a <= number.integer <= b` | `boundedInt` |
| bounded `number.integer % n` intersections | `intSet` or `boundedInt` |

Recognized but **not** refined (caveat + overlay/predicate usually needed):

- string length (`string > 0`, `string.alphanumeric >= 3`, …)
- array length (`string[] > 0`, `0 < string[] <= 10`, …)
- unbounded divisors (`number % 2`, `number.integer % 2`)

Zod recovers static integer domains from `z.number().int()` chains with static
two-sided bounds, including inclusive aliases (`min`/`gte`, `max`/`lte`),
exclusive bounds (`gt`/`lt`), sign aliases (`positive`, `nonnegative`,
`negative`, `nonpositive`), and finite `multipleOf`/`step` divisibility filters
(`boundedInt` when dense, `intSet` when sparse).

## Wiring and provenance

`createBuiltinModalityRegistry` enables `zod` and `arktype` providers from app
dependencies. Disable them with `disabledPlugins` in `modality.config.json` (same
ids as state plugins). Custom providers can be passed via config `domainRefinements`.

Model metadata `plugins` includes `kind: "domain-refinement"` entries alongside
state sources and navigation adapters.

## Public entry points

| Entry point | Purpose |
| --- | --- |
| `modality-ts/extract/type-libraries/zod` | `zodDomainRefinementProvider()` |
| `modality-ts/extract/type-libraries/arktype` | `arktypeDomainRefinementProvider()` |

There is no `/harness` export for type-library adapters (unlike state sources).
