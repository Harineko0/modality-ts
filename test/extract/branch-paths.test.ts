import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import type {
  BoundExpr,
  SetterBinding,
} from "../../src/extract/lang/ts/driver/types.js";
import { enumerateGuardedPaths } from "../../src/extract/lang/ts/driver/transition/branch-paths.js";

function bodyStatements(sourceText: string): readonly ts.Statement[] {
  const source = ts.createSourceFile(
    "fixture.ts",
    `function f() { ${sourceText} }`,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = source.statements[0];
  if (!declaration || !ts.isFunctionDeclaration(declaration))
    throw new Error("missing function");
  return declaration.body?.statements ?? [];
}

function locals(...names: string[]): Map<string, BoundExpr> {
  return new Map(
    names.map((name) => [
      name,
      {
        expr: { kind: "read", var: `state:${name}` },
        reads: [`state:${name}`],
      },
    ]),
  );
}

function pathsFor(sourceText: string, maxPaths?: number) {
  return enumerateGuardedPaths(bodyStatements(sourceText), {
    setters: new Map<string, SetterBinding>(),
    initialLocals: locals("a", "b", "c", "k"),
    ...(maxPaths ? { maxPaths } : {}),
  });
}

function texts(paths: ReturnType<typeof pathsFor>["paths"]): string[] {
  return paths.map((path) =>
    path.statements.map((statement) => statement.getText()).join(";"),
  );
}

describe("enumerateGuardedPaths", () => {
  it("expands a single if with an implicit no-branch path", () => {
    const result = pathsFor(`start(); if (a) { yes(); } done();`);

    expect(result.truncated).toBe(false);
    expect(texts(result.paths)).toEqual([
      "start();;yes();;done();",
      "start();;done();",
    ]);
    expect(JSON.stringify(result.paths[0]?.guard?.expr)).toContain("state:a");
    expect(JSON.stringify(result.paths[1]?.guard?.expr)).toContain('"not"');
  });

  it("expands if/else arms", () => {
    const result = pathsFor(`if (a) { yes(); } else { no(); } done();`);

    expect(texts(result.paths)).toEqual(["yes();;done();", "no();;done();"]);
    expect(result.paths).toHaveLength(2);
  });

  it("accumulates if/else-if/else guards", () => {
    const result = pathsFor(
      `if (k === "a") { a(); } else if (k === "b") { b(); } else { c(); }`,
    );

    expect(texts(result.paths)).toEqual(["a();", "b();", "c();"]);
    expect(JSON.stringify(result.paths[1]?.guard?.expr)).toContain('"and"');
    expect(JSON.stringify(result.paths[2]?.guard?.expr)).toContain('"not"');
  });

  it("multiplies nested and sequential branches", () => {
    const result = pathsFor(`if (a) { if (b) { ab(); } } if (c) { c(); }`);

    expect(result.paths).toHaveLength(6);
    expect(texts(result.paths)).toContain("ab();;c();");
  });

  it("caps path enumeration", () => {
    const result = pathsFor(
      `if (a) { a(); } if (b) { b(); } if (c) { c(); }`,
      4,
    );

    expect(result.truncated).toBe(true);
    expect(result.paths).toHaveLength(4);
  });
});
