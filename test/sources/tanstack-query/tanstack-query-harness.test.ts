import { describe, expect, it } from "vitest";
import { tanstackQuerySource } from "modality-ts/extract/sources/tanstack-query";
import {
  observe,
  setup,
  type TanstackQueryClientLike,
} from "../../../src/extract/sources/tanstack-query/harness.js";

describe("TanStack Query harness", () => {
  it("observes query data/status/fetchStatus from a QueryClient", () => {
    const queryClient: TanstackQueryClientLike = {
      getQueryData: () => ["todo"],
      getQueryState: () => ({
        status: "success",
        fetchStatus: "idle",
        isStale: false,
        failureCount: 0,
      }),
    };
    const handles = setup({ queryClient });
    expect(observe("tanstack-query:todos:data", handles)).toEqual({
      value: ["todo"],
    });
    expect(observe("tanstack-query:todos:status", handles)).toEqual({
      value: "success",
    });
    expect(observe("tanstack-query:todos:fetchStatus", handles)).toEqual({
      value: "idle",
    });
    expect(
      tanstackQuerySource().harness.observe(
        "tanstack-query:todos:status",
        handles,
      ),
    ).toEqual({ value: "success" });
  });

  it("observes mutation status from mutation cache", () => {
    const queryClient: TanstackQueryClientLike = {
      getQueryData: () => undefined,
      getQueryState: () => undefined,
      getMutationCache: () => ({
        findAll: () => [
          {
            state: {
              status: "success",
              data: { id: 1 },
              error: null,
              variables: { title: "x" },
              failureCount: 0,
            },
          },
        ],
      }),
    };
    const handles = setup({ queryClient });
    expect(observe("tanstack-mutation:create:status", handles)).toEqual({
      value: "success",
    });
    expect(observe("tanstack-mutation:create:data", handles)).toEqual({
      value: { id: 1 },
    });
  });

  it("falls back to initial model state and returns unobservable otherwise", () => {
    expect(
      observe(
        "tanstack-query:todos:status",
        setup({ initialState: { "tanstack-query:todos:status": "pending" } }),
      ),
    ).toEqual({ value: "pending" });
    expect(observe("tanstack-query:missing:status", setup({}))).toBe(
      "unobservable",
    );
  });

  it("uses isolated QueryClient handles per setup call", () => {
    const clientA: TanstackQueryClientLike = {
      getQueryData: () => "a",
      getQueryState: () => ({ status: "success" }),
    };
    const clientB: TanstackQueryClientLike = {
      getQueryData: () => "b",
      getQueryState: () => ({ status: "pending" }),
    };
    expect(
      observe("tanstack-query:todos:data", setup({ queryClient: clientA })),
    ).toEqual({
      value: "a",
    });
    expect(
      observe("tanstack-query:todos:status", setup({ queryClient: clientB })),
    ).toEqual({
      value: "pending",
    });
  });
});
