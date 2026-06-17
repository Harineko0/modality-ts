import { describe, expect, it } from "vitest";
import type {
  LocationLowering,
  NavigationAdapter,
  NavigationLoweringCtx,
  NavigationLoweringResult,
  ResolvedOptions,
  RouteDiscoveryCtx,
  RouteInventory,
} from "./spi/index.js";
import { runExtractionPipeline } from "./pipeline/index.js";
import { extractReactSourceTransitions } from "./ts/react-source-transitions.js";
import { sourceWithReachableImports } from "../../cli/features/extract/project.js";

function fitLocationVars(
  inventory: RouteInventory,
  options: ResolvedOptions,
  lowering: LocationLowering,
) {
  const uiPatterns = inventory.routes
    .filter((node) => node.kind === "page" || node.kind === "index")
    .map((node) => node.pattern);
  const routeValues = [
    ...new Set([options.route, ...uiPatterns, ...lowering.pushTargets]),
  ];
  const historyRoutes = lowering.hasUnboundPush
    ? routeValues
    : [
        ...new Set([
          options.route,
          ...lowering.pushTargets,
          ...lowering.pushOrigins,
        ]),
      ].filter((route) => routeValues.includes(route));
  return [
    {
      id: "sys:route",
      domain: { kind: "enum" as const, values: routeValues },
      origin: "system" as const,
      scope: { kind: "global" as const },
      initial: options.route,
    },
    {
      id: "sys:history",
      domain: {
        kind: "boundedList" as const,
        inner: { kind: "enum" as const, values: historyRoutes },
        maxLen: options.bounds?.maxHistory ?? 4,
      },
      origin: "system" as const,
      scope: { kind: "global" as const },
      initial: [],
    },
  ];
}

