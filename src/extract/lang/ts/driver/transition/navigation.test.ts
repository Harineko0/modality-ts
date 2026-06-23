import { describe, expect, it } from "vitest";
import { locationEffect } from "./navigation.js";

describe("locationEffect", () => {
  const routes = ["/a", "/b"] as const;

  it("lowers replace to a route assignment", () => {
    const lowered = locationEffect({
      currentVar: "sys:route",
      historyVar: "sys:history",
      mode: "replace",
      to: { kind: "lit", value: "/b" },
      routeValues: routes,
      historyCap: 2,
    });
    expect(lowered.effect).toEqual({
      kind: "assign",
      var: "sys:route",
      expr: { kind: "lit", value: "/b" },
    });
    expect(lowered.reads).toEqual(["sys:history"]);
    expect(lowered.writes).toEqual(["sys:route"]);
  });

  it("lowers push to seq/assign effects over route and history", () => {
    const lowered = locationEffect({
      currentVar: "sys:route",
      historyVar: "sys:history",
      mode: "push",
      to: { kind: "lit", value: "/b" },
      routeValues: routes,
      historyCap: 2,
    });
    expect(lowered.effect.kind).toBe("if");
    expect(lowered.reads).toEqual(
      expect.arrayContaining(["sys:route", "sys:history"]),
    );
    expect(lowered.writes).toEqual(
      expect.arrayContaining(["sys:route", "sys:history"]),
    );
  });

  it("keeps push compact when history is too large to unroll", () => {
    const lowered = locationEffect({
      currentVar: "sys:route",
      historyVar: "sys:history",
      mode: "push",
      to: { kind: "lit", value: "/b" },
      routeValues: Array.from({ length: 18 }, (_, index) => `/r${index}`),
      historyCap: 4,
    });
    expect(JSON.stringify(lowered.effect).length).toBeLessThan(1500);
    expect(lowered.effect).toMatchObject({
      kind: "seq",
      effects: [
        { kind: "choose", var: "sys:history" },
        { kind: "assign", var: "sys:route" },
      ],
    });
  });

  it("lowers back to conditional assignments over history", () => {
    const lowered = locationEffect({
      currentVar: "sys:route",
      historyVar: "sys:history",
      mode: "back",
      routeValues: routes,
      historyCap: 2,
    });
    expect(lowered.effect.kind).toBe("if");
    expect(lowered.reads).toEqual(["sys:route", "sys:history"]);
    expect(lowered.writes).toEqual(
      expect.arrayContaining(["sys:route", "sys:history"]),
    );
  });
});
