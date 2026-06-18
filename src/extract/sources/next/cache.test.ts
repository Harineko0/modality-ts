import { describe, expect, it } from "vitest";
import {
  aggregateNextCacheDiscoveries,
  createNextCacheTemplate,
  discoverNextCacheFromSources,
  discoverNextCacheUsage,
  nextCacheVarDecls,
} from "./cache.js";
import { nextCacheStorageProvider } from "./cache-provider.js";
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

describe("nextCacheStorageProvider", () => {
  it("returns vars and transitions matching low-level discovery", () => {
    const sources = [
      {
        path: "/proj/app/actions.ts",
        text: `
          "use server";
          import { updateTag } from "next/cache";
          export async function save() {
            updateTag("posts");
          }
        `,
      },
    ];
    const provider = nextCacheStorageProvider();
    const fragment = provider.discoverCacheStorage({
      files: sources,
      options: { route: "/" },
    });
    const direct = discoverNextCacheFromSources(
      sources.map((source) => ({
        fileName: source.path,
        sourceText: source.text,
      })),
    );
    expect(fragment.vars.map((decl) => decl.id)).toEqual(
      direct.vars.map((decl) => decl.id),
    );
    expect(fragment.transitions.map((transition) => transition.id)).toEqual(
      direct.transitions.map((transition) => transition.id),
    );
    expect(fragment.caveats).toEqual([]);
  });

  it("preserves structured caveats for dynamic request markers", () => {
    const provider = nextCacheStorageProvider();
    const fragment = provider.discoverCacheStorage({
      files: [
        {
          path: "/proj/app/page.tsx",
          text: `
            export default async function Page() {
              await fetch("/api/user", { cache: "no-store" });
            }
          `,
        },
      ],
      inventory: {
        routes: [
          { pattern: "/", kind: "page", file: "/proj/app/page.tsx" },
        ],
      },
      options: { route: "/" },
    });
    expect(fragment.warnings).toEqual(
      expect.arrayContaining([
        "Dynamic request marker (no-store/connection) on route / skips cache vars",
      ]),
    );
    expect(fragment.caveats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "model-slack",
          id: "next-cache:/",
          reason:
            "Dynamic request marker (no-store/connection) on route / skips cache vars",
          severity: "over-approx",
        }),
      ]),
    );
    expect(
      fragment.transitions.every((transition) => transition.confidence),
    ).toBe(true);
  });

  it("returns transition confidence for cache revalidation", () => {
    const provider = nextCacheStorageProvider();
    const fragment = provider.discoverCacheStorage({
      files: [
        {
          path: "/proj/app/profile/actions.ts",
          text: `
            "use server";
            import { revalidatePath } from "next/cache";
            export async function saveProfile() {
              revalidatePath("/profile");
            }
          `,
        },
      ],
      inventory: {
        routes: [{ pattern: "/profile", kind: "page" }],
      },
      options: { route: "/profile" },
    });
    const pathTransition = fragment.transitions.find((transition) =>
      transition.id.includes("revalidatePath"),
    );
    expect(pathTransition?.confidence).toBe("over-approx");
    const tagTransition = fragment.transitions.find((transition) =>
      transition.id.includes("updateTag"),
    );
    if (tagTransition) expect(tagTransition.confidence).toBe("exact");
  });
});
