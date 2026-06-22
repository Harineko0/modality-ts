import { describe, expect, it } from "vitest";
import type { RouteInventory, RoutePlugin } from "../spi/index.js";
import { extractReactSourceTransitions } from "./react-source-transitions.js";

const analyticsInventory: RouteInventory = {
  routes: [
    { pattern: "/", kind: "index", file: "home.tsx" },
    { pattern: "/analytics", kind: "page", file: "Analytics.tsx" },
  ],
};

const routerTestAdapter: RoutePlugin = {
  id: "router-test",
  packageNames: ["react-router"],
  discoverRoutes: async () => ({ routes: [] }),
  classifyNavigationCall(callee, args) {
    if (callee.endsWith(".push") && typeof args[0] === "string") {
      return { mode: "push", to: args[0] };
    }
    if (callee === "navigate" && typeof args[0] === "string") {
      return { mode: "push", to: args[0] };
    }
    return "unsupported";
  },
  classifyNavigationJsx(tag, attrs) {
    if (tag === "Link") {
      const to = attrs.get("to");
      return typeof to === "string" ? { mode: "push", to } : "unsupported";
    }
    return "unsupported";
  },
  routeForComponent(componentName, inventory) {
    const normalized = componentName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    const match = inventory.routes.find(
      (node) =>
        (node.kind === "page" || node.kind === "index") &&
        node.file
          ?.replace(/[^a-zA-Z0-9]/g, "")
          .toLowerCase()
          .includes(normalized),
    );
    return match?.pattern;
  },
  locationVars: () => [],
  harness: {
    setup: () => ({}),
    observe: () => "unobservable",
    navigate: () => undefined,
  },
};

describe("framework-blind navigation extraction", () => {
  it("produces no navigation transitions when the adapter is absent", () => {
    const result = extractReactSourceTransitions(
      `
      import { Link } from 'react-router';
      export function App() {
        return (
          <>
            <Link to="/analytics">Analytics</Link>
            <button onClick={() => navigate('/checkout')}>Checkout</button>
          </>
        );
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        routePatterns: ["/", "/analytics", "/checkout"],
      },
    );
    expect(
      result.transitions.filter((transition) => transition.cls === "nav"),
    ).toEqual([]);
  });

  it("extracts JSX navigation via the adapter and inventory route binding", () => {
    const result = extractReactSourceTransitions(
      `
      import { Link } from 'react-router';
      export function Analytics() {
        return <Link to="/analytics">Clear</Link>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        routePatterns: ["/", "/analytics"],
        routePlugin: routerTestAdapter,
        inventory: analyticsInventory,
      },
    );
    expect(
      result.transitions.find(
        (transition) => transition.id === "Analytics.Link.navigate._analytics",
      ),
    ).toMatchObject({
      cls: "nav",
      guard: {
        kind: "eq",
        args: [
          { kind: "read", var: "sys:route" },
          { kind: "lit", value: "/analytics" },
        ],
      },
      reads: expect.arrayContaining(["sys:history", "sys:route"]),
      effect: expect.objectContaining({
        kind: "if",
      }),
      writes: expect.arrayContaining(["sys:route", "sys:history"]),
    });
  });

  it("extracts call-site navigation via classifyNavigationCall", () => {
    const result = extractReactSourceTransitions(
      `
      export function App() {
        return <button onClick={() => router.push('/checkout')}>Checkout</button>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        routePatterns: ["/checkout"],
        routePlugin: routerTestAdapter,
      },
    );
    expect(result.transitions).toHaveLength(1);
    expect(result.transitions[0]).toMatchObject({
      id: "App.onClick.navigate._checkout",
      cls: "nav",
      effect: expect.objectContaining({
        kind: "if",
      }),
      writes: expect.arrayContaining(["sys:route", "sys:history"]),
    });
  });
});
