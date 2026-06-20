import { describe, expect, it } from "vitest";
import { extractReactSourceTransitions } from "../../engine/ts/react-source-transitions.js";
import type { RouteInventory } from "modality-ts/extract/engine/spi";
import { tanstackRouterAdapter } from "./index.js";
import {
  classifyNavigationCall,
  classifyNavigationJsx,
  classifyTanstackNavigationCall,
  classifyTanstackNavigationJsx,
  resolveTanstackToTarget,
} from "./navigation.js";

const routePatterns = ["/", "/posts", "/posts/:postId", "/login"];

const postsInventory: RouteInventory = {
  routes: [
    {
      pattern: "/posts/:postId",
      kind: "page",
      file: "src/routes/posts/$postId.tsx",
      metadata: {
        tanstackRouteTree: {
          routeId: "/posts/$postId",
          fullPath: "/posts/:postId",
          segmentKind: "dynamic",
          routeKind: "page",
          discoveryMode: "file",
          filePath: "src/routes/posts/$postId.tsx",
        },
      },
    },
    {
      pattern: "/posts",
      kind: "page",
      file: "src/routes/posts/index.tsx",
      metadata: {
        tanstackRouteTree: {
          routeId: "/posts",
          fullPath: "/posts",
          segmentKind: "index",
          routeKind: "page",
          discoveryMode: "file",
        },
      },
    },
    {
      pattern: "/login",
      kind: "page",
      file: "src/routes/login.tsx",
      metadata: {
        tanstackRouteTree: {
          routeId: "/login",
          fullPath: "/login",
          segmentKind: "static",
          routeKind: "page",
          discoveryMode: "file",
        },
      },
    },
  ],
};

const adapter = tanstackRouterAdapter();

describe("classifyTanstackNavigationCall", () => {
  it("classifies object navigate targets with TanStack param syntax", () => {
    expect(
      classifyTanstackNavigationCall(
        "navigate",
        [{ to: "/posts/$postId", params: { postId: "1" } }],
        routePatterns,
      ).classification,
    ).toEqual({
      mode: "push",
      to: "/posts/:postId",
    });
  });

  it("classifies replace navigation", () => {
    expect(
      classifyNavigationCall("navigate", [{ to: "/posts", replace: true }]),
    ).toEqual({
      mode: "replace",
      to: "/posts",
    });
  });

  it("classifies router.navigate push", () => {
    expect(
      classifyNavigationCall("router.navigate", [{ to: "/posts" }]),
    ).toEqual({
      mode: "push",
      to: "/posts",
    });
  });

  it("classifies router.history.back and router.back", () => {
    expect(classifyNavigationCall("router.history.back", [])).toEqual({
      mode: "back",
    });
    expect(classifyNavigationCall("router.back", [])).toEqual({ mode: "back" });
  });

  it("does not treat string navigate as TanStack Router", () => {
    expect(classifyNavigationCall("navigate", ["/posts"])).toBe("unsupported");
  });

  it("over-approximates dynamic unknown to with a warning", () => {
    const result = classifyTanstackNavigationCall(
      "navigate",
      [{ to: { expr: "dynamic" } }],
      routePatterns,
    );
    expect(result.classification).toEqual({ mode: "push", to: "/" });
    expect(result.warnings[0]?.kind).toBe("model-slack");
  });
});

describe("classifyTanstackNavigationJsx", () => {
  it("classifies Link and Navigate elements", () => {
    expect(
      classifyNavigationJsx(
        "Link",
        new Map([
          ["to", "/posts/$postId"],
          ["params", { postId: "1" }],
        ]),
      ),
    ).toEqual({
      mode: "push",
      to: "/posts/:postId",
    });
    expect(
      classifyNavigationJsx(
        "Link",
        new Map([
          ["to", "/posts"],
          ["replace", true],
        ]),
      ),
    ).toEqual({
      mode: "replace",
      to: "/posts",
    });
    expect(
      classifyNavigationJsx("Navigate", new Map([["to", "/login"]])),
    ).toEqual({
      mode: "push",
      to: "/login",
    });
  });

  it("represents search-only navigation with a caveat", () => {
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
    expect(result.warnings[0]?.message).toContain("Search-only");
  });
});

describe("resolveTanstackToTarget", () => {
  it("maps TanStack dynamic segments to modality patterns", () => {
    expect(
      resolveTanstackToTarget({ to: "/posts/$postId" }, routePatterns),
    ).toBe("/posts/:postId");
  });
});

describe("tanstack navigation extraction", () => {
  it("extracts useNavigate transitions from route components", () => {
    const result = extractReactSourceTransitions(
      `
      import { useNavigate } from '@tanstack/react-router'
      export function PostsPage() {
        const navigate = useNavigate()
        return (
          <button onClick={() => navigate({ to: '/posts' })}>All posts</button>
        )
      }
      `,
      {
        route: "/posts",
        fileName: "src/routes/posts/index.tsx",
        routePatterns,
        routerPlugin: adapter,
        inventory: postsInventory,
      },
    );
    expect(
      result.transitions.some((transition) => transition.cls === "nav"),
    ).toBe(true);
  });

  it("extracts static Link navigation transitions", () => {
    const result = extractReactSourceTransitions(
      `
      import { Link } from '@tanstack/react-router'
      export function PostsPage() {
        return <Link to="/posts/$postId" params={{ postId: '1' }}>Post</Link>
      }
      `,
      {
        route: "/posts",
        fileName: "src/routes/posts/index.tsx",
        routePatterns,
        routerPlugin: adapter,
        inventory: postsInventory,
      },
    );
    expect(
      result.transitions.find((transition) =>
        transition.id.includes("Link.navigate"),
      ),
    ).toMatchObject({
      cls: "nav",
      writes: expect.arrayContaining(["sys:route", "sys:history"]),
    });
  });
});
