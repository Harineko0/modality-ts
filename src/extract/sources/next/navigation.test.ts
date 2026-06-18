import { describe, expect, it } from "vitest";
import type { RouteInventory, RouteNode } from "modality-ts/extract/engine/spi";
import { discoverRoutes } from "./discover.js";
import {
  classifyNavigationCall,
  classifyNavigationJsx,
  classifyNextNavigationCall,
  classifyNextNavigationJsx,
} from "./navigation.js";
import {
  encodeNextTreeMetadata,
  lowerNextNavigation,
  mountScopeForComponent,
  nextPhaseVarId,
  nextSlotVarId,
  routeTreeVars,
} from "./routes.js";

function treeRoute(
  node: Parameters<typeof encodeNextTreeMetadata>[0],
  route: Partial<RouteNode> = {},
): RouteNode {
  return {
    pattern: node.pattern,
    kind: node.kind,
    file: node.file,
    metadata: encodeNextTreeMetadata(node),
    ...route,
  };
}

const appInventory: RouteInventory = {
  routes: [
    treeRoute({
      id: "app:root",
      router: "app",
      pattern: "/",
      segment: "",
      segmentKind: "static",
      kind: "index",
      file: "app/page.tsx",
      groupNames: [],
      params: [],
      layoutFile: "app/layout.tsx",
      loadingFile: "app/loading.tsx",
    }),
    treeRoute({
      id: "app:dashboard",
      router: "app",
      pattern: "/dashboard",
      segment: "dashboard",
      segmentKind: "static",
      kind: "page",
      file: "app/dashboard/page.tsx",
      parentId: "app:root",
      groupNames: [],
      params: [],
    }),
    treeRoute({
      id: "app:photo-modal",
      router: "app",
      pattern: "/photo/:id",
      segment: "(.)photo",
      segmentKind: "intercept",
      kind: "page",
      file: "app/@modal/(.)photo/[id]/page.tsx",
      parentId: "app:root",
      slot: "@modal",
      groupNames: [],
      params: [{ name: "id", kind: "dynamic" }],
      intercept: { marker: "(.)", targetPattern: "/photo/:id" },
    }),
  ],
};

const pagesInventory: RouteInventory = {
  routes: [
    treeRoute({
      id: "pages:post",
      router: "pages",
      pattern: "/post/:pid",
      segment: "[pid]",
      segmentKind: "dynamic",
      kind: "page",
      file: "pages/post/[pid].tsx",
      groupNames: [],
      params: [{ name: "pid", kind: "dynamic" }],
    }),
  ],
};

describe("classifyNavigationCall", () => {
  it("classifies App Router push, replace, back, and refresh", () => {
    expect(classifyNavigationCall("router.push", ["/dashboard"])).toEqual({
      mode: "push",
      to: "/dashboard",
    });
    expect(classifyNavigationCall("router.replace", ["/dashboard"])).toEqual({
      mode: "replace",
      to: "/dashboard",
    });
    expect(classifyNavigationCall("router.back", [])).toEqual({ mode: "back" });
    expect(classifyNextNavigationCall("router.refresh", [])).toEqual({
      classification: { kind: "refresh" },
      warnings: [],
    });
  });

  it("classifies Pages Router push with pathname/query object", () => {
    expect(
      classifyNavigationCall("router.push", [
        { pathname: "/post/[pid]", query: { pid: "abc" } },
      ]),
    ).toEqual({
      mode: "push",
      to: "/post/abc",
    });
  });

  it("rejects external URLs and unsupported forward/go", () => {
    expect(classifyNavigationCall("router.push", ["https://example.com"])).toBe(
      "unsupported",
    );
    expect(classifyNavigationCall("router.forward", [])).toBe("unsupported");
    expect(classifyNavigationCall("go", [1])).toBe("unsupported");
  });
});

describe("classifyNavigationJsx", () => {
  it("classifies Next Link href", () => {
    expect(
      classifyNavigationJsx("Link", new Map([["href", "/dashboard"]])),
    ).toEqual({
      mode: "push",
      to: "/dashboard",
    });
  });

  it("over-approximates dynamic href and records a warning", () => {
    const result = classifyNextNavigationJsx(
      "Link",
      new Map([["href", { expr: "dynamic" }]]),
      ["/", "/dashboard"],
    );
    expect(result.classification).toEqual({ mode: "push", to: "/" });
    expect(result.warnings).toEqual([
      {
        kind: "model-slack",
        message:
          "Dynamic Link href over-approximates to known route patterns for navigation",
      },
    ]);
  });
});

