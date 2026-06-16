---
id: domains
title: Domains
sidebar_label: Domains
---

The `AbstractDomain` kinds from `src/core/ir/types.ts`. Every state variable has exactly
one. Conceptual treatment is in [State & domains](../concepts/state-and-domains.md).

| Kind | Shape | Cardinality | Notes |
| --- | --- | --- | --- |
| `bool` | `{ kind: "bool" }` | 2 | |
| `enum` | `{ kind: "enum", values }` | `values.length` | literal string unions, discriminant tags |
| `boundedInt` | `{ kind: "boundedInt", min, max, overflow? }` | `max − min + 1` | finite integer range |
| `intSet` | `{ kind: "intSet", values, overflow? }` | `values.length` | **sparse** finite integers; `0\|2` stays `{0,2}` |
| `option` | `{ kind: "option", inner }` | `card(inner) + 1` | `null`/`undefined` collapse |
| `record` | `{ kind: "record", fields }` | product of fields | unread fields are [pruned](../concepts/state-and-domains.md#domain-inference-and-field-pruning) |
| `tagged` | `{ kind: "tagged", tag, variants }` | sum over variants | discriminated unions |
| `tokens` | `{ kind: "tokens", count, names? }` | `count` | opaque identities, equality-only |
| `lengthCat` | `{ kind: "lengthCat" }` | 3 | `'0' \| '1' \| 'many'` collection abstraction |
| `boundedList` | `{ kind: "boundedList", inner, maxLen }` | bounded | element-sensitive; overlay-requested |

## Numeric overflow policy

`boundedInt` and `intSet` carry an optional `overflow`:

| Policy | On out-of-range assignment |
| --- | --- |
| `forbid` (default) | a modeling error (the assignment must stay in range) |
| `wrap` | modular wrap-around |
| `saturate` | clamp to the nearest bound |

Reachable overflow is a **checking behaviour**, evaluated by the
[checker](../architecture/checker.md), not erased by static validation. Cardinality and
enumeration ignore `overflow`.

## Branded numeric aliases

Author-facing aliases from `modality-ts/core` (`src/core/numeric/types.ts`) that
extraction resolves to `boundedInt`:

| Alias | Resolves to |
| --- | --- |
| `Bounded<Min, Max>` | `boundedInt {min, max, forbid}` |
| `Wrapping<Min, Max>` | `boundedInt {min, max, wrap}` |
| `Uint8` / `Byte` | `boundedInt {0, 255, wrap}` |
| `Uint16` | `boundedInt {0, 65535, wrap}` |
| `Short` | `boundedInt {-32768, 32767, wrap}` |

## Domain provenance

Each domain's origin is recorded in the [trust ledger](../soundness/trust-ledger.md):
`type-derived`, `default-token`, `overlay-refined`, `template`, or `system`. Finite
numeric **reductions** are recorded separately with a soundness claim (`exact` /
`property-preserving` / `heuristic`).

## Domain helpers

`src/core/ir/domains.ts` exposes per-domain helpers used throughout: `domainCardinality`,
`enumerateDomain` (for `havoc`), `validateValue`, and `domainFingerprint` (which
distinguishes exact `0|2` from range `0..2`).
