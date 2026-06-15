# Rust Checker IR Runtime

## Goal

Implement the Rust runtime that executes the framework-neutral Modality IR: model decoding, finite domains, compact states, expression evaluation, structured effects, navigation, pending operations, token generation, canonical identity, and internal-transition stabilization.

## Non-goals

- Do not implement full BFS search in this plan.
- Do not call JavaScript for predicates or opaque effects.
- Do not add framework-specific branches for React, SWR, routers, Jotai, or future sources.
- Do not preserve JSON-string canonicalization as the hot-path state identity.

## Current-state findings

- IR types are defined in `src/core/ir/types.ts`.
- Domain enumeration and validation currently live in `src/core/ir/domains.ts` and `src/core/ir/validator.ts`.
- Canonical state encoding currently lives in `src/core/ir/canonical.ts` and uses sorted JSON.
- Runtime execution currently lives in `src/check/runtime/*.ts`.
- Stabilization semantics currently live in `src/check/engine/stabilize.ts`.

## Exact file paths and relevant symbols

- `src/core/ir/types.ts`: `Model`, `AbstractDomain`, `ExprIR`, `EffectIR`, `Transition`.
- `crates/checker/src/model.rs`: Rust model structs and dense model index.
- `crates/checker/src/domain.rs`: domain validation and enumeration.
- `crates/checker/src/state.rs`: compact value/state representation.
- `crates/checker/src/expr.rs`: expression evaluator.
- `crates/checker/src/effect.rs`: effect evaluator.
- `crates/checker/src/navigation.rs`: route/history semantics.
- `crates/checker/src/canon.rs`: canonical binary encoder.
- `crates/checker/src/stabilize.rs`: internal run-to-completion.

## Existing patterns to follow

- Match Spec 03 macro-step semantics and deterministic ordering.
- Treat extraction sources as IR producers only; Rust should know nothing about where variables came from.
- Preserve token-renaming symmetry reduction across the whole state.
- Preserve route-local mount semantics and `UNMOUNTED` handling.

## Atomic implementation steps

1. Define Rust model and IR data structures.

   Files to edit:
   - `crates/checker/src/model.rs`
   - `crates/checker/src/lib.rs`

   Implementation:
   - Mirror the serialized shape from `src/core/ir/types.ts` using serde-tagged enums.
   - Build a `CompiledModel` that maps variable IDs and transition IDs to dense integer indexes.
   - Pre-sort non-internal and internal transitions by ID during compilation.
   - Precompute each transition's read/write var indexes, route scope metadata, and triggered-by var indexes.
   - Return structured compile errors for unknown vars, invalid domains, duplicate IDs, and unsupported effect kinds.

2. Implement finite domain validation and enumeration.

   Files to edit:
   - `crates/checker/src/domain.rs`
   - `crates/checker/src/state.rs`

   Implementation:
   - Implement `enumerate_domain(domain) -> Vec<Value>` for bool, enum, boundedInt, option, record, tagged, tokens, lengthCat, and boundedList.
   - For records and tagged variants, emit fields in deterministic schema order.
   - Validate initial values against domains at model compile time.
   - Represent tokens as bounded symbolic strings initially, then normalize them in canonical encoding.
   - Use this enumeration for initial states and `havoc`; do not duplicate domain expansion in effect code.

3. Implement compact state and value storage.

   Files to edit:
   - `crates/checker/src/state.rs`

   Implementation:
   - Store a state as `Vec<Value>` indexed by compiled var index.
   - Implement path read/write helpers for records, tagged records, and bounded lists.
   - Implement copy-on-write updates by cloning only the state vector and changed nested value path.
   - Provide `changed_vars(pre, post)` using dense indexes rather than string IDs.
   - Provide conversion from compact state to JSON object only for trace/report serialization.

4. Implement expression evaluation.

   Files to edit:
   - `crates/checker/src/expr.rs`

   Implementation:
   - Evaluate `lit`, `read`, `eq`, `neq`, `and`, `or`, `not`, `cond`, `updateField`, `tagIs`, `lenCat`, and `freshToken`.
   - Compare values structurally, not through JSON strings.
   - Short-circuit `and`, `or`, and `cond`.
   - Resolve reads by dense var index and path.
   - Implement `freshToken` by scanning current state values for the token domain and selecting the first unused token within the domain bound.

5. Implement structured effect execution.

   Files to edit:
   - `crates/checker/src/effect.rs`
   - `crates/checker/src/navigation.rs`

   Implementation:
   - Implement `assign`, `havoc`, `choose`, `if`, `seq`, `enqueue`, `dequeue`, and `navigate`.
   - For `seq`, feed all branch outputs from one effect into the next in deterministic order.
   - For `enqueue`, enforce `model.bounds.maxPending` and include evaluated op args in the pending record.
   - For `navigate`, update route/history and mount/unmount route-local variables according to the current TS semantics.
   - Reject `opaque` effects with an unsupported-model error; do not bridge to JavaScript.

6. Implement route mounting and transition enabled checks.

   Files to edit:
   - `crates/checker/src/model.rs`
   - `crates/checker/src/expr.rs`

   Implementation:
   - Implement `route_local_mounted(model, transition, state)`.
   - A transition is enabled when its route scope is mounted and its guard evaluates truthy.
   - Non-internal transition iteration must use pre-sorted transition order.
   - Internal transition candidate lookup must use triggered-by indexes computed during model compilation.

7. Implement canonical binary state identity.

   Files to edit:
   - `crates/checker/src/canon.rs`

   Implementation:
   - Encode vars in declaration order.
   - Encode values by domain with explicit tags for null, booleans, ints, strings/enums, records, tagged variants, lists, and unmounted values.
   - Rename token values to first-use order across the whole state before encoding.
   - Return canonical bytes plus a stable hash derived from those bytes.
   - Never use hash-only equality; visited storage must compare full canonical bytes.

8. Implement internal stabilization.

   Files to edit:
   - `crates/checker/src/stabilize.rs`
   - `crates/checker/src/effect.rs`

   Implementation:
   - Start from `(state, changed_vars)` and iterate up to `maxInternalSteps`.
   - Candidate internal transitions are always-triggered internals plus transitions triggered by changed vars.
   - Filter candidates by route mount, triggered-by, and guard.
   - If enabled internals have disjoint writes, apply them in sorted order; if writes conflict, explore all deterministic permutations.
   - Dedupe stabilized candidates by canonical bytes after each internal round.
   - Return an error if stabilization does not quiesce within the bound.

## Acceptance criteria

- Rust can parse, validate, and compile a model artifact without TypeScript semantic help.
- Rust can enumerate initial stabilized states for structured models.
- Rust can evaluate every current non-opaque `ExprIR` and `EffectIR` variant.
- Canonical identity is binary/domain-aware and deterministic.
- Runtime modules contain no framework-specific logic.

## Tests to add or update

- Rust unit tests for each domain variant and invalid initial values.
- Rust unit tests for structural equality and path read/write.
- Rust unit tests for each expression and effect variant.
- Rust unit tests for token canonicalization and stabilization conflict ordering.

## Verification commands

- `rtk cargo test -p modality-checker`
- `rtk pnpm build`

## Risks, ambiguities, and stop conditions

- Stop and report if navigation semantics depend on data not represented in `Model`.
- Stop and report if any required current example uses `opaque` effects and cannot be lowered to structured IR.
- Do not solve unsupported semantics by calling back into TypeScript.
