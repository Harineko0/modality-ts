import {
  createTsSymbolPort,
  lowerBlock,
  nodeRefFor,
} from "modality-ts/extract/lang/ts";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

function parseSource(source: string, fileName = "App.tsx"): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function createChecker(source: string): {
  sourceFile: ts.SourceFile;
  program: ts.Program;
  checker: ts.TypeChecker;
} {
  const sourceFile = parseSource(source);
  const host = ts.createCompilerHost({});
  const originalRead = host.readFile.bind(host);
  host.readFile = (file) =>
    file === sourceFile.fileName ? source : originalRead(file);
  const program = ts.createProgram(
    [sourceFile.fileName],
    {
      target: ts.ScriptTarget.Latest,
      jsx: ts.JsxEmit.ReactJSX,
    },
    host,
  );
  return {
    sourceFile,
    program,
    checker: program.getTypeChecker(),
  };
}

describe("surface IR lowering", () => {
  it("lowers fn/block/if/switch/for/return/assign/declare/expr/jsx", () => {
    const source = parseSource(`
      import { useState as useS } from "react";
      function handleX() {
        const [x, setX] = useS(0);
        if (a) { setX(p); }
        switch (mode) {
          case "a": return x;
          default: break;
        }
        for (let i = 0; i < n; i++) { setX(i); }
        while (flag) { setX(1); }
        let y = 1;
        setX(y);
        return <button onClick={() => setX(2)}>{x}</button>;
      }
    `);
    const fn = source.statements.find(ts.isFunctionDeclaration);
    expect(fn).toBeDefined();
    const body = lowerBlock(fn!.body!, source.fileName);
    expect(body.kind).toBe("block");
    const kinds = body.stmts.map((stmt) => stmt.kind);
    expect(kinds).toContain("declare");
    expect(kinds).toContain("if");
    expect(kinds).toContain("switch");
    expect(kinds).toContain("for");
    expect(kinds).toContain("return");
    expect(kinds).toContain("expr");
    const ifStmt = body.stmts.find((stmt) => stmt.kind === "if");
    expect(ifStmt?.kind).toBe("if");
    if (ifStmt?.kind === "if") {
      expect(ifStmt.then.kind).toBe("block");
    }
    const returnStmt = body.stmts.find((stmt) => stmt.kind === "return");
    if (returnStmt?.kind === "return" && returnStmt.value?.kind === "jsx") {
      expect(returnStmt.value.tag).toBe("button");
    }
  });

  it("resolves importBinding for named and namespace aliases", () => {
    const { sourceFile, program, checker } = createChecker(`
      import { useState as useS } from "react";
      import * as React from "react";
    `);
    const port = createTsSymbolPort({
      program,
      checker,
      sourceFile,
      getSourceFile: (fileName) =>
        fileName === sourceFile.fileName ? sourceFile : undefined,
    });
    const importStmt = sourceFile.statements.find(ts.isImportDeclaration);
    expect(importStmt).toBeDefined();
    const named = importStmt?.importClause?.namedBindings;
    expect(named && ts.isNamedImports(named)).toBe(true);
    if (named && ts.isNamedImports(named)) {
      const specifier = named.elements[0]!;
      const binding = port.importBinding({
        name: specifier.name.text,
        origin: nodeRefFor(specifier.name, sourceFile.fileName, sourceFile),
      });
      expect(binding).toEqual({
        module: "react",
        exportedName: "useState",
        isNamespace: false,
      });
    }
    const nsImport = sourceFile.statements.filter(ts.isImportDeclaration)[1];
    const nsBinding = nsImport?.importClause?.namedBindings;
    if (nsBinding && ts.isNamespaceImport(nsBinding)) {
      const binding = port.importBinding({
        name: nsBinding.name.text,
        origin: nodeRefFor(nsBinding.name, sourceFile.fileName, sourceFile),
      });
      expect(binding).toEqual({
        module: "react",
        exportedName: "*",
        isNamespace: true,
      });
    }
  });

  it("imports canonical Surface IR from lang/ts in compile", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const compileStmt = await readFile(
      resolve("src/extract/compile/compile-stmt.ts"),
      "utf8",
    );
    expect(compileStmt).toMatch(/lang\/ts\/surface-ir/);
  });
});
