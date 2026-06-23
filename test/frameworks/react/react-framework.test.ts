import { resolveImportedName } from "modality-ts/extract/engine/spi";
import {
  reactFramework,
  SUSPENSE_DOMAIN,
} from "modality-ts/extract/plugins/framework/react";
import type { SurfaceCall } from "modality-ts/extract/lang/ts";
import {
  createTsSymbolPort,
  lowerExpr,
  nodeRefFor,
} from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const FILE = "App.tsx";

function parseCall(source: string): ts.CallExpression {
  const file = ts.createSourceFile(
    FILE,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let call: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (call) return;
    if (ts.isCallExpression(node)) {
      call = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!call) throw new Error(`No call expression in: ${source}`);
  return call;
}

function parseSurfaceCall(source: string): SurfaceCall {
  const surface = lowerExpr(parseCall(source), FILE);
  if (surface.kind !== "call") {
    throw new Error(`Expected surface call in: ${source}`);
  }
  return surface;
}

function parseSurfaceNode(source: string) {
  const file = ts.createSourceFile(
    FILE,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let target: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (target) return;
    if (ts.isJsxElement(node) || ts.isCallExpression(node)) {
      target = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!target) throw new Error(`No target node in: ${source}`);
  return lowerExpr(target as ts.Expression, FILE);
}

describe("reactFramework", () => {
  const framework = reactFramework();
  const ctx = { fileName: FILE };

  it("exposes plugin shape", () => {
    expect(framework.id).toBe("react");
    expect(framework.packageNames).toEqual(["react"]);
    expect(framework.version).toBe("0.1.0");
    expect(framework.kind).toBe("framework");
  });

  it.each([
    ["useState", "state"],
    ["useReducer", "state"],
    ["useRef", "state"],
    ["useContext", "context"],
    ["useTransition", "transition"],
    ["useDeferredValue", "deferred"],
  ] as const)("recognizeHook classifies %s as %s", (hook, kind) => {
    const hookCall = framework.recognizeHook(
      parseSurfaceCall(`${hook}()`),
      ctx,
    );
    expect(hookCall?.hook.kind).toBe(kind);
  });

  it("recognizeHook assigns useEffect phase 1", () => {
    const hookCall = framework.recognizeHook(
      parseSurfaceCall("useEffect(() => {})"),
      ctx,
    );
    expect(hookCall?.hook).toEqual({ kind: "effect", phase: 1 });
  });

  it.each([
    "useLayoutEffect",
    "useInsertionEffect",
  ] as const)("recognizeHook assigns %s phase 0", (hook) => {
    const hookCall = framework.recognizeHook(
      parseSurfaceCall(`${hook}(() => {})`),
      ctx,
    );
    expect(hookCall?.hook).toEqual({ kind: "effect", phase: 0 });
  });

  it("recognizeHook unwraps useCallback handler target", () => {
    const hookCall = framework.recognizeHook(
      parseSurfaceCall("useCallback(() => {})"),
      ctx,
    );
    expect(hookCall?.hook.kind).toBe("callback");
    if (hookCall?.hook.kind === "callback") {
      expect(hookCall.hook.handler.file).toBe(FILE);
    }
  });

  it("recognizeRenderBoundary classifies Suspense with gating domain", () => {
    const boundary = framework.recognizeRenderBoundary(
      parseSurfaceNode("<Suspense><Child /></Suspense>"),
      ctx,
    );
    expect(boundary).toEqual(
      expect.objectContaining({
        kind: "suspense",
        domain: SUSPENSE_DOMAIN,
      }),
    );
    expect(boundary?.domain).toEqual({
      kind: "enum",
      values: ["ready", "suspended"],
    });
  });

  it("recognizeRenderBoundary classifies React.lazy", () => {
    const boundary = framework.recognizeRenderBoundary(
      parseSurfaceNode("const C = React.lazy(() => import('./C'))"),
      ctx,
    );
    expect(boundary?.kind).toBe("lazy");
  });

  it("recognizeRenderBoundary classifies use()", () => {
    const boundary = framework.recognizeRenderBoundary(
      parseSurfaceCall("use(promise)"),
      ctx,
    );
    expect(boundary?.kind).toBe("use");
  });

  it.each([
    ["startTransition", "start-transition"],
    ["flushSync", "flush-sync"],
  ] as const)("recognizeHook classifies %s as %s", (call, kind) => {
    const hookCall = framework.recognizeHook(
      parseSurfaceCall(`${call}(() => {})`),
      ctx,
    );
    expect(hookCall?.hook.kind).toBe(kind);
  });

  it("recognizes import-aliased hooks via SymbolPort importBinding", () => {
    const source = `import { useState as useLocalState } from "react";
useLocalState(0);`;
    const file = ts.createSourceFile(
      FILE,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const host = ts.createCompilerHost({});
    const originalRead = host.readFile.bind(host);
    host.readFile = (path) =>
      path.endsWith("App.tsx") ? source : originalRead(path);
    const program = ts.createProgram(
      [file.fileName],
      {
        target: ts.ScriptTarget.Latest,
        jsx: ts.JsxEmit.ReactJSX,
      },
      host,
    );
    const symbols = createTsSymbolPort({
      program,
      checker: program.getTypeChecker(),
      sourceFile: file,
      getSourceFile: (fileName) =>
        fileName === file.fileName ? file : undefined,
    });
    const call = parseSurfaceCall("useLocalState(0)");
    expect(
      framework.recognizeHook(call, {
        fileName: FILE,
        symbols,
      }),
    ).toBeDefined();
  });

  it("resolveImportedName uses importBinding when SymbolPort is provided", () => {
    const source = `import { useState as useLocalState } from "react";`;
    const file = ts.createSourceFile(
      FILE,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const importStmt = file.statements.find(ts.isImportDeclaration);
    const named = importStmt?.importClause?.namedBindings;
    expect(named && ts.isNamedImports(named)).toBe(true);
    if (!named || !ts.isNamedImports(named)) return;
    const specifier = named.elements[0]!;
    const host = ts.createCompilerHost({});
    const originalRead = host.readFile.bind(host);
    host.readFile = (path) =>
      path.endsWith("App.tsx") ? source : originalRead(path);
    const program = ts.createProgram(
      [file.fileName],
      {
        target: ts.ScriptTarget.Latest,
        jsx: ts.JsxEmit.ReactJSX,
      },
      host,
    );
    const symbols = createTsSymbolPort({
      program,
      checker: program.getTypeChecker(),
      sourceFile: file,
      getSourceFile: (fileName) =>
        fileName === file.fileName ? file : undefined,
    });
    expect(
      resolveImportedName(
        {
          name: specifier.name.text,
          origin: nodeRefFor(specifier.name, file.fileName),
        },
        { symbols },
      ),
    ).toBe("useState");
  });
});
