import { describe, expect, it } from "vitest";
import { discoverNextServerEffectApis } from "./server-effects.js";
import { nextRouteExecutionProvider } from "./route-execution.js";

describe("nextRouteExecutionProvider", () => {
  it("maps data functions, server actions, auth guards, and revalidation", () => {
    const page = {
      path: "/repo/app/dashboard/page.tsx",
      text: `
        export async function getServerSideProps() {
          const session = await getServerSession();
          return { props: { secret: "yes" } };
        }
        export default function Page() { return null; }
      `,
      route: {
        pattern: "/dashboard",
        kind: "page" as const,
        file: "/repo/app/dashboard/page.tsx",
      },
    };
    const actions = {
      path: "/repo/app/actions.ts",
      text: `
        "use server";
        import { revalidatePath } from "next/cache";
        export async function save() {
          revalidatePath("/dashboard");
        }
      `,
    };
    const inventory = { routes: [page.route] };
    const effectApis = [page, actions].flatMap((file) =>
      discoverNextServerEffectApis({
        fileName: file.path,
        sourceText: file.text,
        route: file.route,
        inventory,
      }),
    );

    const descriptor = nextRouteExecutionProvider().describeRouteExecution({
      inventory,
      effectApis,
      files: [page, actions],
    });

    expect(descriptor.loaders).toHaveLength(1);
    expect(descriptor.loaders[0]).toMatchObject({
      op: "DATA getServerSideProps /dashboard",
      routePattern: "/dashboard",
      gated: true,
      readsResources: ["next:/dashboard"],
    });
    expect(descriptor.actions).toHaveLength(1);
    expect(descriptor.actions[0]).toMatchObject({
      op: "ACTION /repo/app/actions.ts#save",
      mutatesResources: ["next:/dashboard"],
      revalidates: [descriptor.loaders[0]?.id],
      outcomes: "success-error",
    });
    expect(descriptor.resources).toEqual([
      expect.objectContaining({ id: "next:/dashboard" }),
    ]);
  });
});
