import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Model } from "modality-ts/core";
import { describe, expect, it } from "vitest";
import {
  assertObservationMapCoversModel,
  type BenchmarkObservationHandles,
  observeBenchmarkVar,
} from "../../benchmarks/shared/testing/observation-map.js";

describe("benchmark observation resolver", () => {
  it("routes model var ids by prefix and parsed structure", () => {
    const calls: string[] = [];
    const handles: BenchmarkObservationHandles = {
      jotai: (name) => {
        calls.push(`jotai:${name}`);
        return "atom-value";
      },
      swr: (hook, field) => {
        calls.push(`swr:${hook}:${field}`);
        return "swr-value";
      },
      zustand: (store, field) => {
        calls.push(`zustand:${store}:${field}`);
        return "zustand-value";
      },
      useState: (component, field) => {
        calls.push(`local:${component}:${field}`);
        return "local-value";
      },
      route: () => {
        calls.push("sys:route");
        return "/dashboard";
      },
      pending: () => {
        calls.push("sys:pending");
        return [];
      },
      history: () => {
        calls.push("sys:history");
        return ["/login", "/dashboard"];
      },
    };

    expect(observeBenchmarkVar("atom:x", handles)).toBe("atom-value");
    expect(
      observeBenchmarkVar("atom:x@store:provider:AppProviders", handles),
    ).toBe("atom-value");
    expect(observeBenchmarkVar("swr:useFoo:data", handles)).toBe("swr-value");
    expect(observeBenchmarkVar("zustand:useBar.baz", handles)).toBe(
      "zustand-value",
    );
    expect(observeBenchmarkVar("local:Comp.field", handles)).toBe(
      "local-value",
    );
    expect(observeBenchmarkVar("sys:route", handles)).toBe("/dashboard");
    expect(observeBenchmarkVar("sys:pending", handles)).toEqual([]);
    expect(observeBenchmarkVar("sys:history", handles)).toEqual([
      "/login",
      "/dashboard",
    ]);
    expect(observeBenchmarkVar("redux:store.field", handles)).toBe(
      "unobservable",
    );

    expect(calls).toEqual([
      "jotai:x",
      "jotai:x",
      "swr:useFoo:data",
      "zustand:useBar:baz",
      "local:Comp:field",
      "sys:route",
      "sys:pending",
      "sys:history",
    ]);
  });

  it("covers the extracted benchmark model var id schemes", () => {
    for (const modelPath of [
      ".modality/ledgerops-react-router.model.json",
      ".modality/ledgerops-nextjs.model.json",
    ]) {
      const model = JSON.parse(
        readFileSync(resolve(modelPath), "utf8"),
      ) as Model;
      expect(() => assertObservationMapCoversModel(model)).not.toThrow();
    }
  });
});
