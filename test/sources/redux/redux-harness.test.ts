import { reduxSource } from "modality-ts/extract/sources/redux";
import { describe, expect, it } from "vitest";
import {
  observe,
  providerWrapperMetadata,
  setup,
} from "../../../src/extract/sources/redux/harness.js";

describe("Redux harness", () => {
  it("observes nested Redux state through a real store handle", () => {
    const handles = setup({
      store: {
        getState: () => ({
          counter: { value: 2 },
          user: { profile: { name: "ada" } },
        }),
      },
    });
    expect(observe("redux:store.counter.value", handles)).toEqual({ value: 2 });
    expect(observe("redux:store.user.profile.name", handles)).toEqual({
      value: "ada",
    });
  });

  it("observes multiple named stores", () => {
    const handles = setup({
      stores: {
        storeA: { getState: () => ({ a: { x: 1 } }) },
        storeB: { getState: () => ({ b: { y: 2 } }) },
      },
    });
    expect(observe("redux:storeA.a.x", handles)).toEqual({ value: 1 });
    expect(observe("redux:storeB.b.y", handles)).toEqual({ value: 2 });
  });

  it("falls back to initialState and returns unobservable when missing", () => {
    expect(
      observe(
        "redux:store.counter.value",
        setup({ initialState: { "redux:store.counter.value": 5 } }),
      ),
    ).toEqual({ value: 5 });
    expect(observe("redux:store.missing", setup({}))).toBe("unobservable");
  });

  it("exposes Provider wrapper metadata for replay harnesses", () => {
    expect(providerWrapperMetadata).toEqual({
      component: "Provider",
      storeProp: "store",
    });
    const handles = setup({
      providerStore: { getState: () => ({}) },
      store: { getState: () => ({ counter: { value: 0 } }) },
    });
    expect(handles.providerStore).toBeTruthy();
    expect(
      reduxSource().harness.observe("redux:store.counter.value", handles),
    ).toEqual({ value: 0 });
  });
});
