import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverRoutes,
  parseReactRouterRoutes,
  reactRouterPathPattern,
  routeForComponent,
} from "./discover.js";
import { reactRouterAdapter } from "./index.js";
import { classifyNavigationCall, classifyNavigationJsx } from "./navigation.js";

const TINYURL_MANIFEST = `import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("links", "routes/dashboard.tsx"),
  route("api/links", "routes/api.links.tsx"),
  route("links/:id", "routes/links.$id.tsx"),
  route("analytics", "routes/analytics.tsx"),
  route("tags", "routes/tags.tsx"),
  route("signin", "routes/signin.tsx"),
  route("no-chapter", "routes/no-chapter.tsx"),
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("auth/signout", "routes/auth.signout.ts"),
  route("auth/signout-iframe", "routes/auth.signout-iframe.ts"),
  route("notfound", "routes/notfound.tsx"),
  route(":slug", "routes/$slug.tsx"),
] satisfies RouteConfig;
`;

describe("parseReactRouterRoutes", () => {
  it("parses index and route entries with normalized patterns", () => {
    expect(
      parseReactRouterRoutes(`
        import { index, route } from "@react-router/dev/routes";
        export default [
          index("routes/home.tsx"),
          route("links/:id", "routes/links.$id.tsx"),
          route("api/auth/*", "routes/api.auth.$.ts"),
        ];
      `),
    ).toEqual([
      { pattern: "/", file: "routes/home.tsx" },
      { pattern: "/links/:id", file: "routes/links.$id.tsx" },
      { pattern: "/api/auth/*", file: "routes/api.auth.$.ts" },
    ]);
  });
});

describe("reactRouterPathPattern", () => {
  it("normalizes params and splats", () => {
    expect(reactRouterPathPattern("links/$id")).toBe("/links/:id");
    expect(reactRouterPathPattern("/api/auth/*")).toBe("/api/auth/*");
  });
});

describe("discoverRoutes", () => {
  it("classifies the TinyURL manifest into 13 nodes with expected kinds", async () => {
    const inventory = await discoverRoutes({
      files: [{ path: "app/routes.ts", text: TINYURL_MANIFEST }],
      readFile: async () => "",
    });

    expect(inventory.routes).toHaveLength(13);
    expect(inventory.routes.map((node) => [node.pattern, node.kind])).toEqual([
      ["/", "index"],
      ["/:slug", "page"],
      ["/analytics", "page"],
      ["/api/auth/*", "resource"],
      ["/api/links", "resource"],
      ["/auth/signout", "resource"],
      ["/auth/signout-iframe", "resource"],
      ["/links", "page"],
      ["/links/:id", "page"],
      ["/no-chapter", "page"],
      ["/notfound", "page"],
      ["/signin", "page"],
      ["/tags", "page"],
    ]);
  });

  it("extracts string-literal redirect targets and skips non-literals", async () => {
    const inventory = await discoverRoutes({
      files: [
        {
          path: "app/routes.ts",
          text: `
            import { index, route } from "@react-router/dev/routes";
            export default [
              index("routes/home.tsx"),
              route("dashboard", "routes/dashboard.tsx"),
              route("legacy", "routes/legacy.tsx"),
            ];
          `,
        },
      ],
      readFile: async (path) => {
        if (path.endsWith("routes/dashboard.tsx")) {
          return `export function loader() { return redirect("/links"); }`;
        }
        if (path.endsWith("routes/legacy.tsx")) {
          return `export function loader() { return redirect(target); }`;
        }
        return "";
      },
    });

    const dashboard = inventory.routes.find(
      (node) => node.pattern === "/dashboard",
    );
    const legacy = inventory.routes.find((node) => node.pattern === "/legacy");
    expect(dashboard?.redirectTo).toBe("/links");
    expect(legacy?.redirectTo).toBeUndefined();
  });

  it("reads redirect targets from real filesystem paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-discover-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    await writeFile(
      join(dir, "app", "routes.ts"),
      `import { route } from "@react-router/dev/routes"; export default [route("legacy", "routes/legacy.tsx")];`,
      "utf8",
    );
    await writeFile(
      join(dir, "app", "routes", "legacy.tsx"),
      `export function loader() { return redirect("/links"); }`,
      "utf8",
    );
    const inventory = await discoverRoutes({
      rootDir: dir,
      files: [
        {
          path: join(dir, "app", "routes.ts"),
          text: await readFile(join(dir, "app", "routes.ts"), "utf8"),
        },
      ],
      readFile: (path) => readFile(path, "utf8"),
    });
    expect(inventory.routes[0]?.redirectTo).toBe("/links");
  });

  it("reads route files relative to the manifest directory", async () => {
    const inventory = await discoverRoutes({
      rootDir: "/project",
      files: [
        {
          path: "app/routes.ts",
          text: `import { route } from "@react-router/dev/routes"; export default [route("go", "routes/go.tsx")];`,
        },
      ],
      readFile: async (path) => {
        expect(path).toBe("/project/app/routes/go.tsx");
        return `export const loader = () => permanentRedirect("/done");`;
      },
    });

    expect(inventory.routes[0]?.redirectTo).toBe("/done");
  });

  it("matches the live TinyURL manifest when the sibling repo is present", async () => {
    const tinyUrlRoot = "/Users/hari/proj/gdgjp/tinyurl";
    let manifest: string;
    try {
      manifest = await readFile(join(tinyUrlRoot, "app/routes.ts"), "utf8");
    } catch {
      return;
    }

    const inventory = await discoverRoutes({
      rootDir: tinyUrlRoot,
      files: [{ path: "app/routes.ts", text: manifest }],
      readFile: async (path) => readFile(path, "utf8"),
    });

    expect(inventory.routes).toHaveLength(13);
    expect(
      inventory.routes
        .filter((node) => node.kind === "resource")
        .map((n) => n.pattern),
    ).toEqual([
      "/api/auth/*",
      "/api/links",
      "/auth/signout",
      "/auth/signout-iframe",
    ]);
  });
});

