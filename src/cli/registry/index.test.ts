import { describe, expect, it } from "vitest";
import type {
  EffectApiProvider,
  LocationLowering,
  ModuleRoleAdapter,
  NavigationAdapter,
  ResolvedOptions,
  RouteDiscoveryCtx,
  RouteInventory,
  StateVarDecl,
} from "modality-ts/extract/engine/spi";
import {
  createBuiltinModalityRegistry,
  createModalityRegistry,
} from "./index.js";

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

function fakeModuleRoleAdapter(
  overrides: Partial<ModuleRoleAdapter> = {},
): ModuleRoleAdapter {
  return {
    id: "fake-module-roles",
    kind: "module-roles",
    packageNames: ["fake"],
    classifyModule: () => ({ defaultContext: "unknown" }),
    moduleEntryExports: () => [],
    classifyImportEdge: (ctx) => (ctx.isTypeOnly ? "type" : "unknown"),
    isServerOnlyModule: () => false,
    ...overrides,
  };
}

function fakeEffectApiProvider(
  overrides: Partial<EffectApiProvider> = {},
): EffectApiProvider {
  return {
    id: "fake-effect-api",
    kind: "effect-api",
    packageNames: ["fake"],
    discoverEffectApis: () => [],
    ...overrides,
  };
}

describe("validateModuleRoleAdapter", () => {
  it("accepts a complete ModuleRoleAdapter", () => {
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        moduleRoleAdapters: [fakeModuleRoleAdapter()],
      }),
    ).not.toThrow();
  });

  it("rejects adapters missing classifyModule", () => {
    const { classifyModule: _, ...incomplete } = fakeModuleRoleAdapter();
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        moduleRoleAdapters: [incomplete as ModuleRoleAdapter],
      }),
    ).toThrow(
      "Invalid module-role adapter fake-module-roles: classifyModule must be a function",
    );
  });
});

describe("validateEffectApiProvider", () => {
  it("accepts a complete EffectApiProvider", () => {
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        effectApiProviders: [fakeEffectApiProvider()],
      }),
    ).not.toThrow();
  });

  it("rejects providers missing discoverEffectApis", () => {
    const { discoverEffectApis: _, ...incomplete } = fakeEffectApiProvider();
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        effectApiProviders: [incomplete as EffectApiProvider],
      }),
    ).toThrow(
      "Invalid effect API provider fake-effect-api: discoverEffectApis must be a function",
    );
  });
});

describe("builtin module-role and effect API registration", () => {
  it("registers Next navigation, module-role, and effect API providers", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { next: "^15.0.0" },
    });
    expect(registry.routerPluginId).toBe("next");
    expect(registry.adapters.navigation?.id).toBe("next");
    expect(registry.adapters.moduleRoles.map((adapter) => adapter.id)).toEqual([
      "next-module-roles",
    ]);
    expect(registry.adapters.effectApis.map((provider) => provider.id)).toEqual(
      ["next-effect-api"],
    );
  });

  it("registers React Router navigation, module-role, and effect API providers", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { "react-router-dom": "^6.0.0" },
    });
    expect(registry.routerPluginId).toBe("router");
    expect(registry.adapters.moduleRoles.map((adapter) => adapter.id)).toEqual([
      "router-module-roles",
    ]);
    expect(registry.adapters.effectApis.map((provider) => provider.id)).toEqual([
      "router-effect-api",
    ]);
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
