# Spec 09.04 — IR Policy for Plugins

Status: draft for review. Part of the `plugin-layering/` series. Normative companion to Spec 05 §3
("plugins contribute IR *instances*, never IR *semantics*").

## 1. The rule

A plugin (any L4 adapter) may emit **only instances of existing `EffectIR` / `ExprIR` node kinds
and existing `AbstractDomain` classes** (Spec 01). It may **never** introduce a new node kind, a new
domain class, or a new transition shape. This is non-negotiable because the Rust checker
(`crates/checker`), the TLA+/SMV exporter, and the replay generator must understand every construct
they receive; an extensible-semantics IR would let a plugin silently change what "verified" means.

The layering in this series is *built on* this rule, not an exception to it: L2 owns the only code
that constructs control-flow IR; L4 returns leaf fragments that are, by construction, instances.

## 2. Imprecision lowers, it does not extend

When a plugin cannot model something precisely, it does not invent a node — it **over-approximates
using existing constructs** and emits a loud caveat:

| Situation | Lowering | Caveat |
|---|---|---|
| Unknown write target | `havoc` over the affected var(s) | `global-taint` / `unextractable` |
| Value outside the modeled finite domain | widen to the domain's `wide` class | `stale-read` / numeric-widen |
| Nondeterministic choice the plugin can't resolve | `choose` over the candidate set | model-imprecision |
| Call whose effect is entirely unknown | `opaque` effect + E1 taint | `global-taint` |

`havoc` / `choose` / `opaque` are existing kernel constructs. The plugin's *only* freedom is which
existing construct best over-approximates — never a new one.

## 3. Soundness tie-in (E1)

Spec 02 §5's escape analysis (E1) guarantees that a write the engine fails to recognize is treated
as an unknown call → taint → loud over-approximation, never a silent miss. The layering preserves
E1 in both directions:

- **Under-declared write channels** (a plugin forgets to list a setter): the call falls through L3's
  fan-out to L2's **default leaf rule** (Spec 03 §6, step 5) → unknown effect → E1 taint. Loud, not
  silent.
- **A wrong `summarizeWrite` / `interpretCall`** (a plugin returns *incorrect* IR): caught by the
  conformance probes and `modality conform` per-transition pass-rates (Spec 04 §5). This is the one
  failure mode E1 cannot catch, and it is exactly what conformance exists for. Plugin authors are
  part of the trusted base; the SPI doc comments say so.

The net invariant the user cares about: **a leaf interpreter that under-approximates taints
loudly.** No phase of the migration may weaken this; the verification gate for every phase
(Spec 06) includes the E1 taint tests.

## 4. The kernel-RFC carve-out

A library whose semantics genuinely don't fit any existing IR construct — Spec 05 §3's example is
websocket subscription *streams* — requires a **kernel RFC**: a coordinated change across
`core/ir`, the Rust checker, the exporter, and the replay generator, shipped as a deliberate minor
version. It is never a plugin patch. The `EffectPlugin` SPI (Spec 03 §5) deliberately models
websockets within *existing* CPS constructs precisely so that the common case does **not** need an
RFC; the RFC path remains for the genuinely novel.

This carve-out is the pressure-relief valve that lets the IR stay frozen: plugin authors who hit the
wall get a real, governed path forward instead of being tempted to smuggle semantics through a
loosely-typed escape hatch.

## 5. Provenance

Because plugins are trusted code that shapes the model, every plugin that contributed is stamped
into the model's `metadata.plugins` (`PluginProvenance`, `src/core/ir/types.ts:144-157`) and into
the trust ledger. This series adds `"framework"` and `"effect-model"` to the `PluginProvenance.kind`
union (Spec `05-config-and-registry.md §3`) so the report can say which framework and which effect
models produced the model — same accountability the existing kinds already carry.

## 6. Checklist for plugin authors

- [ ] Every emitted effect is an instance of an existing `EffectIR` kind.
- [ ] Imprecision uses `havoc` / `choose` / `opaque`, each with a caveat.
- [ ] No string in the plugin names a *kernel* construct that doesn't already exist.
- [ ] `writeChannels` lists every write API (omissions cause taint, not silent miss).
- [ ] Conformance probes pin `testedVersions` against the app lockfile.
