# Implementation Flow & Verification Guide

A deliberately tiny guide: the build order, why it's that order, and the falsifiable gate that ends each phase. Details live in the specs; this page only sequences them. Layout per Spec 05; scope per design §8 (MVP).

## Guiding rule

**Build the checker before the extractor, against hand-written models.** The two walkthroughs (`examples/todo-walkthrough.md`, `examples/checkout-walkthrough.md`) already state, on paper, the exact models, properties, verdicts, and counterexample traces — they are the project's executable acceptance specs. Hand-coding their IR first (a) decouples checker risk from extraction risk, (b) gives the extractor a precise target (its output must agree with the hand model), and (c) makes every later phase verifiable against known answers instead of opinions.

## Phases

| # | Build | Verify (exit gate) |
|---|---|---|
| 0 | Single package layout per Spec 05; `modality-ts/core`: domains, ExprIR/EffectIR types, well-formedness validator, canonical JSON | Property tests: `encode∘decode = id`, domain `enumerate/validate` agree; validator rejects each Spec 01 §7 rule violation (one fixture per rule) |
| 1 | `modality-ts/check` core: compiled encoders, token renaming, BFS + stabilization, parent map, trace reconstruction | Oracle micro-models with known state counts (Spec 03 §9.3); **hand-written ToDo IR** reaches the walkthrough's state-space size; determinism: two runs byte-identical |
| 2 | Props DSL + monitors: `always`, `alwaysStep`, `reachable`, `enabled`, `leadsToWithin`, `reachableFrom`; slicing | **All ToDo walkthrough verdicts reproduced on the hand model**, including the §5.1/§5.2 counterexample traces step-for-step; metamorphic tests (slicing on/off ⇒ same verdicts); vacuity suite fires on a deliberately over-constrained model |
| 3 | SWR template (key window, per-key isolation, view helpers) as a `TemplateFragment` factory | **Hand-written checkout IR reproduces all 52 walkthrough verdicts** (this exercises multi-key, op args, indexed families, `reachableFrom`); template probe walks pass against real SWR at pinned versions (Spec 04 §5) |
| 4 | `modality-ts/extract`: P1 inventory → P2 domains → golden snapshots; then M0 summarization, escape analysis, async splitting, overlay merge, stable IDs | **Extracted model ≡ hand model** for both demo apps: same reachable state count and identical verdicts on all properties (graph-level agreement, not just "looks right"); extraction report classifies every handler in both apps `exact` or `overlay` — any `unextractable` not predicted by the walkthroughs is a finding to fix or document |
| 5 | `modality-ts/cli/harness` + replay codegen + `modality replay`/`conform` | The walkthroughs' **reproduced** verdicts reproduce in jsdom (ToDo: stale-clobber; checkout: V1–V4); a deliberately wrong hand-model edit yields **not-reproduced** with the right divergence step (test the divergence detector, not only the happy path) |
| 6 | `modality` CLI slices, artifact schemas, CI gate, trust-ledger rendering | Design §8 PoC criteria run as one CI job on `examples/`: 3 seeded ToDo-era bugs found < 1 min, ≥2/3 replays reproduce, overlay line counts asserted under the kill threshold |
| 7 (post-MVP) | IR → TLA+ export; differential corpus | TLC agrees on reachable counts + verdicts for the hand models and 1k random IRs (Spec 03 §9.1) |

Phases 1–3 need no React, no ts-morph, no DOM — pure Node — which is where the verification-grade care is cheapest to apply. Phase 4 is the research-risk phase; its gate (extracted ≡ hand-written) is the project's central experiment, and failing it is a result, not a delay (design §8 kill criteria apply).

## Standing verification machinery (built once, runs always)

- **Verify and commit the implemented outputs after each phase (Phase 1 ~ Phase 7) has done.**
- **Strictly follow software architecture defined in docs/specs/05-architecture.md**
- **Golden snapshots**: extraction output (`model.json`) per fixture app, reviewed as diffs in PRs — the model diff is the review artifact.
- **Walkthrough conformance suite**: the verdict tables of both walkthroughs encoded as test expectations; any spec or code change that flips a verdict must update the walkthrough document in the same PR (docs and behavior cannot drift apart silently).
- **Determinism check** in CI: every checker run executed twice, outputs byte-compared.
- **Trust-ledger regression**: CI fails if a previously-`exact` handler degrades, a new taint appears, or a bound starts binding (Spec 04 §7).
- **Self-application of the honesty rule**: every "verified" the tool prints in tests is accompanied by asserted bounds — tests that pin the *caveats*, not only the verdicts.

## When something fails

| Symptom | First suspect | Cross-check |
|---|---|---|
| Checker verdict ≠ walkthrough | checker bug or walkthrough error — both are live options | phase-7 TLC differential on the same IR; re-derive the trace by hand |
| Extracted ≠ hand model | extraction (usually missed guard or domain too coarse) | extraction report's confidence table for the disagreeing transition |
| Replay not-reproduced on an expected bug | harness ordering control (gating, stabilization barrier) before model | run the generated test headed/verbose; check parked-request bookkeeping |
| State count explodes | a domain inferred wider than intended (check `tokens` counts, key window) | trust ledger's domain table; slice stats per property |
