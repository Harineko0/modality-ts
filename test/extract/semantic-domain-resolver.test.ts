import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import {
  inferDomainFromExpressionSemanticDetailed,
  inferDomainFromTypeDetailed,
  inferDomainFromTypeNodeSemanticDetailed,
} from "modality-ts/extract/engine";
import { createSemanticProjectForTest } from "../../src/extract/engine/ts/semantic-project.js";

const projectRoot = resolve("/project");

function semanticCtx(
  files: { path: string; text: string }[],
  entryPath: string,
  find: (source: ts.SourceFile) => ts.Node | undefined,
) {
  const semanticProject = createSemanticProjectForTest(files);
  const sourceFile = semanticProject.getSourceFile(entryPath);
  expect(sourceFile).toBeDefined();
  if (!sourceFile) throw new Error("missing source file");
  const node = find(sourceFile);
  expect(node).toBeDefined();
  if (!node) throw new Error("missing node");
  return {
    checker: semanticProject.checker,
    sourceFile,
    node,
  };
}

describe("semantic domain resolver", () => {
  it("resolves imported string literal unions as enum", () => {
    const typesPath = resolve(projectRoot, "types.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const { checker, sourceFile, node } = semanticCtx(
      [
        {
          path: typesPath,
          text: `export type Status = "idle" | "posting" | "failed";`,
        },
        {
          path: appPath,
          text: `import type { Status } from "./types.js";
import { useState } from "react";
export function App() {
  const [saveStatus] = useState<Status>("idle");
  return null;
}`,
        },
      ],
      appPath,
      (source) => {
        let call: ts.CallExpression | undefined;
        const visit = (current: ts.Node): void => {
          if (
            ts.isCallExpression(current) &&
            current.expression.getText(source) === "useState"
          ) {
            call = current;
            return;
          }
          ts.forEachChild(current, visit);
        };
        visit(source);
        return call?.typeArguments?.[0];
      },
    );
    const typeNode = node as ts.TypeNode;
    const result = inferDomainFromTypeNodeSemanticDetailed(typeNode, {
      checker,
      sourceFile,
    });
    expect(result.domain).toEqual({
      kind: "enum",
      values: ["idle", "posting", "failed"],
    });
  });

  it("resolves imported interfaces as record domains", () => {
    const typesPath = resolve(projectRoot, "types.ts");
    const appPath = resolve(projectRoot, "App.tsx");
    const { checker, sourceFile, node } = semanticCtx(
      [
        {
          path: typesPath,
          text: `export interface User {
  role: "admin" | "user";
  active: boolean;
}`,
        },
        {
          path: appPath,
          text: `import type { User } from "./types.js";
import { useState } from "react";
export function App() {
  const [user] = useState<User>({ role: "admin", active: true });
  return null;
}`,
        },
      ],
      appPath,
      (source) => {
        let call: ts.CallExpression | undefined;
        const visit = (current: ts.Node): void => {
          if (
            ts.isCallExpression(current) &&
            current.expression.getText(source) === "useState"
          ) {
            call = current;
            return;
          }
          ts.forEachChild(current, visit);
        };
        visit(source);
        return call?.typeArguments?.[0];
      },
    );
    const result = inferDomainFromTypeNodeSemanticDetailed(
      node as ts.TypeNode,
      {
        checker,
        sourceFile,
      },
    );
    expect(result.domain).toEqual({
      kind: "record",
      fields: {
        role: { kind: "enum", values: ["admin", "user"] },
        active: { kind: "bool" },
      },
    });
  });

  it("wraps nullable unions as option", () => {
    const typesPath = resolve(projectRoot, "types.ts");
    const appPath = resolve(projectRoot, "state.ts");
    const { checker, sourceFile, node } = semanticCtx(
      [
        {
          path: typesPath,
          text: `export type Status = "idle" | "done";`,
        },
        {
          path: appPath,
          text: `import type { Status } from "./types.js";
export type MaybeStatus = Status | null | undefined;
export const value: MaybeStatus = "idle";`,
        },
      ],
      appPath,
      (source) => {
        let alias: ts.TypeAliasDeclaration | undefined;
        const visit = (current: ts.Node): void => {
          if (
            ts.isTypeAliasDeclaration(current) &&
            current.name.text === "MaybeStatus"
          ) {
            alias = current;
          }
          ts.forEachChild(current, visit);
        };
        visit(source);
        return alias?.type;
      },
    );
    const result = inferDomainFromTypeNodeSemanticDetailed(
      node as ts.TypeNode,
      {
        checker,
        sourceFile,
      },
    );
    expect(result.domain).toEqual({
      kind: "option",
      inner: { kind: "enum", values: ["idle", "done"] },
    });
  });

  it("resolves discriminated unions as tagged", () => {
    const typesPath = resolve(projectRoot, "types.ts");
    const appPath = resolve(projectRoot, "state.ts");
    const { checker, sourceFile, node } = semanticCtx(
      [
        {
          path: typesPath,
          text: `export type Data = { id: string };
export type Result =
  | { kind: "ok"; data: Data }
  | { kind: "err"; message: string };`,
        },
        {
          path: appPath,
          text: `import type { Result } from "./types.js";
export const value: Result = { kind: "ok", data: { id: "x" } };`,
        },
      ],
      appPath,
      (source) => {
        let decl: ts.VariableDeclaration | undefined;
        const visit = (current: ts.Node): void => {
          if (
            ts.isVariableDeclaration(current) &&
            ts.isIdentifier(current.name) &&
            current.name.text === "value" &&
            current.type
          ) {
            decl = current;
          }
          ts.forEachChild(current, visit);
        };
        visit(source);
        return decl?.type;
      },
    );
    const result = inferDomainFromTypeNodeSemanticDetailed(
      node as ts.TypeNode,
      {
        checker,
        sourceFile,
      },
    );
    expect(result.domain.kind).toBe("tagged");
    if (result.domain.kind !== "tagged") return;
    expect(result.domain.tag).toBe("kind");
    expect(Object.keys(result.domain.variants).sort()).toEqual(["err", "ok"]);
  });

  it("resolves readonly arrays as lengthCat", () => {
    const typesPath = resolve(projectRoot, "types.ts");
    const appPath = resolve(projectRoot, "state.ts");
    const { checker, sourceFile, node } = semanticCtx(
      [
        {
          path: typesPath,
          text: `export type Item = { id: string };
export type Items = readonly Item[];`,
        },
        {
          path: appPath,
          text: `import type { Items } from "./types.js";
export const value: Items = [];`,
        },
      ],
      appPath,
      (source) => {
        let decl: ts.VariableDeclaration | undefined;
        const visit = (current: ts.Node): void => {
          if (
            ts.isVariableDeclaration(current) &&
            ts.isIdentifier(current.name) &&
            current.name.text === "value" &&
            current.type
          ) {
            decl = current;
          }
          ts.forEachChild(current, visit);
        };
        visit(source);
        return decl?.type;
      },
    );
    const result = inferDomainFromTypeNodeSemanticDetailed(
      node as ts.TypeNode,
      {
        checker,
        sourceFile,
      },
    );
    expect(result.domain).toEqual({ kind: "lengthCat" });
  });

  it("falls back to tokens for recursive types", () => {
    const appPath = resolve(projectRoot, "state.ts");
    const { checker, sourceFile, node } = semanticCtx(
      [
        {
          path: appPath,
          text: `export type Node = { value: "x"; next?: Node };
export const value: Node = { value: "x" };`,
        },
      ],
      appPath,
      (source) => {
        let decl: ts.VariableDeclaration | undefined;
        const visit = (current: ts.Node): void => {
          if (
            ts.isVariableDeclaration(current) &&
            ts.isIdentifier(current.name) &&
            current.name.text === "value" &&
            current.type
          ) {
            decl = current;
          }
          ts.forEachChild(current, visit);
        };
        visit(source);
        return decl?.type;
      },
    );
    const result = inferDomainFromTypeNodeSemanticDetailed(
      node as ts.TypeNode,
      {
        checker,
        sourceFile,
      },
    );
    expect(result.domain).toEqual({ kind: "tokens", count: 1 });
  });

  it("keeps broad number as tokens with caveat", () => {
    const appPath = resolve(projectRoot, "App.tsx");
    const { checker, sourceFile, node } = semanticCtx(
      [
        {
          path: appPath,
          text: `import { useState } from "react";
export function App() {
  const [count] = useState<number>(0);
  return null;
}`,
        },
      ],
      appPath,
      (source) => {
        let call: ts.CallExpression | undefined;
        const visit = (current: ts.Node): void => {
          if (
            ts.isCallExpression(current) &&
            current.expression.getText(source) === "useState"
          ) {
            call = current;
            return;
          }
          ts.forEachChild(current, visit);
        };
        visit(source);
        return call?.typeArguments?.[0];
      },
    );
    const result = inferDomainFromTypeNodeSemanticDetailed(
      node as ts.TypeNode,
      {
        checker,
        sourceFile,
        varId: "local:App.count",
      },
      new Set(),
      { varId: "local:App.count", sourceFile },
    );
    expect(result.domain).toEqual({ kind: "tokens", count: 1 });
    expect(result.caveats.length).toBeGreaterThan(0);
  });

  it("preserves sparse numeric unions as intSet", () => {
    const appPath = resolve(projectRoot, "state.ts");
    const semanticProject = createSemanticProjectForTest([
      {
        path: appPath,
        text: `export const value: 0 | 2 = 0;`,
      },
    ]);
    const sourceFile = semanticProject.getSourceFile(appPath);
    expect(sourceFile).toBeDefined();
    if (!sourceFile) return;
    let decl: ts.VariableDeclaration | undefined;
    const visit = (current: ts.Node): void => {
      if (
        ts.isVariableDeclaration(current) &&
        ts.isIdentifier(current.name) &&
        current.name.text === "value" &&
        current.type
      ) {
        decl = current;
      }
      ts.forEachChild(current, visit);
    };
    visit(sourceFile);
    expect(decl?.type).toBeDefined();
    if (!decl?.type) return;
    const type = semanticProject.checker.getTypeFromTypeNode(decl.type);
    const result = inferDomainFromTypeDetailed(type, {
      checker: semanticProject.checker,
      sourceFile,
    });
    expect(result.domain).toEqual({ kind: "intSet", values: [0, 2] });
  });

  it("does not narrow broad string from literal initializer", () => {
    const appPath = resolve(projectRoot, "App.tsx");
    const { checker, sourceFile, node } = semanticCtx(
      [
        {
          path: appPath,
          text: `import { useState } from "react";
export function App() {
  const [label] = useState<string>("idle");
  return null;
}`,
        },
      ],
      appPath,
      (source) => {
        let call: ts.CallExpression | undefined;
        const visit = (current: ts.Node): void => {
          if (
            ts.isCallExpression(current) &&
            current.expression.getText(source) === "useState"
          ) {
            call = current;
            return;
          }
          ts.forEachChild(current, visit);
        };
        visit(source);
        return call;
      },
    );
    const call = node as ts.CallExpression;
    const typeArg = call.typeArguments?.[0];
    const result = inferDomainFromExpressionSemanticDetailed(
      call.arguments[0]!,
      {
        checker,
        sourceFile,
        varId: "local:App.label",
      },
      new Map(),
      typeArg,
    );
    expect(result.domain).toEqual({ kind: "tokens", count: 1 });
  });
});
