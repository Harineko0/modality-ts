import { describe, expect, it } from "vitest";
import { reactRouterRouteExecutionProvider } from "./route-execution.js";
import { discoverReactRouterActionEffectApis } from "./server-effects.js";

describe("reactRouterRouteExecutionProvider", () => {
  it("maps route loaders, actions, gated loaders, and action revalidation", () => {
    const file = {
      path: "/repo/app/routes/dashboard.tsx",
      text: `
        export async function loader() {
          const session = await requireAuth();
          return { secret: session.user.id };
        }
        export async function action() {
          return { ok: true };
        }
      `,
      route: {
        pattern: "/dashboard",
        kind: "page" as const,
        file: "routes/dashboard.tsx",
      },
    };
    const inventory = { routes: [file.route] };
    const effectApis = discoverReactRouterActionEffectApis({
      fileName: file.path,
      sourceText: file.text,
      route: file.route,
      inventory,
    });

    const descriptor =
      reactRouterRouteExecutionProvider().describeRouteExecution({
        inventory,
        effectApis,
        files: [file],
      });

    expect(descriptor.loaders).toEqual([
      expect.objectContaining({
        id: "router-loader:/dashboard",
        op: "DATA /dashboard",
        routePattern: "/dashboard",
        readsResources: ["router:/dashboard"],
        gated: true,
      }),
    ]);
    expect(descriptor.actions).toEqual([
      expect.objectContaining({
        id: "router-action:/dashboard",
        op: "ACTION /dashboard",
        mutatesResources: ["router:/dashboard"],
        revalidates: ["router-loader:/dashboard"],
        outcomes: "success-error",
      }),
    ]);
    expect(descriptor.resources).toEqual([
      expect.objectContaining({ id: "router:/dashboard" }),
    ]);
  });
});
