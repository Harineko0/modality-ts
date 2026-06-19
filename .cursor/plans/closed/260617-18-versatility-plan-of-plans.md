# Modality-ts Versatility Plan of Plans

Status: strategic planning guideline.
Date: 2026-06-17.

This is not an implementation plan for one feature. It is a guideline for
writing future plans so `modality-ts` becomes broadly applicable across many
TypeScript web codebases without accumulating one-off framework patches.

The core rule:

> Model stable semantic contracts first; use real applications as canaries, not
> as the primary design oracle.

## 1. Principles

These principles override compatibility-preserving instincts:

1. Prefer fundamental architecture changes over stopgap fixes.
2. Abstract over families of libraries and frameworks instead of overfitting to
   one package.
3. Do not preserve backward compatibility when it blocks a cleaner model.
4. Treat missed writes to modeled state as the dangerous failure mode.
5. Prefer structured IR, structured caveats, and explicit adapter contracts over
   warning-string parsing, ad hoc metadata, or hidden conventions.
6. Use the TypeScript compiler and TypeChecker as the source of TypeScript
   semantics. Do not reimplement broad TypeScript behavior from syntax alone.
7. Use official library references to define intended public semantics, then
   prove the abstraction with small conformance fixtures.
8. Run real apps regularly, but only to reveal missing abstraction boundaries,
   environment assumptions, and integration failures.

## 2. Why this plan exists

Recent plans show useful progress but also a risk pattern:

- Navigation, route scope, effects, schemas, numeric domains, server actions,
  and library adapters have often been improved after applying the tool to a
  concrete app and patching discovered gaps.
- That loop is valuable for discovery, but dangerous as the main development
  mode. It can create a pile of local fixes whose assumptions are hard to
  generalize.
- The better recent direction is visible in semantic project context,
  mount-local scopes, generic navigation adapter hooks, structured caveats,
  type-library refinement providers, and framework-neutral checker semantics.

Future plans should therefore be written to deepen these abstraction layers
before adding more library-shaped surface area.

## 3. Planning layers

Every future plan should identify which layer it changes. A plan that spans
several layers must split into atomic parts.

| Layer | Purpose | Examples |
| --- | --- | --- |
| Semantic substrate | Represent project, type, module, and symbol facts generically | `ts.Program`, `ts.TypeChecker`, import graph, client/server module roles |
| Core IR and checker | Framework-neutral transition-system semantics | domains, scopes, mount guards, pending ops, effect evaluation, slicing |
| Extraction engine | Generic lowering and analysis mechanisms | handler summary, escape analysis, effect APIs, route lowering, structured caveats |
| Adapter SPI | Explicit contracts for library/framework plugins | navigation adapters, state sources, schema/domain providers, effect providers |
| Source adapters | Library-specific recognition mapped onto generic contracts | React Router, Next, Zod, ArkType, Zustand, XState |
| Conformance suite | Small canonical fixtures proving semantic claims | batching, effects, route layouts, schema bounds, server actions |
| Real-app canaries | Integration checks against representative apps | tsconfig quirks, package versions, dynamic imports, monorepos |
| Documentation | User-facing truth and internal specification | docs, specs, trust ledger, known abstractions |

## 4. Required shape for future implementation plans

Each implementation plan should include these sections.

### 4.1 Semantic source of truth

State what defines correct behavior:

- TypeScript behavior: TypeScript compiler API / TypeChecker behavior.
- React behavior: React public docs plus targeted conformance fixtures.
- Framework behavior: official framework docs and stable source conventions.
- Library behavior: official docs, public API contracts, and small fixtures.

If the source of truth is a real app bug, the plan must translate it into a
general semantic rule before implementation starts.

### 4.2 Abstraction boundary

State the generic abstraction being added or reused:

- IR concept.
- checker rule.
- extraction engine mechanism.
- adapter SPI hook.
- source-provider contract.
- structured caveat/reporting shape.

Reject a plan that only says "recognize this library call and special-case it"
unless it proves the case is truly library-local and cannot inform a reusable
abstraction.

### 4.3 Non-goals and deletions

Because backward compatibility is not a constraint, plans should explicitly list:

- old APIs or data shapes to remove;
- obsolete warning paths to delete;
- tests or docs that should be rewritten because the model changes;
- generated artifacts that must not be touched.

Do not add compatibility shims unless there is a concrete short-lived migration
reason inside the same branch.

### 4.4 Conformance fixtures before app debugging

