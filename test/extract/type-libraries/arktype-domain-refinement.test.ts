import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { resolveDomainRefinements } from "../../../src/extract/engine/ts/domain-refinements.js";
import { arktypeDomainRefinementProvider } from "modality-ts/extract/type-libraries/arktype";

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

describe("arktype domain refinement provider", () => {
  const provider = arktypeDomainRefinementProvider();

  it('resolves type("0 <= number.integer <= 3") to boundedInt', () => {
    const { initializer, sourceFile } = refinementContext(
      `const [n] = useState(type("0 <= number.integer <= 3"));`,
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

  it("emits caveat for unsupported number.integer grammar", () => {
    const { initializer, sourceFile } = refinementContext(
      `const [n] = useState(type("number.integer"));`,
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
    expect(result.caveats[0]?.reason).toContain(
      "Unsupported arktype numeric schema grammar",
    );
  });

  it("abstains for non-ArkType expressions", () => {
    const { initializer, sourceFile } = refinementContext(
      `const [n] = useState(0);`,
    );
    const result = provider.refineDomain({
      initializer,
      sourceFile,
      typeAliases: new Map(),
      visited: new Set(),
      varId: "local:App.n",
    });
    expect(result).toBeUndefined();
  });
});
