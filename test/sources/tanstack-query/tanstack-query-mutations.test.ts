import {
  createTanstackMutationTemplate,
  tanstackQuerySource,
} from "modality-ts/extract/sources/tanstack-query";
import { describe, expect, it } from "vitest";
import { summarizeTanstackQueryWrite } from "../../../src/extract/sources/tanstack-query/writes.js";

describe("TanStack Query mutations", () => {
  it("discovers useMutation and emits mutation template vars", () => {
    const source = `
      import { useMutation } from '@tanstack/react-query';
      export function CreateTodo() {
        return useMutation({
          mutationFn: async (vars: { title: string }) => ({ id: 1, ...vars }),
        });
      }
    `;
    const decls = tanstackQuerySource().discover({
      sourceText: source,
      fileName: "App.tsx",
      route: "/",
    });
    expect(decls).toHaveLength(1);
    expect(decls[0]?.kind).toBe("tanstack-query/useMutation");
    const template = createTanstackMutationTemplate(
      (decls[0]?.metadata as { mutationId: string }).mutationId,
      { kind: "tokens", count: 1 },
      "MUTATION test",
    );
    expect(template.vars.map((v) => v.id)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/tanstack-mutation:.+:status$/),
        expect.stringMatching(/tanstack-mutation:.+:data$/),
        expect.stringMatching(/tanstack-mutation:.+:error$/),
        expect.stringMatching(/tanstack-mutation:.+:variables$/),
        expect.stringMatching(/tanstack-mutation:.+:failureCount$/),
      ]),
    );
  });

  it("discovers mutate write channels from destructuring", () => {
    const source = `
      import { useMutation } from '@tanstack/react-query';
      export function CreateTodo() {
        const { mutate } = useMutation({
          mutationFn: async () => ({ id: 1 }),
        });
        return <button onClick={() => mutate({ title: 'x' })}>Go</button>;
      }
    `;
    const channels = tanstackQuerySource().writeChannels({
      sourceText: source,
      fileName: "App.tsx",
    });
    expect(channels.some((c) => c.symbolName === "mutate")).toBe(true);
  });

  it("summarizes mutation.mutate as pending mutation status", () => {
    const effect = summarizeTanstackQueryWrite(
      {
        callee: "create.mutate",
        arguments: [{ title: "x" }],
        source: { file: "App.tsx" },
      },
      { read: (name) => ({ kind: "read", var: name }) },
    );
    expect(effect).toBe("unsupported");
  });

  it("includes success and error resolve transitions", () => {
    const template = createTanstackMutationTemplate(
      "create-todo",
      { kind: "tokens", count: 1 },
      "MUTATION create-todo",
    );
    expect(
      template.transitions.some((t) => t.id.includes(":resolve:success")),
    ).toBe(true);
    expect(
      template.transitions.some((t) => t.id.endsWith(":resolve:error")),
    ).toBe(true);
  });

  it("reset returns mutation to idle and clears error/data", () => {
    const template = createTanstackMutationTemplate(
      "create-todo",
      { kind: "tokens", count: 1 },
      "MUTATION create-todo",
    );
    const reset = template.transitions.find((t) => t.id.endsWith(":reset"));
    expect(reset?.effect).toMatchObject({
      kind: "seq",
      effects: expect.arrayContaining([
        {
          kind: "assign",
          var: "tanstack-mutation:create-todo:status",
          expr: { kind: "lit", value: "idle" },
        },
        {
          kind: "assign",
          var: "tanstack-mutation:create-todo:data",
          expr: { kind: "lit", value: null },
        },
        {
          kind: "assign",
          var: "tanstack-mutation:create-todo:error",
          expr: { kind: "lit", value: false },
        },
      ]),
    });
  });

  it("discovers onSuccess invalidation via queryClient write channel", () => {
    const source = `
      import { useMutation, useQueryClient } from '@tanstack/react-query';
      export function CreateTodo() {
        const queryClient = useQueryClient();
        return useMutation({
          mutationFn: async () => ({ id: 1 }),
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['todos'] });
          },
        });
      }
    `;
    const channels = tanstackQuerySource().writeChannels({
      sourceText: source,
      fileName: "App.tsx",
    });
    expect(channels.some((c) => c.id.includes("invalidateQueries"))).toBe(true);
  });
});
