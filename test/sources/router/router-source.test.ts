import { describe, expect, it } from "vitest";
import { reactRouterAdapter } from "modality-ts/extract/sources/router";
import {
  navigate,
  observe,
  setup,
} from "../../../src/extract/sources/router/harness.js";

describe("router source plugin", () => {
  it("exposes a NavigationAdapter-compatible source slice", () => {
    const plugin = reactRouterAdapter({ historyMaxLen: 2 });
    expect(plugin.id).toBe("router");
    expect(plugin.packageNames).toEqual(["react-router", "react-router-dom"]);
    expect(plugin.classifyNavigationCall("router.push", ["/checkout"])).toEqual(
      {
        mode: "push",
        to: "/checkout",
      },
    );
    expect(plugin.harness.observe(plugin.harness.setup({}))).toEqual({
      value: "/",
    });
  });

  it("observes and mutates route state through harness handles", () => {
    const handles = setup({
      initialState: { "sys:route": "/start", "sys:history": [] },
    });
    expect(observe(handles, "sys:route")).toEqual({ value: "/start" });
    navigate(handles, "push", "/checkout");
    expect(observe(handles, "sys:route")).toEqual({ value: "/checkout" });
    expect(observe(handles, "sys:history")).toEqual({ value: ["/start"] });
    navigate(handles, "back");
    expect(observe(handles, "sys:route")).toEqual({ value: "/start" });
  });

  it("owns route and history system vars via locationVars", () => {
    const inventory = {
      routes: [
        { pattern: "/", kind: "index" as const },
        { pattern: "/checkout", kind: "page" as const },
      ],
    };
    expect(
      reactRouterAdapter().locationVars(
        inventory,
        { route: "/", bounds: { maxHistory: 3 } },
        { pushTargets: [], pushOrigins: [], hasUnboundPush: true },
      ),
    ).toEqual([
      {
        id: "sys:route",
        domain: { kind: "enum", values: ["/", "/checkout"] },
        origin: "system",
        scope: { kind: "global" },
        initial: "/",
      },
      {
        id: "sys:history",
        domain: {
          kind: "boundedList",
          inner: { kind: "enum", values: ["/", "/checkout"] },
          maxLen: 3,
        },
        origin: "system",
        scope: { kind: "global" },
        initial: [],
      },
    ]);
  });

  it("classifies supported navigation call shapes", () => {
    const plugin = reactRouterAdapter();
    expect(plugin.classifyNavigationCall("navigate", ["/settings"])).toEqual({
      mode: "push",
      to: "/settings",
    });
    expect(plugin.classifyNavigationCall("router.replace", ["/login"])).toEqual(
      {
        mode: "replace",
        to: "/login",
      },
    );
    expect(plugin.classifyNavigationCall("router.back", [])).toEqual({
      mode: "back",
    });
    expect(plugin.classifyNavigationCall("router.push", [42])).toBe(
      "unsupported",
    );
  });
});
