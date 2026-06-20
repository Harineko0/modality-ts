import { describe, expect, it } from "vitest";
import {
  discoverRoutes,
  parseTanstackCodeRoutes,
  parseTanstackCreateFileRoute,
  routeForComponent,
  tanstackFilePathToPattern,
  tanstackPathToPattern,
} from "./discover.js";
import { tanstackRouterAdapter } from "./index.js";

const CREATE_FILE_ROUTE_IMPORT = `import { createFileRoute } from '@tanstack/react-router'`;

function routeFile(path: string, body = ""): { path: string; text: string } {
  return {
    path: `src/routes/${path}`,
    text: `${CREATE_FILE_ROUTE_IMPORT}\n${body}`,
  };
}

describe("tanstackPathToPattern", () => {
  it("normalizes dynamic and splat segments", () => {
    expect(tanstackPathToPattern("/posts/$postId")).toBe("/posts/:postId");
    expect(tanstackPathToPattern("/files/$")).toBe("/files/*");
  });
});

describe("tanstackFilePathToPattern", () => {
  it("maps common file-based route shapes", () => {
    expect(tanstackFilePathToPattern("__root.tsx")).toEqual({
      pattern: "/",
      kind: "layout",
      pathless: false,
      routeId: "__root",
      segmentKind: "static",
    });
    expect(tanstackFilePathToPattern("index.tsx")).toEqual({
      pattern: "/",
      kind: "index",
      pathless: false,
      routeId: "/",
      segmentKind: "index",
    });
    expect(tanstackFilePathToPattern("about.tsx")?.pattern).toBe("/about");
    expect(tanstackFilePathToPattern("posts/$postId.tsx")?.pattern).toBe(
      "/posts/:postId",
    );
    expect(tanstackFilePathToPattern("posts.$postId.edit.tsx")?.pattern).toBe(
      "/posts/:postId/edit",
    );
    expect(tanstackFilePathToPattern("_pathlessLayout.route-a.tsx")).toEqual(
      expect.objectContaining({
        pattern: "/route-a",
        kind: "page",
        pathless: true,
      }),
    );
    expect(tanstackFilePathToPattern("files.$.tsx")?.pattern).toBe("/files/*");
  });

  it("supports mixed flat and directory fixtures", () => {
    expect(tanstackFilePathToPattern("posts/index.tsx")?.pattern).toBe(
      "/posts",
    );
    expect(tanstackFilePathToPattern("settings.profile.tsx")?.pattern).toBe(
      "/settings/profile",
    );
  });
});

describe("parseTanstackCreateFileRoute", () => {
  it("reads literal createFileRoute paths and components", () => {
    expect(
      parseTanstackCreateFileRoute(`
        import { createFileRoute } from '@tanstack/react-router'
        export const Route = createFileRoute('/custom/$id')({
          component: CustomPage,
        })
      `),
    ).toEqual({ routePath: "/custom/$id", component: "CustomPage" });
  });
});

