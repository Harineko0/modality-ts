# Spec 09.02 — L2: The Universal Semantic Compiler

Status: current. Part of the `plugin-layering/` series. **Series centerpiece.**
Builds on `00-overview.md` and `01-language-frontend.md`.

## 1. What L2 is

L2 is the layer that turns **Surface IR** (L1) into **`EffectIR` / `ExprIR`** (L0) by owning all
*control-flow and value* modeling, and by delegating every *leaf meaning* to L4 through L3. It is
**universal**: it contains no library string, no hook name, no var-id regex. It is the only place
that knows how an `if` becomes a guarded effect, how a block becomes a sequence, how `a + 1`
becomes arithmetic over an abstract domain, and how a loop is over-approximated.

L2 is embodied by `src/extract/lang/ts/driver/transition/statement-driver.ts` and the expression
compiler it calls. These files already do this job — the library-specific string recognition
(timer/websocket/`startTransition`/`flushSync`) has been extracted into L4 plugins and is
accessed through the L3 dispatch interfaces.

## 2. The leaf-dispatch contract (the heart of the design)

L2 walks Surface IR. At every node that *could* carry library meaning — a `call`, a `jsx` element,
an `assign` to a resolved symbol — L2 asks L3 a question and receives back a fragment of **existing
IR**, which L2 then *embeds in the control flow it is building*.

```ts
// L2 → L3, for a leaf node. L3 fans out to the registered L4 plugins.
interface LeafDispatch {
  // "what does this call mean?" — state writes, effect models, navigation, framework hooks
  interpretCall(call: SurfaceCall, ctx: CompileCtx): LeafEffect | undefined;
  // "what does this expression read?" — selectors, derived reads, hook return values
  interpretExpr(expr: SurfaceExpr, ctx: CompileCtx): LeafValue | undefined;
  // "is this a render boundary / form / framework construct?" — JSX + structural nodes
  interpretBoundary(node: SurfaceNode, ctx: CompileCtx): LeafBoundary | undefined;
}

type LeafEffect = { effect: EffectIR; caveats?: ExtractionCaveat[] };   // pure existing IR
type LeafValue  = { expr: ExprIR;   caveats?: ExtractionCaveat[] };
```

Crucially, **`LeafEffect.effect` is an `EffectIR` for the leaf alone** — `assign var=… expr=…`,
or an enqueue/resolve pair for an async effect. It does **not** contain the surrounding `if`.
L2 owns the `if`. This is the precise division the user asked for: the plugin returns the meaning
of `setX(p)`; L2 wraps it in `EffectIR.if`.

If every L4 plugin declines (`interpretCall` returns `undefined`), L2 applies its **default leaf
rule**: an unrecognized call is an *unknown effect* and is over-approximated per `04-ir-policy.md`
(escape analysis E1 taint), never silently dropped.

## 3. Universal modeling rules

These are the rules L2 owns outright. None of them mention a library.

### 3.1 Numbers and arithmetic
Numeric literals and `+ - * / %` over values in a numeric abstract domain lower to `ExprIR`
arithmetic, reusing the existing numeric abstraction (`src/extract/compile/numeric/`). Operations
that leave the modeled finite domain widen to the domain's `wide` class with a caveat — the
existing `applyInputClassToWideInputVars` / `attachNumericReductions` behavior, now invoked from L2.

### 3.2 Equality and guards
`===`/`!==`/`<`/`>` and boolean `&&`/`||`/`!` lower to `ExprIR` predicates. A predicate used as an
`if` condition or a ternary test becomes a **guard** on the effect(s) it dominates.

### 3.3 `if` / `switch` → `EffectIR.if`
`if (c) T else E` lowers to `EffectIR.if { cond: <c>, then: compile(T), else: compile(E) }`.
`switch` lowers to a right-nested chain of `EffectIR.if` over the discriminant, with `default` as
the innermost `else`. Fallthrough is modeled by sharing the compiled tail. This is today's behavior
in `statement-summary.ts`; L2 keeps it verbatim.

### 3.4 Block → sequence
A `block` lowers to a sequenced `EffectIR` (`seq`), threading the local dataflow environment
left-to-right so that a later statement sees the assignments of an earlier one.

### 3.5 Loops and recursion → over-approximation
Loops (`isLoopStatement`) and self-recursive calls are **over-approximated**:
the loop body is compiled once and its writes are lifted to `havoc`/`choose` over the affected vars,
with a loud caveat. L2 never unrolls unboundedly. This is the existing policy in `statement-driver.ts`.

