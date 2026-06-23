import {
  createTanstackQueryTemplate,
  extractTanstackQuerySkeleton,
  queryKeyFromExpression,
  tanstackQuerySource,
  tanstackQueryView,
  templateForTanstackQueryDecl,
} from "modality-ts/extract/plugins/state/tanstack-query";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { createBuiltinModalityRegistry } from "../../../src/cli/registry/index.js";
import { createSemanticProjectForTest } from "../../../src/extract/engine/ts/semantic-project.js";

describe("TanStack Query source plugin", () => {
  it("exposes a StateSourcePlugin-compatible source slice", () => {
    const plugin = tanstackQuerySource();
    expect(plugin.id).toBe("tanstack-query");
    expect(plugin.packageNames).toEqual(["@tanstack/react-query"]);
    expect(
      plugin.discover({ sourceText: "", fileName: "App.tsx", route: "/" }),
    ).toEqual([]);
    expect(
      plugin.writeChannels({ sourceText: "", fileName: "App.tsx" }),
    ).toEqual([]);
    expect(
      plugin.safetyWarnings?.({ sourceText: "", fileName: "App.tsx" }),
    ).toEqual([]);
    expect(plugin.conformance?.testedVersions).toBe("@tanstack/react-query>=5");
  });

  it("registers when @tanstack/react-query is a dependency", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { "@tanstack/react-query": "^5.0.0", react: "^18.0.0" },
    });
    expect(registry.statePluginIds).toContain("tanstack-query");
  });

  it("is absent when @tanstack/react-query is not a dependency", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { react: "^18.0.0" },
      disabledPlugins: [],
    });
    expect(registry.statePluginIds).not.toContain("tanstack-query");
  });

  it("is absent when tanstack-query is disabled", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { "@tanstack/react-query": "^5.0.0" },
      disabledPlugins: ["tanstack-query"],
    });
    expect(registry.statePluginIds).not.toContain("tanstack-query");
  });

  it("discovers useQuery with static queryKey and creates template vars", () => {
    const source = `
      import { useQuery } from '@tanstack/react-query';
      export function Todos() {
        const { data } = useQuery({
          queryKey: ['todos'],
          queryFn: async () => [{ id: 1 }],
        });
        return <div>{String(data)}</div>;
      }
    `;
    const decls = tanstackQuerySource().discover({
      sourceText: source,
      fileName: "App.tsx",
      route: "/",
    });
    expect(decls).toHaveLength(1);
    expect(decls[0]?.id).toBe("tanstack-query:todos");
    expect(decls[0]?.kind).toBe("tanstack-query/useQuery");
    const template = templateForTanstackQueryDecl(decls[0]!);
    expect(template.vars.map((v) => v.id).sort()).toEqual([
      "tanstack-query:todos:data",
      "tanstack-query:todos:failureCount",
      "tanstack-query:todos:fetchStatus",
      "tanstack-query:todos:invalidated",
      "tanstack-query:todos:stale",
      "tanstack-query:todos:status",
    ]);
  });

  it("resolves semantic alias imports from @tanstack/react-query", () => {
    const source = `
      import { useQuery as rqUseQuery } from '@tanstack/react-query';
      export function Todos() {
        return rqUseQuery({ queryKey: ['todos'], queryFn: async () => [] });
      }
    `;
    const semanticProject = createSemanticProjectForTest([
      { path: "App.tsx", text: source },
      {
        path: "node_modules/@tanstack/react-query/index.d.ts",
        text: `export declare function useQuery(options: unknown): unknown;`,
      },
    ]);
    const sourceFile = semanticProject.getSourceFile("App.tsx");
    const types = {
      program: semanticProject.program,
      checker: semanticProject.checker,
      sourceFile,
      getSourceFile: (name: string) => semanticProject.getSourceFile(name),
      canonicalFileName: (name: string) =>
        semanticProject.canonicalFileName(name),
      resolveModuleName: (specifier: string, containingFile: string) =>
        semanticProject.resolveModuleName(specifier, containingFile),
      symbolAt: (node: ts.Node) => semanticProject.symbolAt(node),
      aliasedSymbolAt: (node: ts.Node) => semanticProject.aliasedSymbolAt(node),
      symbolKey: (symbol: ts.Symbol) => semanticProject.symbolKey(symbol),
      localSymbolKey: (node: ts.Node) => semanticProject.localSymbolKey(node),
    };
    const decls = tanstackQuerySource().discover({
      sourceText: source,
      fileName: "App.tsx",
      route: "/",
      types,
    });
    expect(decls).toHaveLength(1);
    expect(decls[0]?.id).toBe("tanstack-query:todos");
  });

  it("canonicalizes object literal query keys independent of property order", () => {
    const keyA = queryKeyFromExpression(parseExpr(`({ b: 'y', a: 'x' })`));
    const keyB = queryKeyFromExpression(parseExpr(`({ a: 'x', b: 'y' })`));
    expect(keyA?.id).toBe(keyB?.id);
    expect(keyA?.display).toBe(keyB?.display);
  });

  it("infers payload domain from useQuery<TData> type argument", () => {
    const source = `
      import { useQuery } from '@tanstack/react-query';
      type Todo = { id: number };
      export function Todos() {
        return useQuery<Todo[]>({
          queryKey: ['todos'],
          queryFn: async () => [{ id: 1 }],
        });
      }
    `;
    const decls = tanstackQuerySource().discover({
      sourceText: source,
      fileName: "App.tsx",
      route: "/",
    });
    const metadata = decls[0]?.metadata as { payloadDomain?: { kind: string } };
    expect(metadata?.payloadDomain?.kind).toBe("lengthCat");
  });

  it("models enabled:false without automatic mount fetch transition guard", () => {
    const source = `
      import { useQuery } from '@tanstack/react-query';
      export function Todos({ id }: { id?: string }) {
        return useQuery({
          queryKey: ['todo', id],
          queryFn: async () => ({ id }),
          enabled: false,
        });
      }
    `;
    const decls = tanstackQuerySource().discover({
      sourceText: source,
      fileName: "App.tsx",
      route: "/",
    });
    const metadata = decls[0]?.metadata as { enabled?: boolean };
    expect(metadata?.enabled).toBe(false);
    const template = templateForTanstackQueryDecl(decls[0]!);
    expect(
      template.transitions.some((t) => t.id.includes(":fetch:mount")),
    ).toBe(false);
  });

  it("treats initialData as cache seed and placeholderData as view-only metadata", () => {
    const withInitial = `
      import { useQuery } from '@tanstack/react-query';
      export function Todos() {
        return useQuery({
          queryKey: ['todos'],
          queryFn: async () => [],
          initialData: [],
        });
      }
    `;
    const decls = tanstackQuerySource().discover({
      sourceText: withInitial,
      fileName: "App.tsx",
      route: "/",
    });
    const metadata = decls[0]?.metadata as { hasInitialData?: boolean };
    expect(metadata?.hasInitialData).toBe(true);
    const template = templateForTanstackQueryDecl(decls[0]!);
    const statusVar = template.vars.find((v) => v.id.endsWith(":status"));
    expect(statusVar?.initial).toBe("success");

    const withPlaceholder = `
      import { useQuery } from '@tanstack/react-query';
      export function Todos() {
        return useQuery({
          queryKey: ['draft'],
          queryFn: async () => [],
          placeholderData: 'placeholder',
        });
      }
    `;
    const placeholderDecls = tanstackQuerySource().discover({
      sourceText: withPlaceholder,
      fileName: "App.tsx",
      route: "/",
    });
    const placeholderMeta = placeholderDecls[0]?.metadata as {
      hasPlaceholderData?: boolean;
    };
    expect(placeholderMeta?.hasPlaceholderData).toBe(true);
    const view = tanstackQueryView({}, "draft", {
      placeholderData: "placeholder",
    });
    expect(view.data).toBe("placeholder");
  });

  it("records select projection without mutating cache payload domain", () => {
    const source = `
      import { useQuery } from '@tanstack/react-query';
      export function Todos() {
        return useQuery({
          queryKey: ['todos'],
          queryFn: async () => [{ id: 1 }],
          select: (data) => data.length,
        });
      }
    `;
    const decls = tanstackQuerySource().discover({
      sourceText: source,
      fileName: "App.tsx",
      route: "/",
    });
    const metadata = decls[0]?.metadata as {
      selectProjection?: string;
      payloadDomain?: { kind: string };
    };
    expect(metadata?.selectProjection).toBe("length");
    expect(metadata?.payloadDomain?.kind).toBe("lengthCat");
  });

  it("omits focus/reconnect env refetch when statically disabled", () => {
    const template = createTanstackQueryTemplate({
      id: "todos",
      op: "QUERY todos",
      payloadDomain: { kind: "lengthCat" },
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
    expect(
      template.transitions.some((t) => t.id.includes(":refetch:focus")),
    ).toBe(false);
    expect(
      template.transitions.some((t) => t.id.includes(":refetch:reconnect")),
    ).toBe(false);
  });

  it("keeps last successful data on error resolve (TanStack Query v5 semantics)", () => {
    const template = createTanstackQueryTemplate({
      id: "todos",
      op: "QUERY todos",
      payloadDomain: { kind: "lengthCat" },
    });
    const errorTransition = template.transitions.find((t) =>
      t.id.endsWith(":resolve:error"),
    );
    expect(errorTransition?.writes).not.toContain("tanstack-query:todos:data");
    expect(errorTransition?.reads).toContain("tanstack-query:todos:data");
  });

  it("emits dynamic-key caveats for unbounded identifier keys", () => {
    const source = `
      import { useQuery } from '@tanstack/react-query';
      export function Todos({ userId }: { userId: string }) {
        return useQuery({
          queryKey: ['todos', userId],
          queryFn: async () => [],
        });
      }
    `;
    const warnings =
      tanstackQuerySource().safetyWarnings?.({
        sourceText: source,
        fileName: "App.tsx",
      }) ?? [];
    expect(warnings.some((w) => w.message.includes("dynamic"))).toBe(true);
  });

  it("extracts skeleton with query template transitions", () => {
    const source = `
      import { useQuery } from '@tanstack/react-query';
      export function Todos() {
        return useQuery({ queryKey: ['todos'], queryFn: async () => [] });
      }
    `;
    const skeleton = extractTanstackQuerySkeleton(source);
    expect(
      skeleton.vars.some((v) => v.id === "tanstack-query:todos:status"),
    ).toBe(true);
    expect(
      skeleton.transitions.some((t) => t.id.includes("tanstack-query:todos")),
    ).toBe(true);
  });
});

function parseExpr(code: string): ts.Expression {
  const source = ts.createSourceFile(
    "x.ts",
    `const _ = ${code};`,
    ts.ScriptTarget.Latest,
    true,
  );
  const statement = source.statements[0];
  if (!ts.isVariableStatement(statement)) throw new Error("expected variable");
  const decl = statement.declarationList.declarations[0];
  if (!decl?.initializer) throw new Error("expected initializer");
  return decl.initializer;
}