Each new semantic claim needs focused fixtures before broad app trials.

Good fixtures are small and canonical:

- one React batching fixture;
- one Next layout/template fixture;
- one Zod finite numeric-chain fixture;
- one Zustand selector/action fixture;
- one server action form fixture;
- one tsconfig paths fixture.

Bad fixtures are whole apps whose failure only proves that something broke
somewhere.

### 4.5 Real-app canary role

Real apps should be used after the semantic fixture is green.

When a real app fails, classify the failure:

1. Missing semantic abstraction.
2. Missing adapter method.
3. Missing syntax recognition for an already-supported abstraction.
4. Incorrect checker/IR behavior.
5. State-space explosion or slicing failure.
6. Environment, package, tsconfig, or filesystem integration issue.
7. Unsupported app behavior that needs an explicit caveat.

Only item 3 should normally produce a small library-local patch. Items 1, 2, 4,
and 5 require a deeper plan.

## 5. Roadmap of future plans

The following are plan families, not single commits. Each family should produce
one or more concrete implementation plans.

### Plan Family A — Semantic TypeScript Foundation

Goal: make extraction depend on semantic TypeScript facts instead of repeated
local AST guesses.

Future plans should:

- make `ts.Program` and `ts.TypeChecker` available throughout extraction;
- canonicalize file paths, module resolution, `baseUrl`, `paths`, project
  references, JSON/JSONC config, and type-only imports;
- expose symbol identity through SPI contexts;
- migrate domain inference, setter binding, component resolution, and import
  classification to semantic lookup;
- delete duplicated syntax-only alias maps where the TypeChecker can answer the
  question.

Acceptance direction:

- broad TS behavior is tested through compiler-backed fixtures;
- syntax-only fallbacks remain only for cases where a `ts.Program` is unavailable
  and are reported as lower confidence.

### Plan Family B — Framework-Neutral IR and Checker Semantics

Goal: keep the trusted Rust checker and IR independent of React, Next, or any
specific library.

Future plans should:

- generalize mount-local state, phase ordering, pending operation args, and
  route-tree state as neutral semantics;
- remove framework vocabulary from core IR and Rust code;
- ensure slicing understands every new generic dependency form;
- keep TLA export and checker semantics in lockstep;
- reject source-adapter changes that require hidden checker knowledge.

Acceptance direction:

- every new checker concept has at least one non-React interpretation;
- framework adapters map their semantics into numeric/string-neutral IR fields.

### Plan Family C — Adapter SPI Consolidation

Goal: make library/framework support a matter of filling explicit contracts.

Future plans should define or refine SPIs for:

- navigation and route topology;
- state sources;
- effect API discovery;
- schema/domain refinement;
- client/server module boundaries;
- cache/storage abstractions;
- replay harness observation;
- structured caveats and confidence metadata.

Delete private cross-slice imports when an SPI is missing. Add the SPI instead.

Acceptance direction:

- each adapter can be tested with a small harness;
- adapter output is plain IR plus structured caveats;
- adapters never mutate global extraction behavior implicitly.

### Plan Family D — Domain and Data Abstraction

Goal: make the tool useful on real code without exploding the state vector or
guessing unsound domains.

Future plans should:

- centralize semantic domain mapping from TypeScript types;
- make schema libraries domain-refinement providers, not state sources;
- represent numeric reductions, predicate abstractions, finite payload domains,
  and field pruning as generic mechanisms;
- use caveats for unprovable or dynamic constraints;
- avoid guessed numeric ranges, guessed object shapes, or guessed array lengths.

Acceptance direction:

- unknown data becomes explicit tokens or refined predicates;
- every narrowing is traceable to a type, schema, overlay, or source adapter.

### Plan Family E — Effects, Async, and Environment Semantics

Goal: model web-app behavior that creates race conditions without baking in one
framework's runtime.

Future plans should:

- express timers, WebSockets, server actions, fetches, cache invalidation,
  Suspense-like suspension, and transition/deferred work through generic pending
  ops, finite system vars, and environment transitions;
- make stale closure, batching, and continuation snapshots explicit IR/checker
  behavior;
- classify unsupported effect behavior as structured caveats rather than silent
  drops.

Acceptance direction:

- every async split has explicit enqueue/dequeue semantics;
- every environment transition has a bounded domain and clear confidence.

### Plan Family F — Conformance Matrix

Goal: replace broad app debugging as the main verification method.

Future plans should create a conformance matrix with rows for semantic features
and columns for supported libraries/frameworks.

