import { describe, expect, it } from "vitest";
import { tanstackRouterAdapter } from "modality-ts/extract/sources/tanstack-router";
import {
  navigate,
  observe,
  setup,
} from "../../../src/extract/sources/tanstack-router/harness.js";

describe("tanstack router source plugin", () => {
  it("exposes a NavigationAdapter-compatible source slice", () => {
    const plugin = tanstackRouterAdapter({ historyMaxLen: 2 });
    expect(plugin.id).toBe("tanstack-router");
    expect(plugin.packageNames).toEqual(["@tanstack/react-router"]);
    expect(
      plugin.classifyNavigationCall("navigate", [
        { to: "/posts/$postId", params: { postId: "1" } },
      ]),
    ).toEqual({
      mode: "push",
      to: "/posts/:postId",
    });
    expect(plugin.harness.observe(plugin.harness.setup({}))).toEqual({
      value: "/",
    });
  });

  it("observes and mutates route state through harness handles", () => {
    const handles = setup({
      initialState: { "sys:route": "/posts", "sys:history": [] },
    });
    expect(observe(handles, "sys:route")).toEqual({ value: "/posts" });
    navigate(handles, "push", "/posts/:postId");
    expect(observe(handles, "sys:route")).toEqual({ value: "/posts/:postId" });
    expect(observe(handles, "sys:history")).toEqual({ value: ["/posts"] });
    navigate(handles, "back");
    expect(observe(handles, "sys:route")).toEqual({ value: "/posts" });
  });

  it("owns route and history system vars via locationVars", () => {
    const inventory = {
      routes: [
        { pattern: "/", kind: "index" as const },
        { pattern: "/posts", kind: "page" as const },
        { pattern: "/posts/:postId", kind: "page" as const },
      ],
    };
    expect(
      tanstackRouterAdapter().locationVars(
        inventory,
        { route: "/", bounds: { maxHistory: 3 } },
        { pushTargets: [], pushOrigins: [], hasUnboundPush: true },
      ),
    ).toEqual([
      {
        id: "sys:route",
        domain: {
          kind: "enum",
          values: ["/", "/posts", "/posts/:postId"],
        },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "location-current", group: "default" },
        initial: "/",
      },
      {
        id: "sys:history",
        domain: {
          kind: "boundedList",
          inner: {
            kind: "enum",
            values: ["/", "/posts", "/posts/:postId"],
          },
          maxLen: 3,
        },
        origin: "system",
        scope: { kind: "global" },
        role: { kind: "location-history", group: "default" },
        initial: [],
      },
    ]);
  });
});
