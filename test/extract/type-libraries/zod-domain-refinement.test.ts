import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { resolveDomainRefinements } from "../../../src/extract/engine/ts/domain-refinements.js";
import { zodDomainRefinementProvider } from "modality-ts/extract/type-libraries/zod";

function refinementContext(
  source: string,
  varId = "local:App.n",
): {
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

describe("zod domain refinement provider", () => {
  const provider = zodDomainRefinementProvider();

  it("resolves z.number().int().min(0).max(3) to boundedInt", () => {
    const { initializer, sourceFile } = refinementContext(
      `const [n] = useState(z.number().int().min(0).max(3));`,
    );
    const result = resolveDomainRefinements(
      {
        initializer,
        sourceFile,
        typeAliases: new Map(),
        visited: new Set(),
        varId: "local:App.n",
      },
      [provider],
    );
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("emits caveat for dynamic bounds", () => {
    const { initializer, sourceFile } = refinementContext(
      `const limit = 3; const [n] = useState(z.number().int().min(0).max(limit));`,
    );
    const result = resolveDomainRefinements(
      {
        initializer,
        sourceFile,
        typeAliases: new Map(),
        visited: new Set(),
        varId: "local:App.n",
      },
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
    const result = provider.refineDomain({
      initializer,
      sourceFile,
      typeAliases: new Map(),
      visited: new Set(),
      varId: "local:App.label",
    });
    expect(result).toBeUndefined();
  });
});
