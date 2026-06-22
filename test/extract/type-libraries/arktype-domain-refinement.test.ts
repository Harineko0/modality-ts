import { arktypeTypePlugin } from "modality-ts/extract/type-libraries/arktype";
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

function resolveWithProvider(source: string) {
  const { initializer, sourceFile } = refinementContext(source);
  return resolveDomainRefinements(
    typeRefinementContextFromTs({
      initializer,
      sourceFile,
      typeAliases: new Map(),
      visited: new Set(),
      varId: "local:App.n",
    }),
    [arktypeTypePlugin()],
  );
}

describe("arktype domain refinement provider", () => {
  const provider = arktypeTypePlugin();

  it('resolves type("0 <= number.integer <= 3") to boundedInt', () => {
    const result = resolveWithProvider(
      `const [n] = useState(type("0 <= number.integer <= 3"));`,
    );
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it("resolves type(\"'typescript'\") to enum", () => {
    const result = resolveWithProvider(
      `const [label] = useState(type("'typescript'"));`,
    );
    expect(result.domain).toEqual({
      kind: "enum",
      values: ["typescript"],
    });
    expect(result.caveats).toEqual([]);
  });

  it("resolves string literal unions to sorted enum", () => {
    const result = resolveWithProvider(
      `const [status] = useState(type("'idle' | 'posting' | 'failed'"));`,
    );
    expect(result.domain).toEqual({
      kind: "enum",
      values: ["failed", "idle", "posting"],
    });
    expect(result.caveats).toEqual([]);
  });

  it("deduplicates string literal union members", () => {
    const result = resolveWithProvider(
      `const [status] = useState(type("'idle' | 'idle' | 'posting'"));`,
    );
    expect(result.domain).toEqual({
      kind: "enum",
      values: ["idle", "posting"],
    });
  });

  it('does not refine broad type("string") to enum', () => {
    const result = resolveWithProvider(
      `const [label] = useState(type("string"));`,
    );
    expect(result.domain).toBeUndefined();
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.reason).toContain(
      "Unsupported arktype numeric schema grammar",
    );
  });

  it('resolves type("-5 <= (number.integer % 2) <= 5") to intSet', () => {
    const result = resolveWithProvider(
      `const [n] = useState(type("-5 <= (number.integer % 2) <= 5"));`,
    );
    expect(result.domain).toEqual({
      kind: "intSet",
      values: [-4, -2, 0, 2, 4],
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it('resolves type("-5 < (number.integer % 2) < 5") to intSet', () => {
    const result = resolveWithProvider(
      `const [n] = useState(type("-5 < (number.integer % 2) < 5"));`,
    );
    expect(result.domain).toEqual({
      kind: "intSet",
      values: [-4, -2, 0, 2, 4],
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it('resolves type("0 <= (number.integer % 1) <= 3") to boundedInt', () => {
    const result = resolveWithProvider(
      `const [n] = useState(type("0 <= (number.integer % 1) <= 3"));`,
    );
    expect(result.domain).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 3,
      overflow: "forbid",
    });
    expect(result.caveats).toEqual([]);
  });

  it('emits caveat for type("0 <= (number.integer % 0) <= 3")', () => {
    const result = resolveWithProvider(
      `const [n] = useState(type("0 <= (number.integer % 0) <= 3"));`,
    );
    expect(result.domain).toBeUndefined();
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.reason).toContain("modulo by zero");
  });

  it('emits caveat for unbounded type("number % 2")', () => {
    const result = resolveWithProvider(
      `const [n] = useState(type("number % 2"));`,
    );
    expect(result.domain).toBeUndefined();
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.reason).toContain("unbounded divisor");
  });

  it('emits caveat for type("string > 0")', () => {
    const result = resolveWithProvider(
      `const [label] = useState(type("string > 0"));`,
    );
    expect(result.domain).toBeUndefined();
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.reason).toContain(
      "Unsupported arktype string length schema",
    );
  });

  it('emits caveat for type("string[] > 0")', () => {
    const result = resolveWithProvider(
      `const [items] = useState(type("string[] > 0"));`,
    );
    expect(result.domain).toBeUndefined();
    expect(result.caveats).toHaveLength(1);
    expect(result.caveats[0]?.reason).toContain(
      "Unsupported arktype array length schema",
    );
  });

  it("emits caveat for unsupported number.integer grammar", () => {
    const result = resolveWithProvider(
      `const [n] = useState(type("number.integer"));`,
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
    const result = provider.refineDomain(
      typeRefinementContextFromTs({
        initializer,
        sourceFile,
        typeAliases: new Map(),
        visited: new Set(),
        varId: "local:App.n",
      }),
    );
    expect(result).toBeUndefined();
  });
});
