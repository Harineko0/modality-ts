import { describe, expect, it } from "vitest";
import { navigationCall, routeVars, routerSource } from "modality-ts/source-router";
import { navigate, observe, setup } from "../../../src/sources/router/harness.js";

describe("router source plugin", () => {
  it("exposes a RouterPlugin-compatible source slice", () => {
    const plugin = routerSource({ historyMaxLen: 2 });
    expect(plugin.id).toBe("router");
    expect(plugin.packageNames).toEqual(["react-router", "react-router-dom"]);
    expect(plugin.navigationCall("router.push", ["/checkout"])).toEqual({ mode: "push", to: "/checkout" });
    expect(plugin.harness.observe(plugin.harness.setup({}))).toEqual({ value: "/" });
  });

  it("observes and mutates route state through harness handles", () => {
    const handles = setup({ initialState: { "sys:route": "/start", "sys:history": [] } });
    expect(observe(handles, "sys:route")).toEqual({ value: "/start" });
    navigate(handles, "push", "/checkout");
    expect(observe(handles, "sys:route")).toEqual({ value: "/checkout" });
    expect(observe(handles, "sys:history")).toEqual({ value: ["/start"] });
    navigate(handles, "back");
    expect(observe(handles, "sys:route")).toEqual({ value: "/start" });
  });

  it("owns route and history system vars", () => {
    expect(routeVars(["/checkout", "/"], { route: "/", bounds: { maxHistory: 3 } })).toEqual([
      { id: "sys:route", domain: { kind: "enum", values: ["/", "/checkout"] }, origin: "system", scope: { kind: "global" }, initial: "/" },
      {
        id: "sys:history",
        domain: { kind: "boundedList", inner: { kind: "enum", values: ["/", "/checkout"] }, maxLen: 3 },
        origin: "system",
        scope: { kind: "global" },
        initial: []
      }
    ]);
  });

  it("classifies supported navigation call shapes", () => {
    expect(navigationCall("navigate", ["/settings"])).toEqual({ mode: "push", to: "/settings" });
    expect(navigationCall("router.replace", ["/login"])).toEqual({ mode: "replace", to: "/login" });
    expect(navigationCall("router.back", [])).toEqual({ mode: "back" });
    expect(navigationCall("router.push", [42])).toBe("unsupported");
  });
});
