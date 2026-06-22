# Spec 09.03 — L3: Use-Case SPIs

Status: draft for review. Part of the `plugin-layering/` series. Builds on `02-semantic-compiler.md`.

## 1. What L3 is

L3 is the catalogue of **purpose-fit adapter contracts** that sit between the universal compiler
(L2) and the library plugins (L4). Each SPI is shaped to *one use case* — discovering state,
recognizing a framework hook, modeling an effect, classifying navigation — so that an L4 author
implements a small, obvious surface rather than a god-interface. L3 lives in
`src/extract/engine/spi/` (today's `index.ts`), alongside the existing `StateSourcePlugin`,
`NavigationAdapter`, `DomainRefinementProvider`, and `EffectApiProvider`.

Every L3 method receives a **pre-resolved, purpose-fit context** — symbols already resolved by L1's
`SymbolPort`, dataflow/arithmetic helpers from L2 — never the raw AST and never the whole pipeline.
This is the existing "narrow context objects" rule (Spec 05 §4), applied to the new SPIs.

This series **adds** two SPIs (`FrameworkPlugin`, `EffectModelProvider`), **extends** two
(`StateSourcePlugin.decodeBinding`, `NavigationAdapter.recognizeFormSubmit`), and leaves
`DomainRefinementProvider` / `EffectApiProvider` unchanged.

## 2. New: `FrameworkPlugin` — "React is just a plugin"

The single largest decoupling: the React hook tables in `ast.ts:13-157`, the effect-phase ordinals
in `transition/effects.ts:313`, and the Suspense/`React.lazy`/`use` recognition in
`react-source-transitions.ts` all collapse into one L4 plugin behind this SPI.

```ts
interface FrameworkPlugin extends ModalityAdapterBase {     // id, version, packageNames
  // Hook recognition — import-alias-aware via L1's importBinding (Spec 01 §4).
  recognizeHook(call: SurfaceCall, ctx: FrameworkCtx): HookCall | undefined;
  // Render-boundary recognition — <Suspense>, React.lazy(), use().
  recognizeRenderBoundary(node: SurfaceNode, ctx: FrameworkCtx): RenderBoundary | undefined;
  // Component / hook declaration shape (componentNameFor, custom-hook naming).
  classifyComponent?(decl: SurfaceDecl, ctx: FrameworkCtx): ComponentRole | undefined;
}

interface HookCall {
  hook:
    | { kind: "state"; /* useState/useReducer/useRef → handed to the state source */ }
    | { kind: "effect"; phase: number }              // useEffect=1, useLayoutEffect/useInsertion=0
    | { kind: "transition" }                         // useTransition / startTransition
    | { kind: "deferred" }                           // useDeferredValue
    | { kind: "callback"; handler: NodeRef }         // useCallback unwrap target
    | { kind: "context" };                           // useContext
  origin: NodeRef;
}

interface RenderBoundary {
  kind: "suspense" | "lazy" | "use";
  // The boundary's gating domain in pure existing IR (the old SUSPENSE-domain decl).
  domain?: AbstractDomain;
  origin: NodeRef;
}
```

The react plugin's name tables are seeded directly from the current hardcoded values:
`ast.ts:13-157` (hook names), `transition/effects.ts:313` (`reactEffectPhase`), and the Suspense
domain currently constructed inline in `react-source-transitions.ts`. The L2 compiler asks
`recognizeHook` / `recognizeRenderBoundary` and wraps the result in control flow; it keeps the
*generic* `gateTransitionForBoundary` logic (boundary gating is universal — only *what is a
boundary* is library-specific).

## 3. Extended: `StateSourcePlugin.decodeBinding` — kill the var-id regex

`context.ts:27-44` (`setterBindingFromDecl`) hardcodes the var-id *shape* of every library:
`local:`, `atom:`, `atom-family:`, `swr:`. Each shape is owned by exactly one source plugin, so the
plugin should decode it:

```ts
interface StateSourcePlugin {
  // …existing: discover, domainHints?, writeChannels, summarizeWrite?, template?, harness, conformance?
  decodeBinding?(decl: StateVarDecl): SetterBinding | undefined;   // owns this source's var-id shape
}
```

The engine asks each plugin's `decodeBinding` until one claims the decl (matched by the same
package/id provenance the registry already stamps). `useState`'s plugin owns `local:`; Jotai owns
`atom:` / `atom-family:`; SWR owns `swr:`. The regex block in `context.ts` is deleted; the fallback
(`decl.id` verbatim) stays in the engine for unclaimed decls. This is identity-preserving:
`decodeBinding` returns the *same* `SetterBinding` fields the regex produced today.

