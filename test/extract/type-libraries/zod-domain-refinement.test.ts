import { zodTypePlugin } from "modality-ts/extract/plugins/type/zod";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { resolveDomainRefinements } from "../../../src/extract/engine/ts/domain-refinements.js";
import { typeRefinementContextFromTs } from "../../../src/extract/engine/ts/type-refinement-bridge.js";

function refinementContext(source: string): {
  initializer: ts.Expression;
  sourceFile: ts.SourceFile;
} {
  const sourceFile = ts.createSourceFile(
    "fixture.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.getText() === "useState") {
      initializer = node.arguments[0];
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!initializer) throw new Error("initializer not found");
  return { initializer, sourceFile };
}

function resolveZod(source: string) {
  const { initializer, sourceFile } = refinementContext(source);
  return resolveDomainRefinements(
    typeRefinementContextFromTs({
      initializer,
      sourceFile,
      typeAliases: new Map(),
      visited: new Set(),
      varId: "local:App.n",
    }),
    [zodTypePlugin()],
  );
}

describe("zod domain refinement provider", () => {
  const provider = zodTypePlugin();

  it("resolves z.number().int().min(0).max(3) to boundedInt", () => {
    const result = resolveZod(
      `const [n] = useState(z.number().int().min(0).max(3));`,
    );
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("resolves z.number().int().gte(0).lte(3) to boundedInt", () => {
    const result = resolveZod(
      `const [n] = useState(z.number().int().gte(0).lte(3));`,
    );
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("resolves z.number().int().gt(0).lt(4) to boundedInt", () => {
    const result = resolveZod(
      `const [n] = useState(z.number().int().gt(0).lt(4));`,
    );
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: 1,
      max: 3,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("resolves z.number().int().positive().max(3) to boundedInt", () => {
    const result = resolveZod(
      `const [n] = useState(z.number().int().positive().max(3));`,
    );
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: 1,
      max: 3,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("resolves z.number().int().nonnegative().lte(3) to boundedInt", () => {
    const result = resolveZod(
      `const [n] = useState(z.number().int().nonnegative().lte(3));`,
    );
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("resolves z.number().int().negative().gte(-3) to boundedInt", () => {
    const result = resolveZod(
      `const [n] = useState(z.number().int().negative().gte(-3));`,
    );
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: -3,
      max: -1,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("resolves z.number().int().nonpositive().gte(-3) to boundedInt", () => {
    const result = resolveZod(
      `const [n] = useState(z.number().int().nonpositive().gte(-3));`,
    );
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: -3,
      max: 0,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("resolves z.number().int().min(0).max(10).multipleOf(5) to intSet", () => {
    const result = resolveZod(
      `const [n] = useState(z.number().int().min(0).max(10).multipleOf(5));`,
    );
    expect(result.domain).toEqual({
      kind: "intSet",
      values: [0, 5, 10],
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("resolves z.number().int().min(0).max(10).step(5) to intSet", () => {
    const result = resolveZod(
      `const [n] = useState(z.number().int().min(0).max(10).step(5));`,
    );
    expect(result.domain).toEqual({
      kind: "intSet",
      values: [0, 5, 10],
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("emits dynamic caveat for dynamic multipleOf argument", () => {
    const result = resolveZod(
      `const limit = 5; const [n] = useState(z.number().int().min(0).max(3).multipleOf(limit));`,
    );
    expect(result.domain).toBeUndefined();
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.reason).toContain("dynamic bounds");
  });

  it("emits unsupported caveat for multipleOf(0)", () => {
    const result = resolveZod(
      `const [n] = useState(z.number().int().min(0).max(3).multipleOf(0));`,
    );
    expect(result.domain).toBeUndefined();
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.reason).toContain(
      "Unsupported or unprovable Zod numeric schema",
    );
  });

  it("emits unsupported caveat for z.number().gte(0).lte(3) without int", () => {
    const result = resolveZod(
      `const [n] = useState(z.number().gte(0).lte(3));`,
    );
    expect(result.domain).toBeUndefined();
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.reason).toContain(
      "Unsupported or unprovable Zod numeric schema",
    );
  });

  it("emits unsupported caveat for one-sided finite lower bound", () => {
    const result = resolveZod(`const [n] = useState(z.number().int().gte(0));`);
    expect(result.domain).toBeUndefined();
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.reason).toContain(
      "Unsupported or unprovable Zod numeric schema",
    );
  });

  it("emits unsupported caveat for contradictory bounds", () => {
    const result = resolveZod(
      `const [n] = useState(z.number().int().min(4).max(0));`,
    );
    expect(result.domain).toBeUndefined();
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.reason).toContain(
      "Unsupported or unprovable Zod numeric schema",
    );
  });

  it("emits caveat for dynamic bounds", () => {
    const { initializer, sourceFile } = refinementContext(
      `const limit = 3; const [n] = useState(z.number().int().min(0).max(limit));`,
    );
    const result = resolveDomainRefinements(
      typeRefinementContextFromTs({
        initializer,
        sourceFile,
        typeAliases: new Map(),
        visited: new Set(),
        varId: "local:App.n",
      }),
      [provider],
    );
    expect(result.domain).toBeUndefined();
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.reason).toContain("dynamic bounds");
  });

  it("abstains for z.string() without caveats", () => {
    const { initializer, sourceFile } = refinementContext(
      `const [label] = useState(z.string());`,
    );
    const result = provider.refineDomain(
      typeRefinementContextFromTs({
        initializer,
        sourceFile,
        typeAliases: new Map(),
        visited: new Set(),
        varId: "local:App.label",
      }),
    );
    expect(result).toBeUndefined();
  });
});