Example rows:

- local state and setter semantics;
- component mount/reset scope;
- handler batching and functional updater behavior;
- effects and cleanup;
- async continuation behavior;
- route navigation and history;
- form submit/action behavior;
- cache invalidation;
- schema-derived finite domains;
- store selectors and actions;
- unsupported behavior reporting.

Acceptance direction:

- a feature is not "supported" until its conformance fixture exists;
- real app failures add rows or variants to the matrix, not one-off patches.

### Plan Family G — Real-App Canary Suite

Goal: preserve contact with real app complexity without letting it control the
architecture.

Future plans should define a small, curated canary set:

- one React Router app;
- one Next App Router app;
- one Next Pages Router app;
- one app with external stores;
- one app with schemas and forms;
- one app with server actions/effect APIs;
- one app with unusual tsconfig/module layout.

Each canary should record:

- dependencies and versions;
- extraction command;
- expected coverage thresholds;
- accepted caveats;
- state-space budget;
- known unsupported features.

Canary failures should open or update an abstraction-level plan.

### Plan Family H — State-Space Economics

Goal: ensure added versatility does not make checking unusable.

Future plans should treat every new state source or system var as a state-space
budget decision.

Required mechanisms:

- property-focused slicing;
- read/write dependency tracking;
- bounded pending queues;
- route and mount-scope pruning;
- field pruning;
- contributor reports;
- explicit model-slack caveats when precision is bounded.

Acceptance direction:

- new features prove they disappear from unrelated property slices;
- state-space growth is measured in tests or canaries.

### Plan Family I — Trust Ledger and Documentation

Goal: make extraction confidence inspectable.

Future plans should keep docs and reports aligned:

- structured caveats are emitted where the imprecision is created;
- reports partition exact, over-approx, unextractable, overlay, and ignored
  surfaces;
- docs describe the current model, not historical exclusions;
- internal specs are updated in the same plan that changes semantics.

Acceptance direction:

- no regex-parsed warning strings;
- no stale docs claiming unsupported behavior after it becomes modeled;
- every approximation is visible to users.

## 6. Anti-patterns to reject

Reject future plans that primarily do any of the following:

- add a framework-specific field to core IR when a neutral concept would work;
- parse warning strings into report data;
- patch a library call without naming the semantic abstraction it belongs to;
- guess a domain from a broad `number`, `string`, object, array, or payload type;
- silently drop writes that escape analysis;
- model a server/runtime feature by executing app code;
- expand state space without a slicing story;
- update tests by blanket-regenerating snapshots without explaining the semantic
  delta;
- keep old APIs around only because existing tests expect them.

## 7. Plan-review checklist

Before approving any future implementation plan, answer these questions:

1. What semantic contract is being modeled?
2. Is the source of truth TypeScript compiler behavior, official library docs,
   conformance fixtures, or a real-app observation?
3. What generic abstraction changes, if any?
4. Could another framework or library use the same abstraction?
5. What old code path becomes obsolete and should be removed?
6. What is the smallest conformance fixture that proves the behavior?
7. What real-app canary should run after fixtures pass?
8. How does slicing avoid unrelated state-space growth?
9. What caveats are emitted for unsupported or approximate cases?
10. What docs/specs must change in the same plan?

If a plan cannot answer these questions, it is not ready.

## 8. Default verification ladder

Future plans should pick the relevant subset, but the default order is:

```bash
rtk pnpm typecheck
rtk pnpm test
rtk pnpm architecture
rtk pnpm phase7
rtk pnpm ci:examples
rtk pnpm fix
rtk git diff --check
```

For checker or IR semantic changes, `phase7` is mandatory before handoff.

For extraction-only adapter changes, run targeted conformance fixtures first,
then the relevant canary app checks.

For docs-only planning work, inspect the final diff and do not run the full
suite unless executable behavior changed.

## 9. Success criteria for this meta-plan

This guideline is working when future closed plans show these traits:

- fewer app-specific bug-fix plans;
- more plans that introduce reusable semantic layers;
- clearer deletion of old stopgap paths;
- conformance fixtures added before broad app debugging;
- real-app failures classified into abstraction-level causes;
- docs and trust-ledger behavior updated with semantic changes;
- adapters becoming thinner because the engine owns more generic behavior.

The intended long-term shape is simple: source adapters recognize public library
syntax and semantics, the extraction engine lowers through explicit contracts,
and the checker reasons over a compact framework-neutral IR.
