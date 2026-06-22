import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  reactFramework,
  SUSPENSE_DOMAIN,
} from "modality-ts/extract/frameworks/react";
import { resolveImportedName } from "modality-ts/extract/engine/spi";

function parseCall(source: string): ts.CallExpression {
  const file = ts.createSourceFile(
    "App.tsx",
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

function parseNode(source: string): ts.Node {
  const file = ts.createSourceFile(
    "App.tsx",
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
  return target;
}

describe("reactFramework", () => {
  const framework = reactFramework();
  const ctx = { fileName: "App.tsx" };

  it("exposes plugin shape", () => {
    expect(framework.id).toBe("react");
    expect(framework.packageNames).toEqual(["react"]);
    expect(framework.version).toBe("0.1.0");
  });

  it.each([
    ["useState", "state"],
    ["useReducer", "state"],
    ["useRef", "state"],
    ["useContext", "context"],
    ["useTransition", "transition"],
    ["useDeferredValue", "deferred"],
  ] as const)("recognizeHook classifies %s as %s", (hook, kind) => {
    const hookCall = framework.recognizeHook(parseCall(`${hook}()`), ctx);
    expect(hookCall?.hook.kind).toBe(kind);
  });

  it("recognizeHook assigns useEffect phase 1", () => {
    const hookCall = framework.recognizeHook(parseCall("useEffect(() => {})"), ctx);
    expect(hookCall?.hook).toEqual({ kind: "effect", phase: 1 });
  });

  it.each(["useLayoutEffect", "useInsertionEffect"] as const)(
    "recognizeHook assigns %s phase 0",
    (hook) => {
      const hookCall = framework.recognizeHook(
        parseCall(`${hook}(() => {})`),
        ctx,
      );
      expect(hookCall?.hook).toEqual({ kind: "effect", phase: 0 });
    },
  );

  it("recognizeHook unwraps useCallback handler target", () => {
    const hookCall = framework.recognizeHook(
      parseCall("useCallback(() => {})"),
      ctx,
    );
    expect(hookCall?.hook.kind).toBe("callback");
    if (hookCall?.hook.kind === "callback") {
      expect(ts.isArrowFunction(hookCall.hook.handler)).toBe(true);
    }
  });

  it("recognizeRenderBoundary classifies Suspense with gating domain", () => {
    const boundary = framework.recognizeRenderBoundary(
      parseNode("<Suspense><Child /></Suspense>"),
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
      parseNode("const C = React.lazy(() => import('./C'))"),
      ctx,
    );
    expect(boundary?.kind).toBe("lazy");
  });

  it("recognizeRenderBoundary classifies use()", () => {
    const boundary = framework.recognizeRenderBoundary(
      parseCall("use(promise)"),
      ctx,
    );
    expect(boundary?.kind).toBe("use");
  });

  it.todo("recognizes import-aliased hooks once Part 6 importBinding lands", () => {
    const file = ts.createSourceFile(
      "App.tsx",
      `import { useState as useLocalState } from "react";
      useLocalState(0);`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let call: ts.CallExpression | undefined;
    const visit = (node: ts.Node): void => {
      if (call) return;
      if (ts.isCallExpression(node)) call = node;
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(
      framework.recognizeHook(call!, { fileName: "App.tsx", sourceFile: file }),
    ).toBeDefined();
  });

  it("resolveImportedName returns bare identifier for identity", () => {
    const identifier = ts.factory.createIdentifier("useState");
    expect(resolveImportedName(identifier, ctx)).toBe("useState");
  });
});
