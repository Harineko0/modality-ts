import { describe, expect, it } from "vitest";
import {
  aggregateNextCacheDiscoveries,
  createNextCacheTemplate,
  discoverNextCacheUsage,
  nextCacheVarDecls,
} from "./cache.js";
import { nextCacheVarId } from "./routes.js";

describe("discoverNextCacheUsage", () => {
  it("discovers updateTag and creates immediate invalidation transitions", () => {
    const discovery = discoverNextCacheUsage({
      fileName: "/proj/app/actions.ts",
      sourceText: `
        "use server";
        import { updateTag } from "next/cache";
        export async function save() {
          updateTag("posts");
        }
      `,
    });
    const fragment = createNextCacheTemplate(
      discovery.keys,
      discovery.revalidations,
    );
    const cacheVar = nextCacheVarId("tag:posts");
    expect(discovery.keys.map((key) => key.id)).toContain("tag:posts");
    expect(fragment.vars.map((decl) => decl.id)).toContain(cacheVar);
    expect(
      fragment.transitions.some(
        (transition) =>
          transition.writes.includes(cacheVar) &&
          transition.id.includes("updateTag") &&
          transition.id.includes("immediate"),
      ),
    ).toBe(true);
    expect(
      fragment.transitions.some(
        (transition) =>
          transition.effect.kind === "assign" &&
          transition.effect.var === cacheVar &&
          transition.effect.expr.kind === "lit" &&
          transition.effect.expr.value === "refreshing",
      ),
    ).toBe(true);
  });

  it("models revalidateTag with max profile as stale-while-revalidate", () => {
    const discovery = discoverNextCacheUsage({
      fileName: "/proj/app/api/revalidate/route.ts",
      sourceText: `
        import { revalidateTag } from "next/cache";
        export async function POST() {
          revalidateTag("posts", "max");
        }
      `,
      route: { pattern: "/api/revalidate", kind: "resource" },
    });
    const fragment = createNextCacheTemplate(
      discovery.keys,
      discovery.revalidations,
    );
    const cacheVar = nextCacheVarId("tag:posts");
    expect(
      fragment.transitions.some(
        (transition) =>
          transition.id.includes("revalidateTag") &&
          transition.id.includes("stale"),
      ),
    ).toBe(true);
    expect(
      fragment.transitions.some((transition) =>
        transition.id.includes("refresh"),
      ),
    ).toBe(true);
    expect(fragment.vars.find((decl) => decl.id === cacheVar)?.initial).toBe(
      "empty",
    );
  });

  it("revalidatePath affects path-associated cache vars", () => {
    const discovery = discoverNextCacheUsage({
      fileName: "/proj/app/profile/actions.ts",
      sourceText: `
        "use server";
        import { revalidatePath, cacheTag } from "next/cache";
        export async function saveProfile() {
          cacheTag("profile");
          revalidatePath("/profile");
        }
      `,
      route: { pattern: "/profile", kind: "page" },
    });
    const aggregated = aggregateNextCacheDiscoveries([discovery], {
      routes: [{ pattern: "/profile", kind: "page" }],
    });
    const pathVar = nextCacheVarId("path:/profile");
    const tagVar = nextCacheVarId("tag:profile");
    expect(aggregated.vars.map((decl) => decl.id)).toEqual(
      expect.arrayContaining([pathVar, tagVar]),
    );
    expect(
      aggregated.transitions.some(
        (transition) =>
          transition.id.includes("revalidatePath") &&
          transition.writes.includes(pathVar),
      ),
    ).toBe(true);
  });

  it("skips cache vars when no-store fetch is present", () => {
    const discovery = discoverNextCacheUsage({
      fileName: "/proj/app/page.tsx",
      sourceText: `
        export default async function Page() {
          await fetch("/api/user", { cache: "no-store" });
        }
      `,
      route: { pattern: "/", kind: "page" },
    });
    expect(discovery.dynamicRequest).toBe(true);
    expect(nextCacheVarDecls(discovery.keys, { dynamicRequest: true })).toEqual(
      [],
    );
  });

  it("discovers fetch next.tags and force-cache keys", () => {
    const discovery = discoverNextCacheUsage({
      fileName: "/proj/app/page.tsx",
      sourceText: `
        export default async function Page() {
          await fetch("/api/posts", {
            cache: "force-cache",
            next: { revalidate: 60, tags: ["posts"] },
          });
        }
      `,
      route: { pattern: "/", kind: "page" },
    });
    expect(discovery.keys.map((key) => key.id)).toEqual(
      expect.arrayContaining(["tag:posts", "fetch:/api/posts"]),
    );
  });
});
