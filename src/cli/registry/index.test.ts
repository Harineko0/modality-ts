import { describe, expect, it } from "vitest";
import type {
  LocationLowering,
  NavigationAdapter,
  ResolvedOptions,
  RouteDiscoveryCtx,
  RouteInventory,
  StateVarDecl,
} from "modality-ts/extract/engine/spi";
import { createModalityRegistry } from "./index.js";

function fakeNavigationAdapter(
  overrides: Partial<NavigationAdapter> = {},
): NavigationAdapter {
  return {
    id: "fake-router",
    version: "0.0.1",
    packageNames: ["fake-router"],
    discoverRoutes: async () => ({ routes: [] }),
    classifyNavigationCall: () => "unsupported",
    locationVars: () => [],
    harness: {
      setup: () => ({}),
      observe: () => "unobservable",
      navigate: () => undefined,
    },
    ...overrides,
  };
}

describe("validateRouterPlugin", () => {
  it("accepts a NavigationAdapter with the required methods", () => {
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        routerPlugin: fakeNavigationAdapter(),
      }),
    ).not.toThrow();
  });

  it("rejects adapters missing discoverRoutes", () => {
    const { discoverRoutes: _, ...incomplete } = fakeNavigationAdapter();
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        routerPlugin: incomplete as NavigationAdapter,
      }),
    ).toThrow(
      "Invalid router plugin fake-router: discoverRoutes must be a function",
    );
  });

  it("rejects adapters missing classifyNavigationCall", () => {
    const { classifyNavigationCall: _, ...incomplete } =
      fakeNavigationAdapter();
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        routerPlugin: incomplete as NavigationAdapter,
      }),
    ).toThrow(
      "Invalid router plugin fake-router: classifyNavigationCall must be a function",
    );
  });

  it("rejects adapters missing locationVars", () => {
    const { locationVars: _, ...incomplete } = fakeNavigationAdapter();
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        routerPlugin: incomplete as NavigationAdapter,
      }),
    ).toThrow(
      "Invalid router plugin fake-router: locationVars must be a function",
    );
  });

  it("rejects adapters missing harness.navigate", () => {
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        routerPlugin: fakeNavigationAdapter({
          harness: {
            setup: () => ({}),
            observe: () => "unobservable",
          },
        }),
      }),
    ).toThrow(
      "Invalid router plugin fake-router: harness.setup, harness.observe, and harness.navigate are required",
    );
  });

  it("rejects legacy-only router plugins without NavigationAdapter methods", () => {
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        routerPlugin: {
          id: "legacy-router",
          packageNames: ["react-router"],
          harness: {
            setup: () => ({}),
            observe: () => "unobservable",
            navigate: () => undefined,
          },
        } as NavigationAdapter,
      }),
    ).toThrow(
      "Invalid router plugin legacy-router: discoverRoutes must be a function",
    );
  });
});

// Type-level fixture: a complete adapter literal must satisfy NavigationAdapter.
const _navigationAdapterFixture: NavigationAdapter = {
  id: "type-fixture",
  packageNames: ["fixture"],
  discoverRoutes: async (_ctx: RouteDiscoveryCtx): Promise<RouteInventory> => ({
    routes: [],
  }),
  classifyNavigationCall: () => "unsupported",
  locationVars: (
    _inventory: RouteInventory,
    _options: ResolvedOptions,
    _lowering: LocationLowering,
  ): readonly StateVarDecl[] => [],
  harness: {
    setup: () => ({}),
    observe: () => "unobservable",
    navigate: () => undefined,
  },
};

void _navigationAdapterFixture;
