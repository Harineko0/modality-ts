import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import {
  inferDomainFromTypeNode,
  inferDomainFromTypeNodeDetailed,
  inferUseStateDomainDetailed,
  typeAliasDeclarations,
} from "modality-ts/extract/engine";

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

  it("resolves static zod schema from initializer", () => {
    const { call, sourceFile } = useStateCall(
      `const [n] = useState(z.number().int().min(0).max(3));`,
    );
    const result = inferUseStateDomainDetailed(call, new Map(), sourceFile);
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("resolves typed useState with zod initializer", () => {
    const { call, sourceFile } = useStateCall(
      `const [n] = useState<number>(z.number().int().min(0).max(3));`,
    );
    const result = inferUseStateDomainDetailed(call, new Map(), sourceFile);
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
  });

  it("resolves static arktype schema from initializer", () => {
    const { call, sourceFile } = useStateCall(
      `const [n] = useState(type("0 <= number.integer <= 3"));`,
    );
    const result = inferUseStateDomainDetailed(call, new Map(), sourceFile);
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("abstracts dynamic zod schema with caveat", () => {
    const { call, sourceFile } = useStateCall(
      `const limit = 3; const [n] = useState(z.number().int().min(0).max(limit));`,
    );
    const result = inferUseStateDomainDetailed(call, new Map(), sourceFile);
    expect(result.domain).toEqual({ kind: "tokens", count: 1 });
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.reason).toContain("dynamic bounds");
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
});
