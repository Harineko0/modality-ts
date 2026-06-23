import { resolve } from "node:path";
import {
  inferDomainFromTypeNode,
  inferDomainFromTypeNodeDetailed,
  inferDomainSemantic,
  inferUseStateDomainDetailed,
  initialValueForUseStateDetailed,
  typeAliasDeclarations,
} from "../../src/extract/lang/ts/driver/domains.js";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { createSemanticProjectForTest } from "../../src/extract/lang/ts/driver/semantic-project.js";

function typeNode(source: string): ts.TypeNode {
  const file = ts.createSourceFile(
    "fixture.ts",
    `type T = ${source};`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const alias = file.statements[0];
  if (!ts.isTypeAliasDeclaration(alias)) throw new Error("bad fixture");
  return alias.type;
}

function useStateCall(source: string): {
  call: ts.CallExpression;
  sourceFile: ts.SourceFile;
} {
  const sourceFile = ts.createSourceFile(
    "fixture.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let call: ts.CallExpression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText() === "useState") {
      call = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!call) throw new Error("useState call not found");
  return { call, sourceFile };
}

describe("numeric domain resolver", () => {
  it("resolves Bounded native alias", () => {
    expect(inferDomainFromTypeNode(typeNode("Bounded<0, 3>"))).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
  });

  it("resolves Wrapping and width aliases", () => {
    expect(inferDomainFromTypeNode(typeNode("Uint8"))).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 255,
      overflow: "wrap",
    });
    expect(inferDomainFromTypeNode(typeNode("Short"))).toEqual({
      kind: "boundedInt",
      min: -32768,
      max: 32767,
      overflow: "wrap",
    });
  });

  it("resolves sparse numeric literal unions to intSet", () => {
    expect(inferDomainFromTypeNode(typeNode("0 | 2"))).toEqual({
      kind: "intSet",
      values: [0, 2],
    });
  });

  it("normalizes dense numeric literal unions to boundedInt", () => {
    expect(inferDomainFromTypeNode(typeNode("0 | 1 | 2 | 3"))).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
    });
    expect(inferDomainFromTypeNode(typeNode("0 | 1 | 2"))).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 2,
    });
  });

  it("abstracts bare number with caveat", () => {
    const result = inferDomainFromTypeNodeDetailed(typeNode("number"));
    expect(result.domain).toEqual({ kind: "tokens", count: 1 });
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.kind).toBe("model-slack");
    expect(result.caveats[0]?.reason).toContain("bare number");
  });

  it("does not refine Zod schema initializers without providers", () => {
    const { call, sourceFile } = useStateCall(
      `const [n] = useState(z.number().int().min(0).max(3));`,
    );
    const result = inferUseStateDomainDetailed(call, new Map(), sourceFile);
    expect(result.domain).toEqual({ kind: "tokens", count: 1 });
    expect(result.caveats).toEqual([]);
  });

  it("initializes lengthCat from lazy finite Array.from", () => {
    const { call, sourceFile } = useStateCall(
      `type Item = { id: string };
      const makeItem = () => ({ id: 'x' });
      const [items] = useState<Item[]>(() => Array.from({ length: 3 }, makeItem));`,
    );
    const domain = inferUseStateDomainDetailed(
      call,
      new Map(),
      sourceFile,
    ).domain;
    const result = initialValueForUseStateDetailed(
      call,
      domain,
      sourceFile,
      "local:App.items",
    );
    expect(result.value).toBe("many");
    expect(result.caveats).toEqual([]);
  });

  it("emits model-slack for unprovable array initializer length", () => {
    const { call, sourceFile } = useStateCall(
      `type Item = { id: string };
      const makeItem = () => ({ id: 'x' });
      function App({ count }: { count: number }) {
        const [items] = useState<Item[]>(() => Array.from({ length: count }, makeItem));
        return null;
      }`,
    );
    const domain = inferUseStateDomainDetailed(
      call,
      new Map(),
      sourceFile,
    ).domain;
    const result = initialValueForUseStateDetailed(
      call,
      domain,
      sourceFile,
      "local:App.items",
    );
    expect(result.value).toBe("0");
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]).toMatchObject({
      kind: "model-slack",
      reason: expect.stringContaining("array initializer length"),
    });
  });

  it("emits model-slack for property-access array initializer length", () => {
    const { call, sourceFile } = useStateCall(
      `type Item = { id: string };
      const makeItem = () => ({ id: 'x' });
      function App(props: { count: number }) {
        const [items] = useState<Item[]>(() => Array.from({ length: props.count }, makeItem));
        return null;
      }`,
    );
    const domain = inferUseStateDomainDetailed(
      call,
      new Map(),
      sourceFile,
    ).domain;
    const result = initialValueForUseStateDetailed(
      call,
      domain,
      sourceFile,
      "local:App.items",
    );
    expect(result.value).toBe("0");
    expect(result.caveats[0]?.kind).toBe("model-slack");
  });

  it("resolves aliases declared in the same source file", () => {
    const sourceFile = ts.createSourceFile(
      "fixture.ts",
      `type Count = Bounded<0, 3>; type T = Count;`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const aliases = typeAliasDeclarations(sourceFile);
    const alias = sourceFile.statements.find(
      (statement): statement is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(statement) && statement.name.text === "T",
    );
    if (!alias) throw new Error("missing alias");
    expect(inferDomainFromTypeNode(alias.type, aliases)).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
  });

  it("returns boundedInt for untyped numeric literal useState initializers", () => {
    const { call } = useStateCall(`const [n] = useState(0);`);
    expect(inferUseStateDomainDetailed(call).domain).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 0,
    });
  });

  it("falls back to tokens for z.string() schema initializer without finite literals", () => {
    const { call, sourceFile } = useStateCall(
      `const [label] = useState(z.string());`,
    );
    const result = inferUseStateDomainDetailed(call, new Map(), sourceFile);
    expect(result.domain).toEqual({ kind: "tokens", count: 1 });
    expect(result.caveats).toEqual([]);
  });

  it("resolves cross-file Bounded aliases through semantic inference", () => {
    const typesPath = resolve("/project", "types.ts");
    const appPath = resolve("/project", "App.tsx");
    const semanticProject = createSemanticProjectForTest([
      {
        path: typesPath,
        text: `export type Count = Bounded<0, 3>;`,
      },
      {
        path: appPath,
        text: `import type { Count } from "./types.js";
import { useState } from "react";
export function App() {
  const [n] = useState<Count>(0);
  return null;
}`,
      },
    ]);
    const sourceFile = semanticProject.getSourceFile(appPath)!;
    let typeArg: ts.TypeNode | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(sourceFile) === "useState"
      ) {
        typeArg = node.typeArguments?.[0];
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    expect(typeArg).toBeDefined();
    const result = inferDomainSemantic(typeArg!, {
      checker: semanticProject.checker,
      sourceFile,
      varId: "local:App.n",
    });
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });
});