describe("routeForComponent", () => {
  const inventory = {
    routes: [
      { pattern: "/signin", kind: "page" as const, file: "routes/signin.tsx" },
      {
        pattern: "/links",
        kind: "page" as const,
        file: "routes/dashboard.tsx",
      },
      {
        pattern: "/links/:id",
        kind: "page" as const,
        file: "routes/links.$id.tsx",
      },
    ],
  };

  it("binds components by normalized file basename", () => {
    expect(routeForComponent("Signin", inventory)).toBe("/signin");
    expect(routeForComponent("Dashboard", inventory)).toBe("/links");
  });

  it("returns undefined when basename matching is ambiguous", () => {
    const ambiguous = {
      routes: [
        { pattern: "/a", kind: "page" as const, file: "routes/signin.tsx" },
        { pattern: "/b", kind: "page" as const, file: "pages/signin.tsx" },
      ],
    };
    expect(routeForComponent("Signin", ambiguous)).toBeUndefined();
  });
});

describe("classifyNavigationCall", () => {
  it("classifies navigate replace options and unsupported forward/go", () => {
    expect(
      classifyNavigationCall("navigate", ["/settings", { replace: true }]),
    ).toEqual({ mode: "replace", to: "/settings" });
    expect(classifyNavigationCall("router.forward", [])).toBe("unsupported");
    expect(classifyNavigationCall("go", [1])).toBe("unsupported");
  });
});

describe("classifyNavigationJsx", () => {
  it("classifies Link and Navigate tags", () => {
    expect(classifyNavigationJsx("Link", new Map([["to", "/links"]]))).toEqual({
      mode: "push",
      to: "/links",
    });
    expect(
      classifyNavigationJsx(
        "Navigate",
        new Map([
          ["to", "/signin"],
          ["replace", true],
        ]),
      ),
    ).toEqual({ mode: "replace", to: "/signin" });
    expect(classifyNavigationJsx("Navigate", new Map([["to", "/"]]))).toEqual({
      mode: "push",
      to: "/",
    });
  });
});

describe("reactRouterAdapter", () => {
  it("satisfies RoutePlugin with the required methods", () => {
    const adapter = reactRouterAdapter();
    expect(adapter.id).toBe("router");
    expect(typeof adapter.discoverRoutes).toBe("function");
    expect(typeof adapter.classifyNavigationCall).toBe("function");
    expect(typeof adapter.classifyNavigationJsx).toBe("function");
    expect(typeof adapter.routeForComponent).toBe("function");
    expect(typeof adapter.locationVars).toBe("function");
    expect(typeof adapter.harness.navigate).toBe("function");
  });
});
