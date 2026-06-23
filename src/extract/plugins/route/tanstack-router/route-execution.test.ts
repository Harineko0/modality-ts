import { describe, expect, it } from "vitest";
import { tanstackRouterRouteExecutionPlugin } from "./route-execution.js";

describe("tanstackRouterRouteExecutionPlugin", () => {
  it("maps discovered loader ops to route loaders", () => {
    const descriptor =
      tanstackRouterRouteExecutionPlugin().describeRouteExecution({
        inventory: {
          routes: [
            {
              pattern: "/dashboard",
              kind: "page",
              file: "routes/dashboard.tsx",
            },
          ],
        },
        effectApis: [
          {
            opId: "LOADER /dashboard",
            source: {
              file: "/repo/app/routes/dashboard.tsx",
              line: 3,
              column: 5,
            },
          },
        ],
        files: [],
      });

    expect(descriptor.loaders).toEqual([
      expect.objectContaining({
        id: "tanstack-loader:/dashboard",
        op: "LOADER /dashboard",
        routePattern: "/dashboard",
        readsResources: ["tanstack:/dashboard"],
      }),
    ]);
    expect(descriptor.resources).toEqual([
      expect.objectContaining({ id: "tanstack:/dashboard" }),
    ]);
    expect(descriptor.actions).toEqual([]);
  });
});
