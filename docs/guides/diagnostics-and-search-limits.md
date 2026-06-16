---
id: diagnostics-and-search-limits
title: Diagnostics & search limits
sidebar_label: Diagnostics & search limits
---

Real apps can produce large state spaces. `modality-ts` protects everyday checks with
**search limits** and explains where the space went with **diagnostics**. This guide is
about using both.

## Default limits

`modality check` applies conservative limits by default. Override them as needed:

| Flag | Stops when… |
| --- | --- |
| `--max-states <n>` | the number of distinct states reaches `n` |
| `--max-edges <n>` | the number of explored edges reaches `n` |
| `--max-frontier <n>` | a single BFS frontier reaches `n` states |
| `--memory-guard-mb <n>` | estimated memory crosses `n` MB |
| `--no-search-limits` | disables all of the above (intentional local runs) |

```bash
npx modality check --max-states 50000 --max-edges 150000
npx modality check --no-search-limits   # unbounded; for local exploration only
```

## A limit hit is an error, not a pass

```mermaid
flowchart LR
  run["check run"] --> q{"frontier limits<br/>enforced mid-depth?"}
  q -->|hit| stop["stop with an ERROR verdict<br/>+ limit reason + diagnostics"]
  q -->|never hit| done["explore to completion<br/>→ verified-within-bounds"]
  stop -.never.-> verified["NOT verified"]
```

When a limit stops a run, the property's verdict is `error` with a `limits.reason`, never
`verified-within-bounds`. The limits are enforced **mid-depth** (not only at layer
boundaries), so a single explosive frontier cannot OOM the process before the guard
trips. Treat a limit hit as a prompt to [slice or tighten](../concepts/state-space-control.md),
not as a result.

## Reading the diagnostics

The `report.json` carries an optional `diagnostics` block (and the terminal prints
compact summaries):

- **slicing** — whether slicing was enabled, how many slices, per-slice var/transition/
  state/edge/depth counts, and the skip reason when slicing was unavailable for a
  property (e.g. `alwaysStep` uses full-model search).
- **search** — max and final frontier size, expanded depths, elapsed time.
- **limits** — the reason a run stopped early and which limit bound.
- **dominantVars** — the variables with the most distinct observed values. This is your
  first clue to *what* exploded: a `dominantVars` entry with a huge distinct-value count
  is a domain to [refine or reduce](./refining-domains-and-overlays.md).

## A worked tightening loop

1. Run `modality check`; a property errors with a `max-states` limit.
2. Look at `diagnostics.dominantVars` — say `swr:GET /api/items` has 400 distinct values.
3. That cache payload is a `lengthCat`/`tokens` blow-up or a wide numeric domain. Refine
   it to the distinctions the property actually needs (e.g. `empty | nonEmpty`).
4. Confirm via `diagnostics.slicing` that the property's slice dropped the irrelevant
   variables.
5. Re-run; the state count collapses and the verdict becomes
   `verified-within-bounds`.

## Slicing is automatic but observable

[Per-property slicing](../concepts/state-space-control.md) is on by default and is the
biggest single lever — an auth-guard property should not pay for checkout interleavings.
The diagnostics show, per slice, how many vars and transitions survived, so you can see
slicing working (or see why it was skipped). `alwaysStep` and `leadsToWithin` properties
use full-model search by design, so they will report a slicing skip reason.

## Contributors report

The diagnostics' dominant-variable ranking is effectively a **state-space contributors**
report: it ranks which variables (and the transitions writing them) are driving the
size. Use it to decide where a [bound](../soundness/trust-ledger.md), a domain
refinement, or a numeric reduction will buy the most.
