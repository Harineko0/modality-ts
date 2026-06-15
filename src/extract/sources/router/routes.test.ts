import { describe, expect, it } from "vitest";
import { locationVars } from "./routes.js";

const inventory = {
  routes: [
    { pattern: "/", kind: "index" as const, file: "routes/home.tsx" },
    { pattern: "/links", kind: "page" as const, file: "routes/dashboard.tsx" },
    { pattern: "/signin", kind: "page" as const, file: "routes/signin.tsx" },
    {
      pattern: "/api/links",
      kind: "resource" as const,
      file: "routes/api.links.tsx",
    },
  ],
};

describe("locationVars", () => {
  it("models UI routes in sys:route and excludes resources", () => {
    const vars = locationVars(
      inventory,
      { route: "/", bounds: { maxHistory: 4 } },
      { pushTargets: [], pushOrigins: [], hasUnboundPush: false },
    );
    const routeVar = vars.find((decl) => decl.id === "sys:route");
    expect(routeVar?.domain).toEqual({
      kind: "enum",
      values: ["/", "/links", "/signin"],
    });
  });

  it("reduces sys:history to navigation-relevant routes when pushes are bound", () => {
    const vars = locationVars(
      inventory,
      { route: "/", bounds: { maxHistory: 4 } },
      {
        pushTargets: ["/signin"],
        pushOrigins: ["/links"],
        hasUnboundPush: false,
      },
    );
    const historyVar = vars.find((decl) => decl.id === "sys:history");
    expect(historyVar?.domain).toEqual({
      kind: "boundedList",
      inner: { kind: "enum", values: ["/", "/signin", "/links"] },
      maxLen: 4,
    });
  });

  it("falls back to the full sys:route domain when an unbound push exists", () => {
    const vars = locationVars(
      inventory,
      { route: "/", bounds: { maxHistory: 4 } },
      {
        pushTargets: ["/signin"],
        pushOrigins: ["/links"],
        hasUnboundPush: true,
      },
    );
    const routeVar = vars.find((decl) => decl.id === "sys:route");
    const historyVar = vars.find((decl) => decl.id === "sys:history");
    expect(historyVar?.domain).toEqual({
      kind: "boundedList",
      inner: routeVar?.domain,
      maxLen: 4,
    });
  });

  it("keeps sys:history inner values within sys:route", () => {
    const vars = locationVars(
      inventory,
      { route: "/", bounds: { maxHistory: 3 } },
      {
        pushTargets: ["/signin", "/missing"],
        pushOrigins: ["/links", "/ghost"],
        hasUnboundPush: false,
      },
    );
    const routeValues =
      vars.find((decl) => decl.id === "sys:route")?.domain.kind === "enum"
        ? vars.find((decl) => decl.id === "sys:route")?.domain.values
        : [];
    const historyDomain = vars.find(
      (decl) => decl.id === "sys:history",
    )?.domain;
    const historyValues =
      historyDomain?.kind === "boundedList" &&
      historyDomain.inner.kind === "enum"
        ? historyDomain.inner.values
        : [];
    expect(historyValues.every((route) => routeValues?.includes(route))).toBe(
      true,
    );
    expect(historyValues).toEqual(["/", "/signin", "/missing", "/links"]);
  });
});
