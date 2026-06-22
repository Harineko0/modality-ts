import { describe, expect, it } from "vitest";
import { tanstackRouterModuleRolePlugin } from "./index.js";
import {
  classifyTanstackModule,
  shouldDiscoverTanstackEffectApis,
  tanstackModuleEntryExports,
} from "./module-roles.js";

const postsRoute = `
  import { createFileRoute } from '@tanstack/react-router'
  import { fetchPosts } from '../server/posts.server'

  export const Route = createFileRoute('/posts')({
    loader: () => fetchPosts(),
    component: PostsPage,
  })

  function PostsPage() {
    return <button onClick={() => {}}>load</button>
  }
`;

describe("tanstackRouterModuleRolePlugin", () => {
  const adapter = tanstackRouterModuleRolePlugin();

  it("keeps component interaction surface and excludes loader-only imports", () => {
    expect(
      adapter.classifyModule({
        fileName: "/proj/src/routes/posts.tsx",
        sourceText: postsRoute,
      }),
    ).toMatchObject({
      defaultContext: "shared",
      reason: "tanstack route module",
    });
    expect(
      adapter.moduleEntryExports({
        fileName: "/proj/src/routes/posts.tsx",
        sourceText: postsRoute,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "PostsPage", context: "client" }),
        expect.objectContaining({ name: "loader", context: "server" }),
      ]),
    );
  });

  it("treats .server. and /server/ paths as server-only", () => {
    expect(
      adapter.classifyModule({
        fileName: "/proj/src/server/posts.server.ts",
        sourceText: "export async function fetchPosts() { return [] }",
      }),
    ).toMatchObject({
      defaultContext: "server",
      serverOnly: true,
    });
    expect(
      adapter.isServerOnlyModule("/proj/src/server/posts.server.ts", {
        defaultContext: "shared",
      }),
    ).toBe(true);
  });

  it("treats beforeLoad and loader as effect-discovery surfaces", () => {
    expect(
      shouldDiscoverTanstackEffectApis({
        fileName: "/proj/src/routes/private.tsx",
        sourceText: `
          import { createFileRoute } from '@tanstack/react-router'
          export const Route = createFileRoute('/private')({
            beforeLoad: () => {},
            component: PrivatePage,
          })
          function PrivatePage() { return null }
        `,
        classification: classifyTanstackModule({
          fileName: "/proj/src/routes/private.tsx",
          sourceText: "",
        }),
        entryExports: [],
      }),
    ).toBe(true);
  });

  it("keeps ambiguous shared imports as unknown edges", () => {
    expect(
      adapter.classifyImportEdge({
        importer: "/proj/src/routes/posts.tsx",
        specifier: "../lib/shared",
        isTypeOnly: false,
        importerContext: "shared",
        surface: "interaction",
      }),
    ).toBe("unknown");
  });
});

describe("tanstackModuleEntryExports", () => {
  it("marks beforeLoad as a server entry export", () => {
    expect(
      tanstackModuleEntryExports({
        fileName: "/proj/src/routes/private.tsx",
        sourceText: `
          import { createFileRoute } from '@tanstack/react-router'
          export const Route = createFileRoute('/private')({
            beforeLoad: () => {},
            component: PrivatePage,
          })
          function PrivatePage() { return null }
        `,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "beforeLoad", context: "server" }),
      ]),
    );
  });
});
