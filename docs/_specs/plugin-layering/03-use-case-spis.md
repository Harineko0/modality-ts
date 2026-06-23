# Spec 09.03 — L3: Use-Case SPIs

Status: current. Part of the `plugin-layering/` series. Builds on `02-semantic-compiler.md`.

## 1. What L3 is

L3 is the catalogue of **purpose-fit adapter contracts** that sit between the universal compiler
(L2) and the library plugins (L4). Each SPI is shaped to *one use case* — discovering state,
recognizing a framework hook, modeling an effect, classifying navigation — so that an L4 author
implements a small, obvious surface rather than a god-interface. L3 lives in
`src/extract/engine/spi/` (`index.ts`, `framework.ts`, `effect-model-runtime.ts`, etc.),
alongside the established `StateSourcePlugin`, `RoutePlugin`, `TypePlugin`,
`EffectPlugin`, and `EffectApiProvider`.

Every L3 method receives a **pre-resolved, purpose-fit context** — symbols already resolved by L1's
`SymbolPort`, dataflow/arithmetic helpers from L2 — never the raw AST and never the whole pipeline.
This is the existing "narrow context objects" rule (Spec 05 §4), applied to the new SPIs.

There is **no top-level `handler` category**. React Hook Form and similar form-handler libraries
are facets of the `FrameworkPlugin`, not a separate plugin kind.

## 2. `FrameworkPlugin` — "React is just a plugin"

The single largest decoupling: the React hook tables in `ast.ts`, the effect-phase ordinals
in `transition/effects.ts`, and the Suspense/`React.lazy`/`use` recognition all collapse into one
L4 plugin behind this SPI.

```ts
interface FrameworkPlugin extends ModalityAdapterBase {     // id, version, packageNames
  kind: "framework";
  // Hook recognition — import-alias-aware via L1's importBinding (Spec 01 §4).
  recognizeHook(call: SurfaceCall, ctx: FrameworkCtx): HookCall | undefined;
  // Render-boundary recognition — <Suspense>, React.lazy(), use().
  recognizeRenderBoundary(node: SurfaceNode, ctx: FrameworkCtx): RenderBoundary | undefined;
  // Component / hook declaration shape (componentNameFor, custom-hook naming).
  classifyComponent?(decl: SurfaceDecl, ctx: FrameworkCtx): ComponentRole | undefined;
  // Unwrap library-wrapped handler expressions (e.g. RHF handleSubmit).
  unwrapHandler?(expr: SurfaceExpr, ctx: UnwrapHandlerCtx): SurfaceExpr | undefined;
}

interface HookCall {
  hook:
    | { kind: "state" }              // useState/useReducer/useRef → handed to state source
    | { kind: "effect"; phase: number }   // useEffect=1, useLayoutEffect/useInsertion=0
    | { kind: "transition" }         // useTransition
    | { kind: "start-transition" }   // startTransition
    | { kind: "flush-sync" }         // flushSync
    | { kind: "deferred" }           // useDeferredValue
    | { kind: "callback"; handler: NodeRef }  // useCallback unwrap target
    | { kind: "context" };           // useContext
  origin: SourceAnchor;
}

interface RenderBoundary {
  kind: "suspense" | "lazy" | "use";
  domain?: AbstractDomain;
  origin: SourceAnchor;
}
```

TS-AST-specific facets (e.g. `unwrapCallbackExpr`, `isMemoValueCall`, `isContextReadCall`)
are added via the `EngineFrameworkPlugin` extension interface in
`src/extract/engine/ts/framework-ts-bridge.ts`. React Hook Form is wired by calling
`extendFrameworkWithTsUnwrap(plugin, unwrapReactHookFormHandler)` — there is no separate
`FrameworkPlugin` subkind for handler libraries.

## 3. `StateSourcePlugin.decodeBinding` — kill the var-id regex

`decodeSetterBinding` in `context.ts` previously hardcoded the var-id *shape* of every library:
`local:`, `atom:`, `atom-family:`, `swr:`. Each shape is owned by exactly one source plugin, so the
plugin decodes it:

