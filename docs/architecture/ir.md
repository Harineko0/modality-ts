---
id: ir
title: The transition-system IR
sidebar_label: The IR
---

The IR is the single contract between four subsystems: the **extractor** produces it,
the **checker** executes it, the **exporter** translates it (TLA+), and the **replay
generator** consumes traces over it. It is defined in `src/core/ir/types.ts` and
mirrored in Rust (`crates/checker/src/model.rs`) — the two must stay lockstep.

Its design is dominated by one tension: effects must be **executable** (the checker
runs them) and, as far as possible, **analyzable** (slicing, export, and partial-order
reduction need read/write sets and structured semantics). The IR therefore has a
**structured core** plus a **declared-footprint opaque escape hatch**.

## The model

```ts
interface Model {
  schemaVersion: 1;
  id: string;
  vars: StateVarDecl[];
  transitions: Transition[];
  bounds: { maxDepth; maxPending; maxInternalSteps };
  metadata?: {
    sourceHashes?;            // staleness detection
    plugins?;                 // provenance for the trust ledger
    domainProvenance?;
    extractionCaveats?;       // the trust ledger's raw caveats
    numericReductions?;       // claim-tagged reductions
  };
}
```

The model file embeds a hash of the source files it was extracted from, so a stale model
(code changed, model not regenerated) is detectable. Serialization is **canonically
ordered JSON** so a model diff is reviewable in a pull request — the diff *is* the review
artifact for "did this refactor change behaviour?"

## State variables and domains

A `StateVarDecl` binds an `id` to an `AbstractDomain`, an `origin`, a `scope`
(`global` or `mount-local`), optional `role` metadata for adapter-owned system vars,
and one or more `initial` values (multiple ⇒
nondeterministic initial value). Domains are covered in
[State & domains](../concepts/state-and-domains.md).

Adapters may emit vars such as `sys:route`, `sys:history`, and `sys:pending`, but the
checker treats them as ordinary state when unstamped; when stamped with
`location-current`, `location-history`, or `pending-queue` roles they participate in
shape validation and harness discovery. Mount-local variables hold `⊥` while unmounted — the IR-level encoding of
"local state resets on remount".

## Transitions and the effect language

Covered in detail in [Transitions](../concepts/transitions.md). The key structural
facts:

- `guard: GuardIR` is always a structured `ExprIR` — **never opaque**.
- `effect: EffectIR` is structured (`assign`/`havoc`/`choose`/`if`/`seq`/`enqueue`/
  `dequeue`/`navigate`) *or* a single `opaque` escape hatch from the overlay.
- `reads`/`writes` MUST over-approximate the effect's real footprint (validated).
- `confidence` is `exact` / `over-approx` / `manual`.

### The opaque escape hatch, per subsystem {#the-opaque-escape-hatch}

An `OpaqueRef` names a `{ module, export, declaredReads, declaredWrites }`. Its handling
differs by subsystem — this split is the load-bearing compromise:

| Subsystem | Treatment of an opaque effect |
| --- | --- |
| Checker | runs it directly; debug mode validates outputs against domains and `declaredWrites` |
| Slicing | uses `declaredReads`/`declaredWrites` |
| Exporter | replaces it with `havoc(declaredWrites)` — a stated over-approximation |
| Replay | unaffected (replay drives the real app, not the model) |

## Event labels: the replay contract

Every non-internal transition carries an `EventLabel` sufficient to drive the real app:
`click`/`submit` (with a locator), `input` (with a value class), `navigate`, `resolve`
(network completion), `focus-revalidate`/`timer`. Locators (`testId`, `role`+`name`, or
`positional` for list-rendered handlers) come from JSX or are flagged for overlay
completion. A transition with no resolvable locator is still checkable but marked
non-replayable — its counterexamples degrade to abstract traces, and the report says so.

## Well-formedness (validated at load time)

`src/core/ir/validator.ts` rejects malformed models before any search. Among the
checks:

- every `assign`/`choose`/`havoc` target exists and the expression type matches the
  domain;
- `reads`/`writes` over-approximate the structured effect's actual footprint;
- guards read only declared reads;
- mount-local vars are written only by transitions that declare them or by mount machinery;
- enum/tagged values referenced in expressions exist in the domain;
- initial states are valid and stabilized.

Numeric overflow is **not** rejected statically — reachable overflow is a checking
behaviour, so the validator compares domains but leaves overflow to the
[checker](./checker.md).

## Library templates

Some library behaviour is too subtle to extract and is instead modeled **once, by
hand**, as a parameterized template instantiated per call site (a `TemplateFragment` of
vars + transitions in plain IR). SWR is the main example — see [SWR](../sources/swr.md).
The template is part of the trusted base and gets its own
[conformance tests](./conformance-and-replay.md) against the real library.
