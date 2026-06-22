# Spec 09.01 — L1: Language Frontend and Surface IR

Status: draft for review. Part of the `plugin-layering/` series. Builds on `00-overview.md`.

## 1. Purpose of the layer

L1 is the only layer that knows the *source language*. Its job is to turn a parse tree (today,
the TypeScript AST from `typescript`) into a small, normalized **Surface IR** that L2 (the
semantic compiler) consumes without any `import * as ts` dependency. L1 also exposes a
**symbol/type resolution port** so L2 and L4 can ask "what does this identifier resolve to?" and
"what is the static type of this expression?" without reaching into the compiler API themselves.

L1 varies with the language. L0 (kernel IR) and L2 (semantic compiler) are reused unchanged when a
second language is added; L1 is the part that gets rewritten.

## 2. Where it comes from

Today the TS frontend is fused into the engine: `src/extract/engine/ts/` mixes raw AST traversal
(`traversal.ts`, `semantic-source-file.ts`, `ast.ts`'s structural predicates) with library
semantics (`ast.ts`'s hook tables) and control-flow compilation (`transition/statement-summary.ts`).
L1 extracts the *structural, language-only* part: predicates like `isExtractableHandler`
(`ast.ts:134-142`), `componentNameFor` (`ast.ts:173-187`), `literalValue` (`ast.ts:223-234`),
`callName` (`ast.ts:236-241`), and `lineAndColumn` (`ast.ts:243-249`) are language facts and belong
in L1. The hook-name predicates (`isUseStateCall`, `reactEffectHookName`, …) are **library** facts
and move to L4 (Spec `03-use-case-spis.md`); they do not belong in L1.

## 3. Surface IR node set

Surface IR is deliberately tiny — it is *control-flow shape plus opaque leaves*, not a faithful TS
re-encoding. Anything language-specific that L2 does not need is dropped or folded into an opaque
`SurfaceExpr` carrying a back-reference to the original node (for diagnostics and for L4 leaf
interpretation).

```
SurfaceModule    = { decls: SurfaceDecl[] }
SurfaceDecl      = FunctionDecl | ComponentDecl | HookDecl | VarDecl | Other
SurfaceFunction  = { name?, params: Param[], body: SurfaceBlock, origin: NodeRef }

SurfaceStmt =
  | { kind: "block",   stmts: SurfaceStmt[] }
  | { kind: "if",      cond: SurfaceExpr, then: SurfaceStmt, else?: SurfaceStmt }
  | { kind: "switch",  disc: SurfaceExpr, cases: { test?: SurfaceExpr; body: SurfaceStmt }[] }
  | { kind: "for",     init?, cond?, update?, body: SurfaceStmt, loopKind: "for"|"while"|"forOf"|"forIn" }
  | { kind: "return",  value?: SurfaceExpr }
  | { kind: "assign",  target: SurfaceLValue, op: AssignOp, value: SurfaceExpr }
  | { kind: "declare", bindings: SurfaceBinding[] }   // const/let with init
  | { kind: "expr",    expr: SurfaceExpr }            // call/await/etc as a statement
  | { kind: "throw" | "break" | "continue" | "tryish" | "opaque", origin: NodeRef }

SurfaceExpr =
  | { kind: "literal", value: Value }
  | { kind: "ref",     symbol: SymbolRef }            // resolved via the symbol port
  | { kind: "call",    callee: SurfaceExpr, args: SurfaceExpr[], origin: NodeRef }
  | { kind: "member",  object: SurfaceExpr, name: string }
  | { kind: "binary" | "unary" | "logical" | "ternary" | "object" | "array" | "jsx", … , origin: NodeRef }
  | { kind: "opaque",  origin: NodeRef }              // L1 declines to normalize; L2 over-approximates
```

Notes:

- **`origin: NodeRef`** is an opaque handle back to the language node. L4 leaf interpreters receive
  it (re-resolved through the symbol port) so they can read library-specific structure that Surface
  IR intentionally elides — e.g. a JSX `<Suspense>` element's children. L2 itself never inspects
  `origin`; only L4, through L3, does.
- **`jsx`** is a single Surface node kind. The *meaning* of any JSX tag (a `<Suspense>` boundary, a
  router `<Form>`, a plain element) is an L4 question answered via the framework/navigation SPIs.
- `for`/`while`/`forOf` collapse to one `for` node with a `loopKind` tag; L2 over-approximates all
  loops uniformly (Spec `02-semantic-compiler.md` §5), so the distinction is advisory.

## 4. The symbol/type resolution port

L2 and L4 must resolve names and types without depending on `typescript`. L1 exposes a port whose
TS implementation wraps the existing `SemanticTypeContext` (`src/extract/engine/spi/index.ts`):

```ts
interface SymbolPort {
  resolve(ref: SymbolRef): ResolvedSymbol | undefined;     // declaration, kind, module origin
  localSymbolKey(ref: SymbolRef): string | undefined;      // stable per-scope identity (today: SemanticTypeContext.localSymbolKey)
  importBinding(ref: SymbolRef): ImportBinding | undefined; // { module, exportedName, isNamespace } — import-alias-aware
  typeOf(expr: SurfaceExpr): TypeView | undefined;          // structural type summary, no ts.Type leak
}
```

`importBinding` is the linchpin for **import-alias awareness**: L4 framework plugins must recognize
`import { useState as useS } from "react"` and `import * as React from "react"; React.useState(…)`,
not just the bare identifier `useState`. Today `ast.ts` matches `node.expression.text === "useState"`
verbatim and misses aliases. Moving recognition to L4 *and* routing it through `importBinding` fixes
this as a side effect of the refactor.

`TypeView` is a structural, serializable summary (primitive kind, union members, literal set,
property names) — never a live `ts.Type`. This keeps L2/L4 language-agnostic and keeps the
`typescript` dependency inside L1.

## 5. TypeScript as implementation #1

`src/extract/lang/ts` is the first and (for now) only L1 implementation. It owns:

- the `typescript` dependency (the only layer below L5 that may import it);
- the AST → Surface IR lowering;
- the `SymbolPort` implementation over `ts.TypeChecker` (reusing today's `SemanticTypeContext`
  plumbing in `src/extract/engine/ts/semantic-*.ts`).

It does **not** own: hook recognition, JSX-tag meaning, var-id shapes, or any string from the
coupling inventory in `00-overview.md §2`. Those are L4.

## 6. What a second language reuses vs. replaces

| Concern | Reused (L0/L2/L3) | Replaced (L1) |
|---|---|---|
| Kernel IR, abstract domains | ✓ | — |
| Control-flow → IR lowering, arithmetic, guards | ✓ (L2 is language-agnostic) | — |
| SPI contracts (`FrameworkPlugin`, `StateSourcePlugin`, …) | ✓ | — |
| Parse tree → Surface IR | — | ✓ new `lang/<lang>` |
| Symbol/type port | — | ✓ new impl over that language's resolver |
| Library plugins (L4) | mostly ✓ — leaf interpreters consume Surface IR + the port | leaf interpreters that read `origin` need a per-language `origin` reader |

The design goal: a second frontend (e.g. a Vue SFC compiler, or a non-React TS dialect) is a new
`lang/<lang>` package plus per-language `origin` adapters in the L4 plugins it wants to support —
the compiler, the SPIs, and the kernel are untouched. This mirrors Spec 05's "vertical slice"
litmus test, applied to the language axis.

## 7. Dependency rules

`extract/lang/*` imports **`core` only** (and `typescript` for the TS impl). It must not import
`extract/compile`, `extract/frameworks/*`, `extract/sources/*`, or `extract/engine` internals.
Enforced by dependency-cruiser (Spec `05-config-and-registry.md §4`).
