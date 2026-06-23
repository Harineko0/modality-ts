import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { reactRouterEffectApiProvider } from "./index.js";
import {
  discoverReactRouterActionEffectApis,
  reactRouterActionOpId,
  reactRouterActionOutcomeHints,
  reactRouterLoaderOpId,
} from "./server-effects.js";

function parseActionBody(source: string): ts.Node | undefined {
  const file = ts.createSourceFile(
    "action.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const statement = file.statements[0];
  if (ts.isFunctionDeclaration(statement)) return statement.body;
  if (ts.isVariableStatement(statement)) {
    const init = statement.declarationList.declarations[0]?.initializer;
    if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)))
      return init.body;
  }
  return undefined;
}

describe("reactRouterEffectApiProvider", () => {
  it("discovers ACTION <route> operations", () => {
    const provider = reactRouterEffectApiProvider();
    const apis = provider.discoverEffectApis({
      fileName: "routes/drip.tsx",
      sourceText: `
        export async function action() {
          return { ok: true };
        }
      `,
      route: { pattern: "/drip", kind: "page", file: "routes/drip.tsx" },
    });
    expect(apis).toEqual([expect.objectContaining({ opId: "ACTION /drip" })]);
  });
});

describe("reactRouterActionOpId", () => {
  it("uses ACTION prefix with route pattern", () => {
    expect(reactRouterActionOpId("/drip")).toBe("ACTION /drip");
  });
});

describe("reactRouterLoaderOpId", () => {
  it("uses DATA prefix with route pattern", () => {
    expect(reactRouterLoaderOpId("/drip")).toBe("DATA /drip");
  });
});

describe("discoverReactRouterActionEffectApis", () => {
  it("discovers exported function action", () => {
    const apis = discoverReactRouterActionEffectApis({
      fileName: "routes/drip.tsx",
      sourceText: `
        export async function action() {
          return { ok: true };
        }
      `,
      route: { pattern: "/drip", kind: "page", file: "routes/drip.tsx" },
    });
    expect(apis).toEqual([expect.objectContaining({ opId: "ACTION /drip" })]);
  });

  it("discovers exported loader and action together", () => {
    const apis = discoverReactRouterActionEffectApis({
      fileName: "/repo/app/routes/items.tsx",
      sourceText: `
        export async function loader() {
          return { items: [] };
        }
        export async function action() {
          return { ok: true };
        }
      `,
      inventory: {
        routes: [{ pattern: "/items", kind: "page", file: "routes/items.tsx" }],
      },
    });
    expect(apis.map((entry) => entry.opId).sort()).toEqual([
      "ACTION /items",
      "DATA /items",
    ]);
  });

  it("discovers export const action", () => {
    const apis = discoverReactRouterActionEffectApis({
      fileName: "routes/items.tsx",
      sourceText: `
        export const action = async () => ({ ok: false, error: "bad" });
      `,
      route: { pattern: "/items", kind: "page", file: "routes/items.tsx" },
    });
    expect(apis).toEqual([expect.objectContaining({ opId: "ACTION /items" })]);
  });

  it("returns no ops without route pattern", () => {
    const apis = discoverReactRouterActionEffectApis({
      fileName: "lib/action.ts",
      sourceText: `export async function action() { return null; }`,
    });
    expect(apis).toEqual([]);
  });
});

describe("reactRouterActionOutcomeHints", () => {
  it("hints error for ok: false returns", () => {
    const body = parseActionBody(`
      export async function action() {
        return { ok: false };
      }
    `);
    expect(reactRouterActionOutcomeHints(body)).toEqual({
      success: false,
      error: true,
    });
  });

  it("hints error when error property is present", () => {
    const body = parseActionBody(`
      export async function action() {
        return { error: "nope" };
      }
    `);
    expect(reactRouterActionOutcomeHints(body)).toEqual({
      success: true,
      error: true,
    });
  });
});
