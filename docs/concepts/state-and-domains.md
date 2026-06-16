---
id: state-and-domains
title: State & abstract domains
sidebar_label: State & domains
---

Every state variable has an **abstract domain**: a finite set of values it can take.
Domains are *data* (serializable), not code. Finiteness is what makes exhaustive
checking possible, and TypeScript types already do much of the work — a variable typed
`'idle' | 'loading' | 'error'` *is* a finite domain with no abstraction needed.

## The domain kinds

These are the `AbstractDomain` variants in the IR (`src/core/ir/types.ts`):

| Kind | Shape | Use |
| --- | --- | --- |
| `bool` | `true \| false` | booleans |
| `enum` | `values: string[]` | literal string unions, discriminant tags |
| `boundedInt` | `min, max` (+ `overflow`) | finite integer ranges (counters, widths) |
| `intSet` | `values: number[]` (+ `overflow`) | **sparse** finite integer sets (`0 \| 2`) |
| `option` | `inner` | `T \| null \| undefined` (null/undefined collapse) |
| `record` | `fields` | object types (with field pruning, below) |
| `tagged` | `tag`, `variants` | discriminated unions |
| `tokens` | `count`, `names?` | opaque values compared only by identity |
| `lengthCat` | — | collections abstracted to `'0' \| '1' \| 'many'` |
| `boundedList` | `inner`, `maxLen` | element-sensitive bounded lists |

### Tokens — the workhorse for server data

Properties rarely care *what* a server payload is — only whether it changed, is
present, or belongs to the wrong identity. `tokens` captures exactly that: opaque
values distinguished only by equality. Stale-cache bugs need ≥2 tokens (a `userA`
payload vs a `userB` payload). `count` is a bound; exhausting tokens during a search is
a **reported bound-hit**, never silent reuse.

### Length categories vs bounded lists

`lengthCat` (`0 / 1 / many`) is the default array abstraction — cheap and usually
enough. Element-sensitive reasoning (e.g. "the *i*-th item is expired") needs a
`boundedList`, which must be requested via an [overlay](../guides/refining-domains-and-overlays.md)
because it is the most expensive domain.

## Finite numeric domains

Unlike the original design, numbers can be **finite state** when their domain is
statically provable. This is type-driven, in the SPIN spirit — finite numerics are
concrete state values; bare `number` stays abstract.

```mermaid
flowchart TD
  n["TypeScript numeric type"] --> q{"finite & statically provable?"}
  q -->|"literal union 0 or 2"| s["intSet {0,2}"]
  q -->|"literal union 0..3"| r1["intSet or boundedInt 0..3"]
  q -->|"Bounded&lt;0,3&gt;"| r2["boundedInt 0..3 (forbid)"]
  q -->|"Uint8 / Byte"| r3["boundedInt 0..255 (wrap)"]
  q -->|"zod / arktype static schema"| r4["boundedInt 0..3"]
  q -->|"bare number / float / dynamic"| t["tokens(1) + caveat"]
```

- **Literal unions are exact.** `0 | 2` becomes `intSet {0,2}` — it does *not* widen to
  `0..2` and invent `1`. The domain fingerprint distinguishes the two.
- **Branded aliases** from `modality-ts/core` carry static ranges: `Bounded<Min,Max>`,
  `Wrapping<Min,Max>`, `Uint8`/`Byte` (`0..255`, wrap), `Uint16` (`0..65535`),
  `Short` (`-32768..32767`).
- **Schema adapters** read static integer bounds from `zod`
  (`z.number().int().min(a).max(b)`) and `arktype` (`"a <= number.integer <= b"`).
- **Overflow policy** (`forbid | wrap | saturate`) is part of the domain. Reachable
  overflow is a *model-checking behaviour*, not something erased by static validation —
  the checker evaluates it. See [Transitions](./transitions.md#numeric-effects).
- **Unprovable constraints abstain.** A wrong numeric bound would be unsound, so
  adapters fall back to `tokens(1)` and emit an extraction caveat rather than guess.

Wide numeric (or product) domains above a threshold raise a **cardinality warning**;
[numeric state reduction](../guides/refining-domains-and-overlays.md) is how you tame
them, with each reduction recorded with a soundness claim
(`exact` / `property-preserving` / `heuristic`) in the [trust ledger](../soundness/trust-ledger.md).

## Domain inference and field pruning

Extraction computes a domain `D(τ)` from the TypeScript type `τ` structurally
(`src/extract/engine/ts/domains.ts`). Two rules keep it sound and small:

- **No `string` / unbounded `number` domain by accident.** Such types map to `tokens`
  (or an overlay-declared refinement), never to an enumerated set.
- **Field pruning (cone-of-relevance).** Record fields are kept only if something
  actually *reads* them (a guard, effect, derived value, or property). Unread fields
  collapse into the record's token identity. This is sound — unread fields cannot
  influence any modeled transition — and it is recomputed whenever properties change.

## Refinement: when `tokens` is too coarse

When a property needs to distinguish values a `tokens` domain hides (`cart.total > 0`,
`draft` non-empty), you declare a **predicate abstraction** in the overlay that replaces
`tokens` with an `enum` plus a *concretization obligation* (a witness per class, needed
for [replay](../architecture/conformance-and-replay.md)). See
[Refining domains & overlays](../guides/refining-domains-and-overlays.md).
