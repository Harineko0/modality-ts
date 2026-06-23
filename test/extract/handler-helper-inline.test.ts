import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { isExtractableHandler } from "../../src/extract/lang/ts/driver/ast.js";
import { flattenHandlerHelpers } from "../../src/extract/lang/ts/driver/transition/helper-inline.js";
import type { ExtractableHandler } from "../../src/extract/lang/ts/driver/types.js";

function parseSource(text: string): ts.SourceFile {
  return ts.createSourceFile(
    "helper-inline.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function handlersFrom(source: ts.SourceFile): Map<string, ExtractableHandler> {
  const handlers = new Map<string, ExtractableHandler>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isExtractableHandler(node.initializer)
    ) {
      handlers.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return handlers;
}

function handlerStatements(
  source: ts.SourceFile,
  name = "handler",
): readonly ts.Statement[] {
  const handler = handlersFrom(source).get(name);
  if (!handler || !ts.isBlock(handler.body)) {
    throw new Error(`Missing block handler ${name}`);
  }
  return handler.body.statements;
}

describe("flattenHandlerHelpers", () => {
  it("splices a zero-arg helper body in place of await helper()", () => {
    const source = parseSource(`
      const requestProjectRestart = () => {
        restartProject({ ref });
      };
      const handler = async () => {
        await requestProjectRestart();
      };
    `);

    const flat = flattenHandlerHelpers(handlerStatements(source), {
      handlers: handlersFrom(source),
      setters: new Map(),
    });

    expect(flat.inlinedHelpers).toEqual(["requestProjectRestart"]);
    expect(flat.statements).toHaveLength(1);
    expect(flat.statements[0]?.getText(source)).toBe(
      "restartProject({ ref });",
    );
  });

  it("splices a zero-arg helper body in place of helper()", () => {
    const source = parseSource(`
      const req = () => {
        restartProject({ ref });
      };
      const handler = () => {
        req();
      };
    `);

    const flat = flattenHandlerHelpers(handlerStatements(source), {
      handlers: handlersFrom(source),
      setters: new Map(),
    });

    expect(flat.inlinedHelpers).toEqual(["req"]);
    expect(flat.statements[0]?.getText(source)).toBe(
      "restartProject({ ref });",
    );
  });

  it("leaves fixed-arg helper calls untouched", () => {
    const source = parseSource(`
      const req = (ref: string) => {
        restartProject({ ref });
      };
      const handler = () => {
        req(projectRef);
      };
    `);

    const flat = flattenHandlerHelpers(handlerStatements(source), {
      handlers: handlersFrom(source),
      setters: new Map(),
    });

    expect(flat.inlinedHelpers).toEqual([]);
    expect(flat.statements[0]?.getText(source)).toBe("req(projectRef);");
  });

  it("breaks recursion on a self-referential helper", () => {
    const source = parseSource(`
      const req = () => {
        req();
      };
      const handler = () => {
        req();
      };
    `);

    const flat = flattenHandlerHelpers(handlerStatements(source), {
      handlers: handlersFrom(source),
      setters: new Map(),
    });

    expect(flat.inlinedHelpers).toEqual(["req"]);
    expect(flat.statements[0]?.getText(source)).toBe("req();");
  });

  it("respects maxDepth", () => {
    const source = parseSource(`
      const c = () => {
        restartProject({ ref });
      };
      const b = () => {
        c();
      };
      const a = () => {
        b();
      };
      const handler = () => {
        a();
      };
    `);

    const flat = flattenHandlerHelpers(handlerStatements(source), {
      handlers: handlersFrom(source),
      setters: new Map(),
      maxDepth: 1,
    });

    expect(flat.inlinedHelpers).toEqual(["a"]);
    expect(flat.statements[0]?.getText(source)).toBe("b();");
  });
});