## 4. Extended: `NavigationAdapter.recognizeFormSubmit`

Router form semantics (`<Form>`, `useSubmit`, `useActionData`) live today in the engine's
`router-submit.ts` path. They are router-specific, so they move behind the existing
`NavigationAdapter`:

```ts
interface NavigationAdapter {
  // …existing: discoverRoutes, classifyNavigationCall, locationVars, harness, …
  recognizeFormSubmit?(node: SurfaceNode, ctx: NavCtx): FormSubmit | undefined;
}

interface FormSubmit {
  action?: RouteRef;                 // resolved target route, if statically known
  effect: EffectIR;                  // the submit's modeled effect (pure existing IR)
  caveats?: ExtractionCaveat[];
}
```

L2 treats a recognized form submit as a leaf (`interpretBoundary`), wrapping the returned `effect`
in whatever control flow surrounds the JSX. The generic navigation lowering
(`buildLocationLowering`, role-bearing location vars) stays in the engine.

## 5. New: `EffectModelProvider` — timers, websockets, environment callbacks

Timer (`setTimeout`/`setInterval`) and websocket recognition is inlined in
`statement-summary.ts` / `timers.ts` / `environment-callbacks.ts`. The *recognition* is
library/environment-specific; the *CPS lowering* (enqueue → pending var → resolve transition) is
universal and stays in L2 (Spec `02-semantic-compiler.md §5`). The SPI carries only recognition:

```ts
interface EffectModelProvider extends ModalityAdapterBase {
  kind: "effect-model";
  recognizeEffect(call: SurfaceCall, ctx: EffectCtx): EffectModel | undefined;
}

interface EffectModel {
  channel: "timer" | "websocket" | "promise" | string;   // names a modeled effect class
  enqueue: EffectIR;             // what firing the effect schedules (pure existing IR)
  resolution: { domain: AbstractDomain; effect: EffectIR };  // the resolve transition's payload
  caveats?: ExtractionCaveat[];
}
```

L2 takes `enqueue` + `resolution` and performs the standard pending-var / resolve-transition
construction, identically to today.

## 6. The L3 → L4 fan-out and precedence

L3 owns the dispatch loop and a **total precedence order** for the case where multiple L4 plugins
answer the same leaf (Spec `02-semantic-compiler.md §6`). The order is fixed and declared here so it
is a spec fact, not an emergent property of registration:

1. `FrameworkPlugin.recognizeHook` (a hook is structurally distinctive; wins first)
2. `StateSourcePlugin.summarizeWrite` (state writes)
3. `NavigationAdapter` (navigation calls / form submits)
4. `EffectModelProvider.recognizeEffect` (timers/websockets/promises)
5. default leaf rule (unknown call → E1 taint)

Within a category, ids are resolved in sorted order (the registry already sorts, `registry/index.ts`
`sortedUnique`), and a duplicate claim on the same node with *different* IR is a hard error surfaced
as a caveat, never a silent pick.

## 7. Context objects

| SPI method | Receives | Never receives |
|---|---|---|
| `recognizeHook` / `recognizeRenderBoundary` | `SurfaceCall`/`SurfaceNode`, `SymbolPort`, `importBinding` | raw `ts.Node`, pipeline |
| `summarizeWrite` / `decodeBinding` | `SurfaceCall` / `StateVarDecl`, resolved setter env, L2 expr helper | other plugins' state |
| `recognizeFormSubmit` | `SurfaceNode`, route inventory view | the model under construction |
| `recognizeEffect` | `SurfaceCall`, L2 CPS helper handle | the pending-var table directly |

Each context is a narrow object assembled by the engine driver, never the whole `CompileCtx`.

## 8. Unchanged SPIs

`DomainRefinementProvider` (`refineDomain`) and `EffectApiProvider` (`discoverEffectApis`) keep
their current contracts (`src/extract/engine/spi/index.ts`). Zod/ArkType refinement and effect-API
discovery already match the leaf-meaning philosophy and need no change.
