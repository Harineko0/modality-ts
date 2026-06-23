import { describe, expect, it } from "vitest";
import {
  buildRouteExecutionTemplate,
  routeActionVarId,
  routeLoaderVarId,
  routeResourceVarId,
} from "./route-execution.js";

describe("buildRouteExecutionTemplate", () => {
  it("emits loader, action, and revalidation loop transitions", () => {
    const fragment = buildRouteExecutionTemplate({
      resources: [
        {
          id: "todos",
          domain: { kind: "tokens", count: 2, names: ["old", "new"] },
        },
      ],
      loaders: [
        {
          id: "dashboard",
          op: "DATA getServerSideProps /dashboard",
          routePattern: "/dashboard",
          producesDomain: {
            kind: "tokens",
            count: 2,
            names: ["empty", "private"],
          },
          readsResources: ["todos"],
          auto: "mount",
          gated: true,
        },
      ],
      actions: [
        {
          id: "save",
          op: "ACTION app/actions.ts#save",
          mutatesResources: ["todos"],
          revalidates: ["dashboard"],
          outcomes: "success-error",
        },
      ],
    });

    expect(fragment.vars.map((decl) => decl.id).sort()).toEqual([
      routeActionVarId("save", "status"),
      routeLoaderVarId("dashboard", "data"),
      routeLoaderVarId("dashboard", "stale"),
      routeLoaderVarId("dashboard", "status"),
      routeResourceVarId("todos"),
    ]);
    expect(
      fragment.vars.find((decl) => decl.id === routeResourceVarId("todos"))
        ?.role,
    ).toEqual({ kind: "cache-entry", group: "todos" });
    expect(fragment.transitions.map((transition) => transition.id)).toEqual(
      expect.arrayContaining([
        "route:loader:dashboard:fetch",
        "route:loader:dashboard:resolve:success:0",
        "route:action:save:invoke",
        "route:action:save:resolve:success",
        "route:action:save:revalidate",
      ]),
    );

    const revalidate = fragment.transitions.find(
      (transition) => transition.id === "route:action:save:revalidate",
    );
    expect(revalidate?.writes).toEqual(
      expect.arrayContaining([
        "sys:pending",
        routeLoaderVarId("dashboard", "stale"),
      ]),
    );
    expect(JSON.stringify(revalidate?.effect)).toContain(
      "DATA getServerSideProps /dashboard",
    );
  });
});
