import { describe, expect, it } from "vitest";
import {
  createTanstackLoaderCacheFragment,
  discoverTanstackLoaderCache,
  discoverTanstackLoaderRoutes,
  MAX_TANSTACK_LOADER_CACHE_ROUTES,
  selectTanstackLoaderCacheRoutes,
  tanstackLoaderCacheVarId,
} from "./cache.js";
import { tanstackRouterCacheStorageProvider } from "./cache-provider.js";

describe("tanstack loader cache", () => {
  it("emits bounded cache var for loader routes", () => {
    const discovery = discoverTanstackLoaderRoutes([
      {
        fileName: "/proj/src/routes/posts.tsx",
        sourceText: `
          import { createFileRoute } from '@tanstack/react-router'
          export const Route = createFileRoute('/posts')({
            loader: () => fetchPosts(),
            component: PostsPage,
          })
          function PostsPage() { return null }
        `,
      },
    ]);
    const fragment = createTanstackLoaderCacheFragment(discovery.loaderRoutes);
    expect(fragment.vars.map((decl) => decl.id)).toContain(
      tanstackLoaderCacheVarId("/posts"),
    );
    expect(fragment.vars[0]?.domain).toEqual({
      kind: "enum",
      values: ["empty", "fresh", "stale", "refreshing", "error"],
    });
  });

  it("uses deterministic cache ids", () => {
    expect(tanstackLoaderCacheVarId("/posts")).toBe(
      "sys:tanstack:loader-cache:posts",
    );
    expect(tanstackLoaderCacheVarId("/user/:id")).toBe(
      "sys:tanstack:loader-cache:user_id",
    );
  });

  it("reduces cache vars when loader route count is high", () => {
    const loaderRoutes = Array.from(
      { length: MAX_TANSTACK_LOADER_CACHE_ROUTES + 5 },
      (_, index) => ({
        pattern: `/route-${index}`,
        routeId: `route_${index}`,
        fileName: `/proj/src/routes/route-${index}.tsx`,
      }),
    );
    const selected = selectTanstackLoaderCacheRoutes(
      { loaderRoutes, caveats: [], warnings: [] },
      "/route-0",
    );
    expect(selected.routes.length).toBe(MAX_TANSTACK_LOADER_CACHE_ROUTES);
    expect(selected.routes.some((route) => route.pattern === "/route-0")).toBe(
      true,
    );
    expect(
      selected.caveats.some((caveat) => caveat.kind === "model-slack"),
    ).toBe(true);
  });
});

describe("tanstackRouterCacheStorageProvider", () => {
  it("returns vars and transitions from discovery", () => {
    const provider = tanstackRouterCacheStorageProvider();
    const fragment = provider.discoverCacheStorage({
      files: [
        {
          path: "/proj/src/routes/posts.tsx",
          text: `
            import { createFileRoute } from '@tanstack/react-router'
            export const Route = createFileRoute('/posts')({
              loader: () => fetchPosts(),
              component: PostsPage,
            })
            function PostsPage() { return null }
          `,
        },
      ],
      options: { route: "/posts" },
    });
    expect(fragment.vars.map((decl) => decl.id)).toContain(
      tanstackLoaderCacheVarId("/posts"),
    );
    expect(fragment.transitions.length).toBeGreaterThan(0);
    expect(fragment.caveats.length).toBeGreaterThan(0);
  });

  it("matches low-level discovery output", () => {
    const files = [
      {
        path: "/proj/src/routes/posts.tsx",
        text: `
          import { createFileRoute } from '@tanstack/react-router'
          export const Route = createFileRoute('/posts')({
            loader: () => fetchPosts(),
            component: PostsPage,
          })
          function PostsPage() { return null }
        `,
      },
    ];
    const lowLevel = discoverTanstackLoaderCache({
      files,
      options: { route: "/posts" },
    });
    const provider = tanstackRouterCacheStorageProvider();
    const fragment = provider.discoverCacheStorage({
      files,
      options: { route: "/posts" },
    });
    expect(fragment.vars).toEqual(lowLevel.vars);
    expect(fragment.transitions).toEqual(lowLevel.transitions);
  });
});
