import { describe, expect, it } from "vitest";
import {
  discoverRoutes,
  parseAppPathSegment,
  parsePagesPathSegment,
  urlSegmentsToPattern,
} from "./discover.js";

function discoveryCtx(
  files: Record<string, string>,
  options: { rootDir?: string } = {},
) {
  return {
    rootDir: options.rootDir,
    files: Object.entries(files).map(([path, text]) => ({ path, text })),
    readFile: async (requested: string) => {
      const normalized = requested.replace(/\\/g, "/");
      const match = Object.entries(files).find(([path]) => {
        const filePath = path.replace(/\\/g, "/");
        return (
          filePath === normalized ||
          normalized.endsWith(`/${filePath}`) ||
          filePath.endsWith(normalized)
        );
      });
      if (!match) throw new Error(`missing file: ${requested}`);
      return match[1];
    },
  };
}

function treeMeta(route: { metadata?: Record<string, unknown> }) {
  const nextRouteTree = route.metadata?.nextRouteTree;
  expect(nextRouteTree).toBeDefined();
  return nextRouteTree as Record<string, unknown>;
}

describe("urlSegmentsToPattern", () => {
  it("normalizes dynamic, catch-all, and optional catch-all segments", () => {
    expect(
      urlSegmentsToPattern([
        { name: "blog", segmentKind: "static" },
        {
          name: "slug",
          segmentKind: "dynamic",
          param: { name: "slug", kind: "dynamic" },
        },
      ]),
    ).toBe("/blog/:slug");
    expect(
      urlSegmentsToPattern([
        { name: "blog", segmentKind: "static" },
        {
          name: "slug",
          segmentKind: "catch-all",
          param: { name: "slug", kind: "catch-all" },
        },
      ]),
    ).toBe("/blog/*");
    expect(
      urlSegmentsToPattern([
        { name: "shop", segmentKind: "static" },
        {
          name: "slug",
          segmentKind: "optional-catch-all",
          param: { name: "slug", kind: "optional-catch-all" },
        },
      ]),
    ).toBe("/shop/*?");
  });
});

describe("discoverRoutes app router", () => {
  it("ignores route groups in URL patterns", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "app/(marketing)/about/page.tsx": "export default function About() {}",
        "app/(marketing)/layout.tsx": "export default function Layout() {}",
      }),
    );

    const about = inventory.routes.find((route) => route.pattern === "/about");
    expect(about?.kind).toBe("page");
    expect(treeMeta(about!).groupNames).toEqual(["marketing"]);
  });

  it("discovers dynamic, catch-all, and optional catch-all patterns", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "app/blog/[slug]/page.tsx": "",
        "app/docs/[...slug]/page.tsx": "",
        "app/shop/[[...slug]]/page.tsx": "",
      }),
    );

    expect(
      inventory.routes.map((route) => [route.pattern, route.kind]),
    ).toEqual(
      expect.arrayContaining([
        ["/blog/:slug", "page"],
        ["/docs/*", "page"],
        ["/shop/*?", "page"],
      ]),
    );
  });

  it("discovers parallel slots", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "app/dashboard/page.tsx": "",
        "app/dashboard/@modal/default.tsx": "",
        "app/dashboard/@modal/(.)photo/[id]/page.tsx": "",
      }),
    );

    const modal = inventory.routes.find(
      (route) =>
        route.pattern === "/photo/:id" && treeMeta(route).slot === "modal",
    );
    expect(modal).toBeDefined();
    expect(modal?.file).toBe("app/dashboard/@modal/(.)photo/[id]/page.tsx");
  });

  it("preserves intercepting-route soft-navigation metadata", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "app/@modal/(.)photo/[id]/page.tsx": "",
      }),
    );

    const route = inventory.routes.find(
      (route) => route.pattern === "/photo/:id",
    );
    const meta = treeMeta(route!);
    expect(meta.softNavigation).toBe(true);
    expect(meta.intercept).toEqual({
      marker: "(.)",
      targetPattern: "/photo/:id",
    });
  });

  it("classifies route handlers as resources", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "app/api/users/route.ts": "export function GET() {}",
      }),
    );

    const route = inventory.routes.find(
      (route) => route.pattern === "/api/users",
    );
    expect(route?.kind).toBe("resource");
    expect(treeMeta(route!).routeFile).toBe("app/api/users/route.ts");
  });

  it("discovers routes under src/app", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "src/app/page.tsx": "",
        "src/app/dashboard/page.tsx": "",
      }),
    );

    expect(inventory.routes.map((route) => route.pattern).sort()).toEqual([
      "/",
      "/dashboard",
    ]);
    expect(inventory.routes.find((route) => route.pattern === "/")?.kind).toBe(
      "index",
    );
  });

  it("emits layout nodes with loading and error metadata", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "app/dashboard/layout.tsx": "",
        "app/dashboard/loading.tsx": "",
        "app/dashboard/error.tsx": "",
      }),
    );

    const layout = inventory.routes.find(
      (route) => route.pattern === "/dashboard" && route.kind === "layout",
    );
    expect(layout).toBeDefined();
    expect(treeMeta(layout!).loadingFile).toBe("app/dashboard/loading.tsx");
    expect(treeMeta(layout!).errorFile).toBe("app/dashboard/error.tsx");
  });

  it("records redirect targets from page files", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "app/legacy/page.tsx": `import { redirect } from 'next/navigation'; redirect('/dashboard');`,
      }),
    );

    expect(
      inventory.routes.find((route) => route.pattern === "/legacy")?.redirectTo,
    ).toBe("/dashboard");
  });

  it("carries root layout metadata on the index page route", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "app/layout.tsx": "export default function Layout() {}",
        "app/page.tsx": "export default function Home() {}",
      }),
    );

    const index = inventory.routes.find((route) => route.pattern === "/");
    expect(index?.kind).toBe("index");
    expect(treeMeta(index!).layoutFile).toBe("app/layout.tsx");
  });

  it("records finite status metadata for notFound literals", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "app/missing/page.tsx": `import { notFound } from 'next/navigation'; notFound();`,
      }),
    );

    expect(treeMeta(inventory.routes[0]!).status).toBe("not-found");
  });
});