```ts
interface StateSourcePlugin {
  // …existing: discover, domainHints?, writeChannels, summarizeWrite?, template?, harness, conformance?
  decodeBinding?(decl: StateVarDecl): DecodedSetterBinding | undefined;
  /** True when this plugin owns component-local (file-scoped) state bindings. */
  isLocalStateSource?: boolean;
  /** Returns true when varId belongs to the given component (owner of local scope). */
  isComponentScopedVarId?(varId: string, component: string): boolean;
}
```

The engine asks each plugin's `decodeBinding` until one claims the decl. `useState`'s plugin
sets `isLocalStateSource: true` and implements `isComponentScopedVarId` to own the `local:`
prefix — the engine no longer hardcodes `plugin.id === "use-state"` or
`varId.startsWith("local:")`.

## 4. `RoutePlugin.recognizeFormSubmit`

Router form semantics (`<Form>`, `useSubmit`, `useActionData`) live behind the `RoutePlugin`:

```ts
interface RoutePlugin {
  // …existing: discoverRoutes, classifyNavigationCall, locationVars, harness, …
  recognizeFormSubmit?(node: SurfaceNode, ctx: NavCtx): FormSubmit | undefined;
}

interface FormSubmit {
  kind: "submit";
  transitions: Transition[];
  caveats?: ExtractionCaveat[];
}
```

L2 treats a recognized form submit as a leaf, wrapping the returned transitions in whatever
control flow surrounds the JSX. The generic navigation lowering (`buildLocationLowering`,
role-bearing location vars) stays in the engine.

## 5. `EffectPlugin` — timers, websockets, environment callbacks

Timer (`setTimeout`/`setInterval`) and WebSocket recognition live in
`plugins/effect/timers/recognition.ts` and `plugins/effect/websocket/recognition.ts`. The
*recognition* is library/environment-specific; the *CPS lowering* (enqueue → pending var →
resolve transition) is universal and stays in L2.

```ts
interface EffectPlugin extends ModalityAdapterBase {
  kind: "effect";
  recognizeEffect(call: EffectSurfaceCall, ctx: EffectCtx): EffectRecognition | undefined;
  recognizeEffectAssignment?(stmt: SurfaceStmt, ctx: EffectCtx): EffectAssignmentRecognition | undefined;
}

interface EffectRecognition {
  model: {
    channel: "timer" | "websocket" | "promise" | string;
    enqueue: EffectIR;
    resolution: { domain: AbstractDomain; effect: EffectIR };
  };
  scheduleSummary: EffectSummary;
}
```

TS-AST-specific facets for effect plugins (e.g. `getSetterTaints`,
`handlerSchedulesModeledEffect`) are exposed via `EngineEffectPlugin` in
`src/extract/engine/ts/effect-ts-bridge.ts`.

## 6. The L3 → L4 fan-out and precedence

L3 owns the dispatch loop and a **total precedence order** for the case where multiple L4 plugins
answer the same leaf:

1. `FrameworkPlugin.recognizeHook` (a hook is structurally distinctive; wins first)
2. `StateSourcePlugin.summarizeWrite` (state writes)
3. `RoutePlugin.recognizeFormSubmit` (navigation / form submits)
4. `EffectPlugin.recognizeEffect` (timers/websockets/promises)
5. default leaf rule (unknown call → E1 taint)

Within a category, ids are resolved in sorted order, and a duplicate claim on the same node
with *different* IR is a hard error surfaced as a caveat, never a silent pick.

## 7. Context objects

| SPI method | Receives | Never receives |
|---|---|---|
| `recognizeHook` / `recognizeRenderBoundary` | `SurfaceCall`/`SurfaceNode`, `SymbolPort`, `importBinding` | raw `ts.Node`, pipeline |
| `summarizeWrite` / `decodeBinding` | `SurfaceCall` / `StateVarDecl`, resolved setter env, L2 expr helper | other plugins' state |
| `recognizeFormSubmit` | `SurfaceNode`, route inventory view | the model under construction |
| `recognizeEffect` | `EffectSurfaceCall`, L2 CPS helper handle | the pending-var table directly |

Each context is a narrow object assembled by the engine driver, never the whole `CompileCtx`.

## 8. Unchanged SPIs

`TypePlugin` (`refineDomain`) and `EffectApiProvider` (`discoverEffectApis`) keep
their current contracts (`src/extract/engine/spi/index.ts`). Zod/ArkType refinement and effect-API
discovery already match the leaf-meaning philosophy and need no change.
