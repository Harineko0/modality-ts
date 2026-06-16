import { describe, expect, it } from "vitest";
import {
  classifyNextImportEdge,
  classifyNextModule,
  nextModuleEntryExports,
} from "./module-roles.js";
import { discoverNextServerEffectApis } from "./server-effects.js";

describe("classifyNextModule", () => {
  it("classifies app router pages as server modules", () => {
    expect(
      classifyNextModule({
        fileName: "/proj/app/dashboard/page.tsx",
        sourceText: "export default function Page() {}",
      }),
    ).toMatchObject({
      defaultContext: "server",
      reason: "app router server module",
    });
  });

  it('classifies "use client" modules as client', () => {
    expect(
      classifyNextModule({
        fileName: "/proj/components/Counter.tsx",
        sourceText: '"use client";\nexport function Counter() {}',
      }),
    ).toMatchObject({
      defaultContext: "client",
      directives: ["use client"],
    });
  });

  it('classifies "use server" modules as server-only', () => {
    expect(
      classifyNextModule({
        fileName: "/proj/app/actions.ts",
        sourceText: '"use server";\nexport async function save() {}',
      }),
    ).toMatchObject({
      defaultContext: "server",
      serverOnly: true,
      directives: ["use server"],
    });
  });
});

describe("nextModuleEntryExports", () => {
  it("marks app page default export as server render root", () => {
    expect(
      nextModuleEntryExports({
        fileName: "/proj/app/page.tsx",
        sourceText: `
          export default function Home() { return <button onClick={() => {}} />; }
          export async function generateMetadata() { return {}; }
        `,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "default",
          context: "server",
        }),
        expect.objectContaining({
          name: "generateMetadata",
          context: "server",
        }),
      ]),
    );
  });
});

describe("classifyNextImportEdge", () => {
  it("treats css and image imports as asset edges", () => {
    expect(
      classifyNextImportEdge({
        importer: "/proj/app/page.tsx",
        specifier: "./page.module.css",
        isTypeOnly: false,
        importerContext: "server",
        surface: "render",
      }),
    ).toBe("asset");
    expect(
      classifyNextImportEdge({
        importer: "/proj/app/page.tsx",
        specifier: "../public/logo.png",
        isTypeOnly: false,
        importerContext: "server",
        surface: "render",
      }),
    ).toBe("asset");
    expect(
      classifyNextImportEdge({
        importer: "/proj/app/page.tsx",
        specifier: "next/font/google",
        isTypeOnly: false,
        importerContext: "server",
        surface: "render",
      }),
    ).toBe("asset");
  });
});

describe("discoverNextServerEffectApis", () => {
  it("discovers route handlers and pages data functions", () => {
    expect(
      discoverNextServerEffectApis({
        fileName: "/proj/app/api/posts/route.ts",
        sourceText: `
          export async function GET() { return Response.json([]); }
          export async function POST() { return Response.json({ ok: true }); }
        `,
        route: { pattern: "/api/posts", kind: "resource" },
      }).map((entry) => entry.opId),
    ).toEqual(["GET /api/posts", "POST /api/posts"]);

    expect(
      discoverNextServerEffectApis({
        fileName: "/proj/pages/blog/[slug].tsx",
        sourceText: `
          export async function getServerSideProps() { return { props: {} }; }
          export default function Blog() { return null; }
        `,
        route: { pattern: "/blog/[slug]", kind: "page" },
      }).map((entry) => entry.opId),
    ).toEqual(["DATA getServerSideProps /blog/[slug]"]);
  });

  it("warns on exported server actions without visible auth guards", () => {
    const entries = discoverNextServerEffectApis({
      fileName: "/proj/app/actions.ts",
      sourceText: `
        "use server";
        export async function deletePost() {
          await fetch("/api/posts", { method: "DELETE" });
        }
      `,
    });
    expect(entries[0]?.warning).toContain("auth/guard");
    expect(entries.map((entry) => entry.opId)).toEqual(
      expect.arrayContaining([
        "ACTION /proj/app/actions.ts#deletePost",
        "DELETE /api/posts",
      ]),
    );
  });
});