describe("discoverRoutes", () => {
  it("discovers file-based TanStack routes with expected kinds", async () => {
    const inventory = await discoverRoutes({
      rootDir: "/project",
      files: [
        routeFile("__root.tsx"),
        routeFile("index.tsx"),
        routeFile("about.tsx"),
        routeFile("posts/$postId.tsx"),
        routeFile("posts.$postId.edit.tsx"),
        routeFile("_pathlessLayout.route-a.tsx"),
        routeFile("files.$.tsx"),
      ],
      readFile: async () => "",
    });

    expect(
      inventory.routes.map((node) => [node.pattern, node.kind]).sort(),
    ).toEqual(
      [
        ["/", "index"],
        ["/", "layout"],
        ["/about", "page"],
        ["/files/*", "page"],
        ["/posts/:postId", "page"],
        ["/posts/:postId/edit", "page"],
        ["/route-a", "page"],
      ].sort((left, right) => left[0]!.localeCompare(right[0]!)),
    );
  });

  it("prefers createFileRoute literal paths over file conventions", async () => {
    const inventory = await discoverRoutes({
      files: [
        routeFile(
          "about.tsx",
          `export const Route = createFileRoute('/company')({ component: About })`,
        ),
      ],
      readFile: async () => "",
    });
    expect(inventory.routes).toEqual([
      expect.objectContaining({ pattern: "/company", kind: "page" }),
    ]);
  });

  it("discovers static code-based route trees", async () => {
    const inventory = await discoverRoutes({
      files: [
        {
          path: "src/router.tsx",
          text: `
            import {
              createRootRoute,
              createRoute,
              createRouter,
            } from '@tanstack/react-router'

            const rootRoute = createRootRoute({ component: Root })
            const indexRoute = createRoute({
              getParentRoute: () => rootRoute,
              path: '/',
              component: Home,
            })
            const aboutRoute = createRoute({
              getParentRoute: () => rootRoute,
              path: 'about',
              component: About,
            })
            export const routeTree = rootRoute.addChildren([indexRoute, aboutRoute])
            export const router = createRouter({ routeTree })
          `,
        },
      ],
      readFile: async () => "",
    });

    expect(
      inventory.routes.map((node) => [node.pattern, node.kind]).sort(),
    ).toEqual(
      [
        ["/", "index"],
        ["/", "layout"],
        ["/about", "page"],
      ].sort((left, right) => left[0]!.localeCompare(right[0]!)),
    );
  });

  it("classifies pathless code routes as layout", async () => {
    const inventory = await discoverRoutes({
      files: [
        {
          path: "src/router.tsx",
          text: `
            import { createRootRoute, createRoute } from '@tanstack/react-router'
            const rootRoute = createRootRoute({ component: Root })
            const pathlessRoute = createRoute({
              getParentRoute: () => rootRoute,
              id: '_pathless',
              component: PathlessLayout,
            })
            export const routeTree = rootRoute.addChildren([pathlessRoute])
          `,
        },
      ],
      readFile: async () => "",
    });
    expect(inventory.routes.some((node) => node.kind === "layout")).toBe(true);
    expect(
      inventory.routes.filter(
        (node) => node.kind === "page" || node.kind === "index",
      ),
    ).toHaveLength(0);
  });
});

describe("parseTanstackCodeRoutes", () => {
  it("extracts parent, path, id, and component fields", () => {
    expect(
      parseTanstackCodeRoutes(`
        import { createRootRoute, createRoute } from '@tanstack/react-router'
        const rootRoute = createRootRoute({ component: Root })
        const aboutRoute = createRoute({
          getParentRoute: () => rootRoute,
          path: 'about',
          component: AboutPage,
        })
      `),
    ).toEqual([
      expect.objectContaining({
        varName: "rootRoute",
        isRoot: true,
        component: "Root",
      }),
      expect.objectContaining({
        varName: "aboutRoute",
        parentVar: "rootRoute",
        path: "about",
        component: "AboutPage",
      }),
    ]);
  });
});

describe("routeForComponent", () => {
  it("returns undefined for ambiguous basename matches", async () => {
    const inventory = await discoverRoutes({
      files: [routeFile("posts/index.tsx"), routeFile("tags/index.tsx")],
      readFile: async () => "",
    });
    expect(routeForComponent("Index", inventory)).toBeUndefined();
  });

  it("matches statically visible component options", async () => {
    const inventory = await discoverRoutes({
      files: [
        routeFile(
          "dashboard.tsx",
          `export const Route = createFileRoute('/dashboard')({ component: DashboardHome })`,
        ),
      ],
      readFile: async () => "",
    });
    expect(routeForComponent("DashboardHome", inventory)).toBe("/dashboard");
  });
});

describe("tanstackRouterAdapter", () => {
  it("exposes the planned adapter identity", () => {
    const adapter = tanstackRouterAdapter();
    expect(adapter.id).toBe("tanstack-router");
    expect(adapter.version).toBe("0.1.0");
    expect(adapter.packageNames).toEqual(["@tanstack/react-router"]);
  });
});