function nextStyleAdapter(): NavigationAdapter {
  return {
    id: "next-fit",
    packageNames: ["next/navigation"],
    discoverRoutes: async (ctx: RouteDiscoveryCtx): Promise<RouteInventory> => {
      const routes = ctx.files
        .filter(
          (file) =>
            file.path.includes("app/") && file.path.endsWith("page.tsx"),
        )
        .map((file) => {
          const segment = file.path
            .replace(/^(?:.*\/)?app\//, "")
            .replace(/^page\.tsx$/, "")
            .replace(/\/page\.tsx$/, "");
          const pattern = segment.length === 0 ? "/" : `/${segment}`;
          return {
            pattern,
            kind: pattern === "/" ? ("index" as const) : ("page" as const),
            file: file.path,
          };
        });
      return { routes };
    },
    classifyNavigationCall(callee, args) {
      if (callee.endsWith(".push") && typeof args[0] === "string") {
        return { mode: "push", to: args[0] };
      }
      if (callee.endsWith(".replace") && typeof args[0] === "string") {
        return { mode: "replace", to: args[0] };
      }
      if (callee.endsWith(".back")) return { mode: "back" };
      if (callee === "redirect" && typeof args[0] === "string") {
        return { mode: "replace", to: args[0] };
      }
      return "unsupported";
    },
    classifyNavigationJsx(tag, attrs) {
      if (tag !== "Link") return "unsupported";
      const href = attrs.get("href");
      return typeof href === "string"
        ? { mode: "push", to: href }
        : "unsupported";
    },
    routeForComponent(componentName, inventory) {
      const normalized = componentName.replace(/Page$/i, "").toLowerCase();
      const match = inventory.routes.find((node) =>
        node.file?.toLowerCase().includes(`/${normalized}/page.tsx`),
      );
      return match?.pattern;
    },
    locationVars: fitLocationVars,
    harness: {
      setup: () => ({}),
      observe: () => "unobservable",
      navigate: () => undefined,
    },
  };
}

const inventory: RouteInventory = {
  routes: [
    { pattern: "/", kind: "index", file: "app/page.tsx" },
    { pattern: "/settings", kind: "page", file: "app/settings/page.tsx" },
  ],
};

describe("navigation adapter interface fit", () => {
  it("drives the shared engine with a fake Next.js-style adapter", () => {
    const adapter = nextStyleAdapter();
    const source = `
      import Link from 'next/link';
      export function Settings() {
        const router = useRouter();
        return (
          <>
            <Link href="/">Home</Link>
            <button onClick={() => router.push('/settings')}>Stay</button>
          </>
        );
      }
    `;

    const extracted = extractReactSourceTransitions(source, {
      route: "/settings",
      fileName: "app/settings/page.tsx",
      routePatterns: ["/", "/settings"],
      routerPlugin: adapter,
      inventory,
    });

    expect(
      extracted.transitions.filter((transition) => transition.cls === "nav"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "Settings.Link.navigate._",
          effect: {
            kind: "navigate",
            mode: "push",
            to: { kind: "lit", value: "/" },
          },
        }),
        expect.objectContaining({
          id: "Settings.onClick.navigate._settings",
          effect: {
            kind: "navigate",
            mode: "push",
            to: { kind: "lit", value: "/settings" },
          },
        }),
      ]),
    );

    const lowering = {
      pushTargets: ["/", "/settings"],
      pushOrigins: ["/settings"],
      hasUnboundPush: false,
    };
    const pipeline = runExtractionPipeline({
      sourceText: source,
      fileName: "app/settings/page.tsx",
      route: "/settings",
      routePatterns: ["/", "/settings"],
      routerPlugin: adapter,
      inventory,
      lowering,
    });

    expect(pipeline.routeVars.map((decl) => decl.id)).toEqual([
      "sys:route",
      "sys:history",
    ]);
    expect(
      pipeline.routeVars.find((decl) => decl.id === "sys:route")?.domain,
    ).toEqual({
      kind: "enum",
      values: ["/settings", "/"],
    });
    expect(
      pipeline.transitions.some(
        (transition) =>
          transition.cls === "nav" &&
          transition.effect.kind === "navigate" &&
          transition.effect.to?.kind === "lit" &&
          transition.effect.to.value === "/",
      ),
    ).toBe(true);
  });

  it("NavigationLoweringCtx and NavigationLoweringResult type-check", () => {
    const ctx: NavigationLoweringCtx = {
      inventory,
      routePatterns: ["/", "/settings"],
    };
    const result: NavigationLoweringResult = {
      effect: {
        kind: "navigate",
        mode: "push",
        to: { kind: "lit", value: "/" },
      },
      reads: [],
      writes: ["sys:route", "sys:history"],
      confidence: "exact",
    };
    expect(ctx.routePatterns).toContain("/");
    expect(result.effect.kind).toBe("navigate");
  });

  it("discovers FS-style Next routes from fixture files", async () => {
    const adapter = nextStyleAdapter();
    const inventoryFromFiles = await adapter.discoverRoutes({
      files: [
        { path: "app/page.tsx", text: "export default function Home() {}" },
        {
          path: "app/settings/page.tsx",
          text: "export default function Settings() {}",
        },
      ],
      readFile: async () => "",
    });
    expect(inventoryFromFiles.routes.map((node) => node.pattern)).toEqual([
      "/",
      "/settings",
    ]);
  });

  it("accepts a navigation-only adapter without module-role methods", () => {
    const adapter = nextStyleAdapter();
    expect(adapter.classifyModule).toBeUndefined();
    expect(adapter.discoverEffectApis).toBeUndefined();
  });

  it("uses a fake module-role provider for server/client surface selection", async () => {
    const moduleRoleAdapter = {
      id: "fake-module-roles",
      kind: "module-roles" as const,
      packageNames: ["fake"],
      classifyModule(ctx: { fileName: string; sourceText: string }) {
        if (ctx.sourceText.includes('"use client"')) {
          return {
            defaultContext: "client" as const,
            directives: ["use client" as const],
          };
        }
        if (ctx.fileName.endsWith("/actions.ts")) {
          return {
            defaultContext: "server" as const,
            serverOnly: true,
          };
        }
        return { defaultContext: "server" as const };
      },
      moduleEntryExports(ctx: { fileName: string }) {
        if (ctx.fileName.endsWith("/actions.ts")) {
          return [
            { name: "save", context: "server" as const, reason: "server action" },
          ];
        }
        if (ctx.fileName.endsWith("/page.tsx")) {
          return [
            {
              name: "default",
              context: "server" as const,
              reason: "server page render root",
            },
          ];
        }
        return [];
      },
      classifyImportEdge(ctx: { isTypeOnly: boolean }) {
        return ctx.isTypeOnly ? ("type" as const) : ("unknown" as const);
      },
      isServerOnlyModule(fileName: string) {
        return fileName.endsWith("/actions.ts");
      },
      shouldDiscoverEffectApis(ctx: {
        classification: { serverOnly?: boolean; defaultContext: string };
      }) {
        return (
          ctx.classification.serverOnly === true ||
          ctx.classification.defaultContext === "server"
        );
      },
    };
    const effectApiProvider = {
      id: "fake-effect-api",
      kind: "effect-api" as const,
      packageNames: ["fake"],
      discoverEffectApis(ctx: { fileName: string }) {
        if (!ctx.fileName.endsWith("/actions.ts")) return [];
        return [
          {
            opId: "ACTION /actions#save",
            source: { file: ctx.fileName, line: 1, column: 1 },
          },
        ];
      },
    };

    const result = await sourceWithReachableImports(
      [
        {
          path: "/proj/app/page.tsx",
          text: `
            import { save } from "./actions";
            export default function Home() {
              return <form action={save}><button>Save</button></form>;
            }
          `,
        },
        {
          path: "/proj/app/actions.ts",
          text: `
            "use server";
            export async function save() {}
          `,
        },
      ],
      { paths: [] },
      {
        moduleRoleAdapters: [moduleRoleAdapter],
        effectApiProviders: [effectApiProvider],
        inventory: {
          routes: [
            {
              pattern: "/",
              kind: "page",
              file: "/proj/app/page.tsx",
            },
          ],
        },
      },
    );

    expect(result.effectApis).toContain("ACTION /actions#save");
    const actions = result.sources.find((entry) =>
      entry.path.endsWith("app/actions.ts"),
    );
    expect(actions?.interactionText.trim()).toBe("");
  });
});
