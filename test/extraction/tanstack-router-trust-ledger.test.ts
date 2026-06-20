import { describe, expect, it } from "vitest";
import {
  classifyTanstackNavigationCall,
  classifyTanstackNavigationJsx,
} from "../../src/extract/sources/tanstack-router/navigation.js";
import {
  discoverTanstackRouteEffectApis,
  tanstackRedirectTargetForFile,
} from "../../src/extract/sources/tanstack-router/server-effects.js";
import {
  routeForComponent,
  discoverRoutes,
} from "../../src/extract/sources/tanstack-router/discover.js";
import {
  MAX_TANSTACK_LOADER_CACHE_ROUTES,
  selectTanstackLoaderCacheRoutes,
} from "../../src/extract/sources/tanstack-router/cache.js";

const routePatterns = ["/", "/posts", "/posts/:postId", "/login"];

describe("tanstack trust-ledger regressions", () => {
  it("emits model-slack when dynamic navigation targets are unknown", () => {
    const result = classifyTanstackNavigationCall(
      "navigate",
      [{ to: { expr: "dynamic" } }],
      routePatterns,
    );
    expect(result.classification).toEqual({ mode: "push", to: "/" });
    expect(result.warnings[0]?.kind).toBe("model-slack");
  });

  it("emits model-slack for search-only Link navigation", () => {
    const result = classifyTanstackNavigationJsx(
      "Link",
      new Map([["search", { q: "modality" }]]),
      routePatterns,
      "/posts",
    );
    expect(result.classification).toEqual({
      kind: "search-only",
      origin: "/posts",
    });
    expect(result.warnings[0]?.kind).toBe("model-slack");
  });

  it("emits model-slack for dynamic redirect targets in beforeLoad", () => {
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
      apis.some((api) =>
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

  it("emits model-slack when loader cache keys exceed the bounded window", () => {
    const loaderRoutes = Array.from(
      { length: MAX_TANSTACK_LOADER_CACHE_ROUTES + 3 },
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
    expect(
      selected.caveats.some((caveat) => caveat.kind === "model-slack"),
    ).toBe(true);
  });

  it("returns undefined for ambiguous component-to-route basename matches", async () => {
    const inventory = await discoverRoutes({
      files: [
        {
          path: "src/routes/posts/index.tsx",
          text: `import { createFileRoute } from '@tanstack/react-router'\nexport const Route = createFileRoute('/posts')({ component: Index })`,
        },
        {
          path: "src/routes/tags/index.tsx",
          text: `import { createFileRoute } from '@tanstack/react-router'\nexport const Route = createFileRoute('/tags')({ component: Index })`,
        },
      ],
      readFile: async () => "",
    });
    expect(routeForComponent("Index", inventory)).toBeUndefined();
  });
});
