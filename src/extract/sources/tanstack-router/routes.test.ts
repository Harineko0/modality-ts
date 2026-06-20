import { describe, expect, it } from "vitest";
import type {
  LocationLowering,
  RouteInventory,
} from "modality-ts/extract/engine/spi";
import {
  locationVars,
  lowerNavigation,
  mountScopeForComponent,
  routeTreeVars,
  tanstackBranchVarId,
  TANSTACK_BRANCH_NONE,
} from "./routes.js";
import {
  tanstackRouteTreeToMetadata,
  type TanstackRouteTreeNode,
} from "./types.js";

function treeRoute(
  node: TanstackRouteTreeNode,
): RouteInventory["routes"][number] {
  return {
    pattern: node.fullPath,
    kind: node.routeKind,
    file: node.filePath,
    metadata: { tanstackRouteTree: tanstackRouteTreeToMetadata(node) },
  };
}

const pathlessInventory: RouteInventory = {
  routes: [
    treeRoute({
      routeId: "/_pathlessLayout",
      fullPath: "/",
      segmentKind: "pathless",
      routeKind: "layout",
      discoveryMode: "file",
      filePath: "src/routes/_pathlessLayout.tsx",
      pathless: true,
      component: "PathlessLayout",
    }),
    treeRoute({
      routeId: "/route-a",
      fullPath: "/route-a",
      segmentKind: "static",
      routeKind: "page",
      discoveryMode: "file",
      filePath: "src/routes/_pathlessLayout.route-a.tsx",
      pathless: true,
      parentId: "/_pathlessLayout",
      component: "RouteAPage",
    }),
  ],
};

describe("locationVars", () => {
  it("includes file-discovered UI routes in the location-current domain", () => {
    const inventory: RouteInventory = {
      routes: [
        { pattern: "/", kind: "index" },
        { pattern: "/about", kind: "page" },
      ],
    };
    const lowering: LocationLowering = {
      pushTargets: ["/about"],
      pushOrigins: ["/"],
      hasUnboundPush: false,
    };
    const vars = locationVars(inventory, { route: "/" }, lowering);
    expect(vars.find((decl) => decl.id === "sys:route")).toMatchObject({
      domain: { kind: "enum", values: expect.arrayContaining(["/", "/about"]) },
      role: { kind: "location-current", group: "default" },
    });
  });

  it("reduces history inner domain to push origins and targets", () => {
    const inventory: RouteInventory = {
      routes: [
        { pattern: "/", kind: "index" },
        { pattern: "/about", kind: "page" },
        { pattern: "/settings", kind: "page" },
      ],
    };
    const lowering: LocationLowering = {
      pushTargets: ["/about"],
      pushOrigins: ["/"],
      hasUnboundPush: false,
    };
    const vars = locationVars(inventory, { route: "/" }, lowering);
    const history = vars.find((decl) => decl.id === "sys:history");
    expect(history?.domain).toMatchObject({
      kind: "boundedList",
      inner: { kind: "enum", values: ["/", "/about"] },
    });
  });
});

describe("routeTreeVars", () => {
  it("emits a compact branch enum for discovered route ids", () => {
    const vars = routeTreeVars(pathlessInventory, { route: "/route-a" });
    expect(vars.find((decl) => decl.id === tanstackBranchVarId())).toEqual({
      id: "sys:tanstack:branch",
      domain: {
        kind: "enum",
        values: [TANSTACK_BRANCH_NONE, "/_pathlessLayout", "/route-a"],
      },
      origin: "system",
      scope: { kind: "global" },
      role: { kind: "tree-slot" },
      initial: "/route-a",
    });
  });
});

describe("lowerNavigation", () => {
  const routePatterns = ["/", "/route-a"];

  it("lowers known targets exactly and updates branch state", () => {
    const lowered = lowerNavigation(
      { mode: "push", to: "/route-a" },
      { inventory: pathlessInventory, routePatterns },
    );
    expect(lowered.confidence).toBe("exact");
    expect(lowered.effect).toMatchObject({
      kind: "seq",
      effects: expect.arrayContaining([
        expect.objectContaining({ kind: "if" }),
        {
          kind: "assign",
          var: tanstackBranchVarId(),
          expr: { kind: "lit", value: "/route-a" },
        },
      ]),
    });
    expect(lowered.writes).toEqual(
      expect.arrayContaining([
        "sys:route",
        "sys:history",
        tanstackBranchVarId(),
      ]),
    );
  });

  it("over-approximates dynamic unknown targets", () => {
    const lowered = lowerNavigation(
      { mode: "push", to: "/unknown/:id" },
      { inventory: pathlessInventory, routePatterns },
    );
    expect(lowered.confidence).toBe("over-approx");
    expect(lowered.warnings?.[0]).toContain("over-approximates");
    const effects =
      lowered.effect.kind === "seq" ? lowered.effect.effects : [lowered.effect];
    expect(
      effects.some(
        (effect) =>
          effect.kind === "choose" && effect.var === tanstackBranchVarId(),
      ),
    ).toBe(true);
  });
});

describe("mountScopeForComponent", () => {
  it("scopes pathless layout state across descendant pages", () => {
    const scope = mountScopeForComponent("PathlessLayout", pathlessInventory);
    expect(scope).toMatchObject({
      kind: "mount-local",
      id: "tanstack:layout:/_pathlessLayout",
      when: expect.objectContaining({ kind: "or" }),
    });
  });

  it("scopes page components to the active route pattern", () => {
    expect(mountScopeForComponent("RouteAPage", pathlessInventory)).toEqual({
      kind: "mount-local",
      id: "tanstack:page:/route-a",
      when: {
        kind: "eq",
        args: [
          { kind: "read", var: "sys:route" },
          { kind: "lit", value: "/route-a" },
        ],
      },
    });
  });
});
