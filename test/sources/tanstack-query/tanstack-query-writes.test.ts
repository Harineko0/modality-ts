import { describe, expect, it } from "vitest";
import {
  createTanstackQueryTemplate,
  tanstackQuerySource,
} from "modality-ts/extract/sources/tanstack-query";
import { summarizeTanstackQueryWrite } from "../../../src/extract/sources/tanstack-query/writes.js";

describe("TanStack Query write summarization", () => {
  it("models invalidateQueries as stale + invalidated flags", () => {
    const effect = summarizeTanstackQueryWrite(
      {
        callee: "queryClient.invalidateQueries",
        arguments: [{ queryKey: ["todos"] }],
        source: { file: "App.tsx" },
      },
      { read: (name) => ({ kind: "read", var: name }) },
    );
    expect(effect).toEqual({
      kind: "seq",
      effects: [
        {
          kind: "assign",
          var: "tanstack-query:unknown:stale",
          expr: { kind: "lit", value: true },
        },
        {
          kind: "assign",
          var: "tanstack-query:unknown:invalidated",
          expr: { kind: "lit", value: true },
        },
      ],
    });
  });

  it("models setQueryData with literal value as data + success status", () => {
    const effect = summarizeTanstackQueryWrite(
      {
        callee: "queryClient.setQueryData",
        arguments: [["todos"], "many"],
        source: { file: "App.tsx" },
      },
      { read: (name) => ({ kind: "read", var: name }) },
    );
    expect(effect).toMatchObject({
      kind: "seq",
      effects: expect.arrayContaining([
        {
          kind: "assign",
          var: "tanstack-query:todos:data",
          expr: { kind: "lit", value: "many" },
        },
        {
          kind: "assign",
          var: "tanstack-query:todos:status",
          expr: { kind: "lit", value: "success" },
        },
      ]),
    });
  });

  it("havocs data when setQueryData receives a dynamic updater", () => {
    const effect = summarizeTanstackQueryWrite(
      {
        callee: "queryClient.setQueryData",
        arguments: [["todos"], "(old) => old"],
        source: { file: "App.tsx" },
      },
      { read: (name) => ({ kind: "read", var: name }) },
    );
    expect(effect).toEqual({
      kind: "havoc",
      var: "tanstack-query:unknown:data",
    });
  });

  it("discovers queryClient invalidateQueries write channels for known keys", () => {
    const source = `
      import { useQuery, useQueryClient } from '@tanstack/react-query';
      export function Todos() {
        const queryClient = useQueryClient();
        const q = useQuery({ queryKey: ['todos'], queryFn: async () => [] });
        return <button onClick={() => queryClient.invalidateQueries({ queryKey: ['todos'] })}>x</button>;
      }
    `;
    const channels = tanstackQuerySource().writeChannels({
      sourceText: source,
      fileName: "App.tsx",
    });
    expect(
      channels.some(
        (c) => c.id.includes("invalidateQueries") && c.id.includes("todos"),
      ),
    ).toBe(true);
  });

  it("distinguishes exact vs prefix filter matching in discovered channels", () => {
    const source = `
      import { useQuery, useQueryClient } from '@tanstack/react-query';
      export function Todos() {
        const queryClient = useQueryClient();
        useQuery({ queryKey: ['todos'], queryFn: async () => [] });
        useQuery({ queryKey: ['todos', 'a'], queryFn: async () => [] });
        queryClient.invalidateQueries({ queryKey: ['todos'], exact: true });
        queryClient.invalidateQueries({ queryKey: ['todos'] });
        return null;
      }
    `;
    const channels = tanstackQuerySource().writeChannels({
      sourceText: source,
      fileName: "App.tsx",
    });
    const invalidateChannels = channels.filter((c) =>
      c.id.includes("invalidateQueries"),
    );
    expect(invalidateChannels.some((c) => c.id.includes("todos"))).toBe(true);
    expect(invalidateChannels.length).toBeGreaterThanOrEqual(2);
  });

  it("models removeQueries and resetQueries effects in template", () => {
    const template = createTanstackQueryTemplate({
      id: "todos",
      op: "QUERY todos",
      payloadDomain: { kind: "lengthCat" },
    });
    expect(template.transitions.some((t) => t.id.endsWith(":remove"))).toBe(
      true,
    );
    expect(template.transitions.some((t) => t.id.endsWith(":reset"))).toBe(
      true,
    );
    expect(template.transitions.some((t) => t.id.endsWith(":cancel"))).toBe(
      true,
    );
  });

  it("emits predicate filter caveats instead of silent no-ops", () => {
    const source = `
      import { useQueryClient } from '@tanstack/react-query';
      export function Todos() {
        const queryClient = useQueryClient();
        queryClient.invalidateQueries({ predicate: () => true });
        return null;
      }
    `;
    const warnings =
      tanstackQuerySource().safetyWarnings?.({
        sourceText: source,
        fileName: "App.tsx",
      }) ?? [];
    expect(warnings.some((w) => w.message.includes("predicate"))).toBe(true);
  });
});
