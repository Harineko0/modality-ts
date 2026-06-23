import { describe, expect, it } from "vitest";
import { tanstackRouterEffectApiProvider } from "./index.js";
import {
  discoverTanstackRouteEffectApis,
  tanstackBeforeLoadOpId,
  tanstackLoaderOpId,
  tanstackRedirectTargetForFile,
} from "./server-effects.js";

describe("tanstackRouterEffectApiProvider", () => {
  it("discovers LOADER operations", () => {
    const provider = tanstackRouterEffectApiProvider();
    const apis = provider.discoverEffectApis({
      fileName: "/proj/src/routes/posts.tsx",
      sourceText: `
        import { createFileRoute } from '@tanstack/react-router'
        export const Route = createFileRoute('/posts')({
          loader: () => fetchPosts(),
          component: PostsPage,
        })
        function PostsPage() { return null }
      `,
      route: {
        pattern: "/posts",
        kind: "page",
        file: "/proj/src/routes/posts.tsx",
      },
    });
    expect(apis).toEqual([expect.objectContaining({ opId: "LOADER /posts" })]);
  });
});

describe("discoverTanstackRouteEffectApis", () => {
  it("discovers loader: () => fetchPosts() as LOADER /posts", () => {
    const apis = discoverTanstackRouteEffectApis({
      fileName: "/proj/src/routes/posts.tsx",
      sourceText: `
        import { createFileRoute } from '@tanstack/react-router'
        import { fetchPosts } from '../../../sources/server/posts.server'
        export const Route = createFileRoute('/posts')({
          loader: () => fetchPosts(),
          component: PostsPage,
        })
        function PostsPage() { return null }
      `,
      route: {
        pattern: "/posts",
        kind: "page",
        file: "/proj/src/routes/posts.tsx",
      },
    });
    expect(apis.map((api) => api.opId)).toContain("LOADER /posts");
  });

  it("discovers beforeLoad as BEFORE_LOAD /private", () => {
    const apis = discoverTanstackRouteEffectApis({
      fileName: "/proj/src/routes/private.tsx",
      sourceText: `
        import { createFileRoute } from '@tanstack/react-router'
        export const Route = createFileRoute('/private')({
          beforeLoad: () => {},
          component: PrivatePage,
        })
        function PrivatePage() { return null }
      `,
      route: {
        pattern: "/private",
        kind: "page",
        file: "/proj/src/routes/private.tsx",
      },
    });
    expect(apis.map((api) => api.opId)).toContain("BEFORE_LOAD /private");
  });

  it("captures static redirect({ to: '/login' })", () => {
    const source = `
      import { createFileRoute, redirect } from '@tanstack/react-router'
      export const Route = createFileRoute('/private')({
        beforeLoad: () => {
          throw redirect({ to: '/login' })
        },
        component: PrivatePage,
      })
      function PrivatePage() { return null }
    `;
    expect(
      tanstackRedirectTargetForFile(source, "/proj/src/routes/private.tsx"),
    ).toBe("/login");
    const apis = discoverTanstackRouteEffectApis({
      fileName: "/proj/src/routes/private.tsx",
      sourceText: source,
      route: {
        pattern: "/private",
        kind: "page",
        file: "/proj/src/routes/private.tsx",
      },
    });
    expect(
      apis.some((api) => api.opId === tanstackBeforeLoadOpId("/private")),
    ).toBe(true);
  });

  it("caveats dynamic redirect targets instead of modeling them exactly", () => {
    const apis = discoverTanstackRouteEffectApis({
      fileName: "/proj/src/routes/private.tsx",
      sourceText: `
        import { createFileRoute, redirect } from '@tanstack/react-router'
        export const Route = createFileRoute('/private')({
          beforeLoad: ({ context }) => {
            throw redirect({ to: context.next })
          },
          component: PrivatePage,
        })
        function PrivatePage() { return null }
      `,
      route: {
        pattern: "/private",
        kind: "page",
        file: "/proj/src/routes/private.tsx",
      },
    });
    expect(
      apis.some(
        (api) =>
          api.warning?.includes("Dynamic redirect") ||
          api.caveats?.some((caveat) => caveat.kind === "model-slack"),
      ),
    ).toBe(true);
    expect(
      tanstackRedirectTargetForFile(
        `
        import { createFileRoute, redirect } from '@tanstack/react-router'
        export const Route = createFileRoute('/private')({
          beforeLoad: ({ context }) => {
            throw redirect({ to: context.next })
          },
          component: PrivatePage,
        })
        function PrivatePage() { return null }
      `,
        "/proj/src/routes/private.tsx",
      ),
    ).toBeUndefined();
  });
});

describe("tanstack effect op ids", () => {
  it("uses route-pattern prefixes", () => {
    expect(tanstackLoaderOpId("/posts")).toBe("LOADER /posts");
    expect(tanstackBeforeLoadOpId("/private")).toBe("BEFORE_LOAD /private");
  });
});