### 3.6 Local dataflow
`const`/`let` bindings and reassignments are tracked in a per-scope environment mapping symbol →
`ExprIR`. A `ref` to a tracked local resolves to its current `ExprIR`; an untracked or widened
local resolves to `opaque`. This is the substitution that lets `if (a) { setX(p) }` resolve `p` to
whatever `p` was bound to upstream.

## 4. Worked trace: `handleX() { if (a) { setX(p) } }`

Input (after L1 lowering to Surface IR):

```
FunctionDecl handleX
  body = block [ if (cond = ref a) then block [ expr (call setX [ ref p ]) ] ]
```

L2 compilation, step by step:

1. **Enter `handleX` body** → start a `seq` with a fresh dataflow env. Suppose `a` and `p` are
   parameters / upstream locals already in the env as `ExprIR` `read(a)`, `read(p)`.
2. **Hit the `if`.** L2 owns this. It compiles the condition `ref a` → guard `read(a)`. It will
   build `EffectIR.if { cond: read(a), then: <then>, else: noop }`. It does **not** ask any plugin
   about the `if`.
3. **Compile the `then` block** → a nested `seq` with one statement: `expr (call setX [ref p])`.
4. **Hit the leaf `call setX [ref p]`.** L2 calls `LeafDispatch.interpretCall`. L3 fans out to the
   registered L4 state sources. The `useState` source recognizes `setX` (via the binding decoded in
   `decodeBinding`, Spec `03-use-case-spis.md §3`) and returns:
   `LeafEffect { effect: assign { var: "local:C.X", expr: read(p) } }`.
   The plugin saw only the call and its argument — never the `if`.
5. **L2 embeds the leaf.** The `then` branch becomes `seq[ assign var=local:C.X expr=read(p) ]`.
6. **L2 closes the `if`** →
   `EffectIR.if { cond: read(p_guard=read(a)), then: assign(local:C.X, read(p)), else: noop }`.
7. **Result** is exactly the model the engine produces today for this handler — but the only
   library-specific decision (that `setX` writes `local:C.X`) came from a plugin, and everything
   structural came from L2.

This trace is validated against the existing `summarizeSetterCall` / `setterCallFrom` /
`summarizeWrite` path in `statement-summary.ts` and `transition/plugin-calls.ts`; L2 must reproduce
their output byte-for-byte in the identity-preserving phases (Spec `06-migration-roadmap.md`).

## 5. Async, CPS, and effect models

L2 owns the *shape* of asynchronous modeling — the continuation-passing / enqueue-resolve lowering
that turns `await f()` and callback effects into pending vars and resolve transitions (Spec 02). It
does **not** own *which* calls are async effects: a timer (`setTimeout`), a websocket subscription,
or a generic promise are recognized by L4 `EffectPlugin`s (Spec `03-use-case-spis.md §5`),
which return a `LeafEffect` describing the enqueue and the resolution domain. L2 takes that leaf and
performs the CPS lowering uniformly. Timer and WebSocket API names live in
`plugins/effect/timers/recognition.ts` and `plugins/effect/websocket/recognition.ts` — not in the
engine — which keeps `timers.ts` / `environment-callbacks.ts` API-name-free while the CPS lowering
remains universal.

## 6. Determinism and fragment merge

When more than one L4 plugin answers the same leaf (rare, but possible — e.g. a framework hook that
is also a state write), L3 merges the `LeafEffect`s under an **explicit, total precedence order**
(declared in `03-use-case-spis.md §5`) so output is deterministic regardless of plugin registration
order. ID stabilization stays in the engine driver, applied **after** the merge, so overlay
stability (Spec 06 reporter) is unaffected. L2 itself is pure and order-free given a fixed
`LeafDispatch`.

## 7. What L2 must never do

- Import `typescript`, `extract/plugins/*`, or any library package.
- Match a string literal that names a library API.
- Introduce a new `EffectIR`/`ExprIR` node kind (Spec `04-ir-policy.md`).
- Inspect `SurfaceExpr.origin` (that is L4's privilege, via the symbol port).

## 8. Dependency rules

`extract/compile` imports **`core` + `extract/engine/spi`** (for the `LeafDispatch` / SPI contract
types) and nothing else — specifically not `frameworks`, `sources`, or `lang`. It reaches L1 only
through the Surface IR data type and the injected `SymbolPort`. Enforced by dependency-cruiser
(Spec `05-config-and-registry.md §4`).