describe("routeTreeVars", () => {
  it("emits slot and phase system vars from route-tree metadata", () => {
    const vars = routeTreeVars(appInventory, { route: "/" });
    expect(vars.find((decl) => decl.id === nextSlotVarId("children"))).toEqual({
      id: "sys:next:slot:children",
      domain: {
        kind: "enum",
        values: ["__none", "app:root", "app:dashboard"],
      },
      origin: "system",
      scope: { kind: "global" },
      initial: "app:root",
      role: { kind: "tree-slot" },
    });
    expect(vars.find((decl) => decl.id === nextSlotVarId("@modal"))).toEqual({
      id: "sys:next:slot:@modal",
      domain: {
        kind: "enum",
        values: ["__none", "app:photo-modal"],
      },
      origin: "system",
      scope: { kind: "global" },
      initial: "__none",
      role: { kind: "tree-slot" },
    });
    expect(vars.find((decl) => decl.id === nextPhaseVarId("app:root"))).toEqual(
      {
        id: "sys:next:phase:app:root",
        domain: {
          kind: "enum",
          values: [
            "ready",
            "loading",
            "error",
            "not-found",
            "forbidden",
            "unauthorized",
          ],
        },
        origin: "system",
        scope: { kind: "global" },
        initial: "ready",
        role: { kind: "boundary-phase" },
      },
    );
  });

  it("initializes slot vars from the configured initial route", () => {
    const vars = routeTreeVars(appInventory, { route: "/dashboard" });
    expect(
      vars.find((decl) => decl.id === nextSlotVarId("children"))?.initial,
    ).toBe("app:dashboard");
  });

  it("keeps unknown initial routes at __none", () => {
    const vars = routeTreeVars(appInventory, { route: "/unknown" });
    expect(
      vars.find((decl) => decl.id === nextSlotVarId("children"))?.initial,
    ).toBe("__none");
  });
});

describe("lowerNextNavigation", () => {
  const routePatterns = ["/", "/dashboard", "/photo/:id"];

  it("lowers push navigation into route, slot, and phase assignments", () => {
    const lowered = lowerNextNavigation(
      { mode: "push", to: "/dashboard" },
      { inventory: appInventory, routePatterns },
    );
    expect(lowered.confidence).toBe("exact");
    expect(lowered.effect).toMatchObject({
      kind: "seq",
      effects: expect.arrayContaining([
        expect.objectContaining({ kind: "if" }),
        {
          kind: "assign",
          var: "sys:next:slot:children",
          expr: { kind: "lit", value: "app:dashboard" },
        },
        {
          kind: "assign",
          var: "sys:next:phase:app:root",
          expr: { kind: "lit", value: "loading" },
        },
      ]),
    });
    expect(lowered.writes).toEqual(
      expect.arrayContaining([
        "sys:route",
        "sys:history",
        "sys:next:slot:children",
        "sys:next:phase:app:root",
      ]),
    );
  });

  it("over-approximates unknown dynamic targets", () => {
    const lowered = lowerNextNavigation(
      { mode: "push", to: "/unknown/:id" },
      { inventory: appInventory, routePatterns },
    );
    expect(lowered.confidence).toBe("over-approx");
    expect(lowered.warnings?.[0]).toContain("over-approximates");
    const effects =
      lowered.effect.kind === "seq" ? lowered.effect.effects : [lowered.effect];
    expect(effects.some((effect) => effect.kind === "choose")).toBe(true);
    expect(
      effects.some(
        (effect) =>
          effect.kind === "choose" && effect.var === "sys:next:slot:children",
      ),
    ).toBe(true);
    expect(
      effects.some(
        (effect) =>
          effect.kind === "choose" && effect.var === "sys:next:slot:@modal",
      ),
    ).toBe(true);
  });
});

describe("mountScopeForComponent", () => {
  it("scopes page components to active route and slot", () => {
    expect(mountScopeForComponent("DashboardPage", appInventory)).toEqual({
      kind: "mount-local",
      id: "next:page:app:dashboard",
      when: {
        kind: "and",
        args: [
          {
            kind: "eq",
            args: [
              { kind: "read", var: "sys:route" },
              { kind: "lit", value: "/dashboard" },
            ],
          },
          {
            kind: "eq",
            args: [
              { kind: "read", var: "sys:next:slot:children" },
              { kind: "lit", value: "app:dashboard" },
            ],
          },
        ],
      },
    });
  });

  it("scopes Pages Router components by file basename", () => {
    expect(mountScopeForComponent("Post", pagesInventory)).toEqual({
      kind: "mount-local",
      id: "next:page:pages:post",
      when: {
        kind: "and",
        args: [
          {
            kind: "eq",
            args: [
              { kind: "read", var: "sys:route" },
              { kind: "lit", value: "/post/:pid" },
            ],
          },
          {
            kind: "eq",
            args: [
              { kind: "read", var: "sys:next:slot:children" },
              { kind: "lit", value: "pages:post" },
            ],
          },
        ],
      },
    });
  });

  it("scopes layout and template components from discovered app files", async () => {
    const inventory = await discoverRoutes({
      files: [
        { path: "app/layout.tsx", text: "export default function Layout() {}" },
        {
          path: "app/template.tsx",
          text: "export default function Template() {}",
        },
        { path: "app/page.tsx", text: "export default function Home() {}" },
      ],
      readFile: async () => "",
    });
    expect(mountScopeForComponent("Layout", inventory)).toMatchObject({
      kind: "mount-local",
      id: expect.stringMatching(/^next:layout:/),
    });
    expect(mountScopeForComponent("Template", inventory)).toMatchObject({
      kind: "mount-local",
      id: expect.stringMatching(/^next:template:/),
    });
  });
});

describe("var-id helpers", () => {
  it("formats Next route-tree var ids", () => {
    expect(nextSlotVarId("children")).toBe("sys:next:slot:children");
    expect(nextPhaseVarId("app:root")).toBe("sys:next:phase:app:root");
  });
});
