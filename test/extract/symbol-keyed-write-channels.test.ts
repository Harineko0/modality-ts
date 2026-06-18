import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import type { SemanticTypeContext } from "modality-ts/extract/engine/spi";
import {
  bindSetter,
  resolveSetterBinding,
  settersForComponent,
} from "../../src/extract/engine/ts/context.js";
import { extractReactSourceTransitions } from "../../src/extract/engine/ts/react-source-transitions.js";
import { createSemanticProjectForTest } from "../../src/extract/engine/ts/semantic-project.js";
import { useStateSource } from "../../src/extract/sources/use-state/index.js";

const projectRoot = resolve("/project");

function semanticTypesFor(
  semanticProject: ReturnType<typeof createSemanticProjectForTest>,
  fileName: string,
): SemanticTypeContext {
  const sourceFile = semanticProject.getSourceFile(fileName);
  return {
    program: semanticProject.program,
    checker: semanticProject.checker,
    ...(sourceFile ? { sourceFile } : {}),
    getSourceFile: (name) => semanticProject.getSourceFile(name),
    canonicalFileName: (name) => semanticProject.canonicalFileName(name),
    resolveModuleName: (specifier, containingFile) =>
      semanticProject.resolveModuleName(specifier, containingFile),
    symbolAt: (node) => semanticProject.symbolAt(node),
    aliasedSymbolAt: (node) => semanticProject.aliasedSymbolAt(node),
    symbolKey: (symbol) => semanticProject.symbolKey(symbol),
    localSymbolKey: (node) => semanticProject.localSymbolKey(node),
  };
}

