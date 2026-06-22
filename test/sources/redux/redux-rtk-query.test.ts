import { reduxSource } from "modality-ts/extract/sources/redux";
import { describe, expect, it } from "vitest";
import { templateForReduxDecl } from "../../../src/extract/sources/redux/template.js";
import { queryMetadataToRecord } from "../../../src/extract/sources/redux/types.js";

describe("Redux RTK Query", () => {
  it("discovers createApi query endpoint template decls", () => {
    const source = `
      import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
      export const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/' }),
        endpoints: (build) => ({
          getTodos: build.query({ query: () => 'todos' }),
        }),
      });
    `;
    const decls = reduxSource().discover({
      sourceText: source,
      fileName: "api.ts",
      route: "/",
    });
    expect(decls.some((decl) => decl.kind === "redux-query/useQuery")).toBe(
      true,
    );
    const queryDecl = decls.find(
      (decl) => decl.kind === "redux-query/useQuery",
    );
    const template = templateForReduxDecl(queryDecl!);
    expect(template.vars.length).toBeGreaterThan(0);
    expect(template.transitions.length).toBeGreaterThan(0);
  });

  it("discovers mutation endpoints", () => {
    const source = `
      import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
      export const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/' }),
        endpoints: (build) => ({
          updateTodo: build.mutation({ query: (id) => ({ url: \`todo/\${id}\` }) }),
        }),
      });
    `;
    const decls = reduxSource().discover({
      sourceText: source,
      fileName: "api.ts",
      route: "/",
    });
    expect(decls.some((decl) => decl.kind === "redux-query/useMutation")).toBe(
      true,
    );
  });

  it("caveats dynamic query keys in hooks", () => {
    const source = `
      import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
      const api = createApi({
        reducerPath: 'api',
        baseQuery: fetchBaseQuery({ baseUrl: '/' }),
        endpoints: (build) => ({
          getThing: build.query({ query: (arg) => \`thing/\${arg}\` }),
        }),
      });
      export const { useGetThingQuery } = api;
      export function App({ id }: { id: string }) {
        const result = useGetThingQuery(id);
        return String(result.data);
      }
    `;
    const warnings = reduxSource().safetyWarnings?.({
      sourceText: source,
      fileName: "App.tsx",
    });
    expect(
      warnings?.some((warning) => warning.message.includes("dynamic key")),
    ).toBe(true);
  });

  it("generates query template vars with redux-query prefix", () => {
    const template = templateForReduxDecl({
      id: "redux-query:api:getTodos",
      kind: "redux-query/useQuery",
      origin: "system",
      metadata: queryMetadataToRecord({
        apiName: "api",
        endpoint: "getTodos",
        keyId: "default",
        reducerPath: "api",
        op: "query",
        payloadDomain: { kind: "tokens", count: 1 },
      }),
    });
    expect(template.vars.map((v) => v.id)).toEqual(
      expect.arrayContaining([
        "redux-query:api:getTodos:default:status",
        "redux-query:api:getTodos:default:data",
      ]),
    );
  });
});