describe("discoverRoutes pages router", () => {
  it("maps pages/blog/[slug].tsx to /blog/:slug", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "pages/blog/[slug].tsx": "export default function Post() {}",
      }),
    );

    const route = inventory.routes.find(
      (route) => route.pattern === "/blog/:slug",
    );
    expect(route?.kind).toBe("page");
    expect(treeMeta(route!).pageModuleId).toBe("pages/blog/[slug].tsx");
  });

  it("maps pages/shop/[[...slug]].tsx to /shop/*?", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "pages/shop/[[...slug]].tsx": "export default function Shop() {}",
      }),
    );

    expect(
      inventory.routes.find((route) => route.pattern === "/shop/*?")?.kind,
    ).toBe("page");
  });

  it("classifies pages/api/post/[pid].ts as a resource", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "pages/api/post/[pid].ts": "export default function handler() {}",
      }),
    );

    const route = inventory.routes.find(
      (route) => route.pattern === "/api/post/:pid",
    );
    expect(route?.kind).toBe("resource");
    expect(treeMeta(route!).apiFile).toBe("pages/api/post/[pid].ts");
  });

  it("includes _app.tsx as a shared layout surface", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "pages/_app.tsx": "export default function App() {}",
        "pages/index.tsx": "export default function Home() {}",
      }),
    );

    const appLayout = inventory.routes.find((route) => route.kind === "layout");
    expect(appLayout?.file).toBe("pages/_app.tsx");
    expect(treeMeta(appLayout!).sharedLayout).toBe(true);
    expect(inventory.routes.some((route) => route.pattern === "/")).toBe(true);
  });

  it("excludes _document from route inventory", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "pages/_document.tsx": "export default function Document() {}",
        "pages/about.tsx": "export default function About() {}",
      }),
    );

    expect(
      inventory.routes.some((route) => route.file?.includes("_document")),
    ).toBe(false);
  });

  it("detects pages data exports for later server-effect modeling", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "pages/posts/[id].tsx": `
          export async function getServerSideProps() { return { props: {} }; }
          export async function getStaticPaths() { return { paths: [], fallback: false }; }
        `,
      }),
    );

    const route = inventory.routes.find(
      (route) => route.pattern === "/posts/:id",
    );
    expect(treeMeta(route!).dataExports).toEqual([
      "getServerSideProps",
      "getStaticPaths",
    ]);
  });

  it("discovers routes under src/pages", async () => {
    const inventory = await discoverRoutes(
      discoveryCtx({
        "src/pages/index.tsx": "",
        "src/pages/settings.tsx": "",
      }),
    );

    expect(inventory.routes.map((route) => route.pattern).sort()).toEqual([
      "/",
      "/settings",
    ]);
  });
});

describe("parseAppPathSegment", () => {
  it("classifies groups, slots, and intercept markers", () => {
    expect(parseAppPathSegment("(marketing)").segmentKind).toBe("group");
    expect(parseAppPathSegment("@modal").segmentKind).toBe("parallel-slot");
    expect(parseAppPathSegment("(.)photo").segmentKind).toBe("intercept");
    expect(parseAppPathSegment("(..)photo").intercept?.marker).toBe("(..)");
    expect(parseAppPathSegment("(...)photo").intercept?.marker).toBe("(...)");
  });
});

describe("parsePagesPathSegment", () => {
  it("classifies dynamic and catch-all segments", () => {
    expect(parsePagesPathSegment("[slug]").segmentKind).toBe("dynamic");
    expect(parsePagesPathSegment("[...slug]").segmentKind).toBe("catch-all");
    expect(parsePagesPathSegment("[[...slug]]").segmentKind).toBe(
      "optional-catch-all",
    );
  });
});