function setterIdentifier(
  sourceFile: ts.SourceFile,
  component: string,
  setterName: string,
): ts.Identifier | undefined {
  let inComponent = false;
  let found: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === component
    ) {
      inComponent = true;
      ts.forEachChild(node, visit);
      inComponent = false;
      return;
    }
    if (
      inComponent &&
      ts.isIdentifier(node) &&
      node.text === setterName &&
      node.parent &&
      ts.isBindingElement(node.parent)
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

describe("symbol-keyed write channels", () => {
  it("binds same local setter names in different components by symbol key", () => {
    const setters = new Map();
    bindSetter(setters, "setCount", {
      varId: "local:AppA.count",
      component: "AppA",
      stateName: "count",
      domain: { kind: "boundedInt", min: 0, max: 0 },
      symbolKey: "file:a:1:setCount",
    });
    bindSetter(setters, "setCount", {
      varId: "local:AppB.count",
      component: "AppB",
      stateName: "count",
      domain: { kind: "boundedInt", min: 0, max: 0 },
      symbolKey: "file:b:2:setCount",
    });

    const scopedA = settersForComponent(setters, "AppA");
    const scopedB = settersForComponent(setters, "AppB");
    expect(scopedA.get("file:a:1:setCount")?.varId).toBe("local:AppA.count");
    expect(scopedB.get("file:b:2:setCount")?.varId).toBe("local:AppB.count");
    expect(scopedA.get("setCount")?.varId).toBe("local:AppA.count");
    expect(scopedB.get("setCount")?.varId).toBe("local:AppB.count");
  });

  it("falls back to local setter names without symbol keys", () => {
    const setters = new Map();
    bindSetter(setters, "setMode", {
      varId: "local:App.mode",
      component: "App",
      stateName: "mode",
      domain: { kind: "bool" },
    });
    expect(resolveSetterBinding(setters, "setMode")).toEqual(
      expect.objectContaining({ varId: "local:App.mode" }),
    );
  });

  it("emits useState write channel symbol keys under semantic extraction", () => {
    const fileName = resolve(projectRoot, "App.tsx");
    const sourceText = `
      import { useState } from 'react';
      export function App() {
        const [status, setStatus] = useState<'idle' | 'posting'>('idle');
        return null;
      }
    `;
    const semanticProject = createSemanticProjectForTest([
      { path: fileName, text: sourceText },
    ]);
    const types = semanticTypesFor(semanticProject, fileName);
    const plugin = useStateSource();
    const channels = plugin.writeChannels({
      sourceText,
      fileName,
      types,
    });
    const setterNode = setterIdentifier(
      semanticProject.getSourceFile(fileName)!,
      "App",
      "setStatus",
    );
    expect(setterNode).toBeDefined();
    expect(channels).toEqual([
      expect.objectContaining({
        symbolName: "setStatus",
        symbolKey: semanticProject.localSymbolKey(setterNode!),
        varId: "local:App.status",
      }),
    ]);
  });

  it("agrees on setter symbol keys between plugin write channels and generic extraction", () => {
    const fileName = resolve(projectRoot, "App.tsx");
    const sourceText = `
      import { useState } from 'react';
      export function App() {
        const [status, setStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => setStatus('posting')}>post</button>;
      }
    `;
    const semanticProject = createSemanticProjectForTest([
      { path: fileName, text: sourceText },
    ]);
    const types = semanticTypesFor(semanticProject, fileName);
    const plugin = useStateSource();
    const decls = plugin.discover({
      sourceText,
      fileName,
      route: "/",
      types,
    });
    const channels = plugin.writeChannels({ sourceText, fileName, types });
    const result = extractReactSourceTransitions(sourceText, {
      fileName,
      route: "/",
      types,
      stateVars: decls.flatMap((decl) => (decl.var ? [decl.var] : [])),
      writeChannels: channels,
    });
    const setterNode = setterIdentifier(
      semanticProject.getSourceFile(fileName)!,
      "App",
      "setStatus",
    );
    const expectedKey = semanticProject.localSymbolKey(setterNode!);
    expect(channels[0]?.symbolKey).toBe(expectedKey);
    expect(
      result.transitions.some(
        (transition) =>
          transition.writes.includes("local:App.status") &&
          transition.id.includes("onClick"),
      ),
    ).toBe(true);
  });

  it("resolves setter calls when the useState setter is renamed in destructure", () => {
    const fileName = resolve(projectRoot, "App.tsx");
    const sourceText = `
      import { useState } from 'react';
      export function App() {
        const [status, updateStatus] = useState<'idle' | 'posting'>('idle');
        return <button onClick={() => updateStatus('posting')}>post</button>;
      }
    `;
    const semanticProject = createSemanticProjectForTest([
      { path: fileName, text: sourceText },
    ]);
    const types = semanticTypesFor(semanticProject, fileName);
    const result = extractReactSourceTransitions(sourceText, {
      fileName,
      route: "/",
      types,
    });
    expect(
      result.transitions.some(
        (transition) =>
          transition.writes.includes("local:App.status") &&
          transition.id.includes("onClick"),
      ),
    ).toBe(true);
  });

  it("resolves useState setter calls over a shadowed local function name", () => {
    const fileName = resolve(projectRoot, "App.tsx");
    const sourceText = `
      import { useState } from 'react';
      export function App() {
        function setCount() {}
        const [count, setCount] = useState(0);
        return <button onClick={() => setCount(1)}>{count}</button>;
      }
    `;
    const semanticProject = createSemanticProjectForTest([
      { path: fileName, text: sourceText },
    ]);
    const types = semanticTypesFor(semanticProject, fileName);
    const result = extractReactSourceTransitions(sourceText, {
      fileName,
      route: "/",
      types,
    });
    expect(
      result.transitions.some(
        (transition) =>
          transition.writes.includes("local:App.count") &&
          transition.id.includes("onClick"),
      ),
    ).toBe(true);
  });

  it("keeps no-program extraction working with symbolName fallback", () => {
    const sourceText = `
      import { useState } from 'react';
      export function App() {
        const [mode, setMode] = useState<'on' | 'off'>('on');
        return <button onClick={() => setMode('off')}>{mode}</button>;
      }
    `;
    const result = extractReactSourceTransitions(sourceText, {
      fileName: "App.tsx",
      route: "/",
    });
    expect(result.vars.some((decl) => decl.id === "local:App.mode")).toBe(true);
    expect(
      result.transitions.some((transition) => transition.id.includes("onClick")),
    ).toBe(true);
  });
});
