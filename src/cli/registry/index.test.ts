import { describe, expect, it } from "vitest";
import type {
  CacheStorageProvider,
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

describe("validateNavigationAdapter", () => {
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
      "Invalid navigation adapter fake-router: discoverRoutes must be a function",
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
      "Invalid navigation adapter fake-router: classifyNavigationCall must be a function",
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
      "Invalid navigation adapter fake-router: locationVars must be a function",
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
      "Invalid navigation adapter fake-router: harness.setup, harness.observe, and harness.navigate are required",
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
      "Invalid navigation adapter legacy-router: discoverRoutes must be a function",
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

function fakeCacheStorageProvider(
  overrides: Partial<CacheStorageProvider> = {},
): CacheStorageProvider {
  return {
    id: "fake-cache-storage",
    kind: "cache-storage",
    packageNames: ["fake"],
    discoverCacheStorage: () => ({
      vars: [],
      transitions: [],
      caveats: [],
    }),
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

describe("validateCacheStorageProvider", () => {
  it("accepts a complete CacheStorageProvider", () => {
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        cacheStorageProviders: [fakeCacheStorageProvider()],
      }),
    ).not.toThrow();
  });

  it("rejects providers missing discoverCacheStorage", () => {
    const { discoverCacheStorage: _, ...incomplete } =
      fakeCacheStorageProvider();
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        cacheStorageProviders: [incomplete as CacheStorageProvider],
      }),
    ).toThrow(
      "Invalid cache/storage provider fake-cache-storage: discoverCacheStorage must be a function",
    );
  });

  it("rejects providers with the wrong kind", () => {
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [],
        cacheStorageProviders: [
          fakeCacheStorageProvider({
            kind: "effect-api" as CacheStorageProvider["kind"],
          }),
        ],
      }),
    ).toThrow(
      'Invalid cache/storage provider fake-cache-storage: kind must be "cache-storage"',
    );
  });
});

describe("observation providers", () => {
  it("wraps active state source plugins as observation providers", () => {
    const registry = createBuiltinModalityRegistry();
    expect(
      registry.adapters.observations.map((provider) => provider.id),
    ).toEqual(expect.arrayContaining(["use-state", "jotai", "swr", "zustand"]));
    expect(
      registry.plugins.some(
        (plugin) => plugin.kind === "observation" && plugin.id === "jotai",
      ),
    ).toBe(true);
  });

  it("wraps active navigation as an observation provider", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { "react-router-dom": "^6.0.0" },
    });
    expect(
      registry.adapters.observations.some(
        (provider) => provider.id === "router-observation",
      ),
    ).toBe(true);
    expect(
      registry.plugins.some(
        (plugin) =>
          plugin.kind === "observation" && plugin.id === "router-observation",
      ),
    ).toBe(true);
  });

  it("rejects invalid observation provider shape", () => {
    expect(() =>
      createModalityRegistry({
        sourcePlugins: [
          {
            id: "broken",
            packageNames: ["broken"],
            discover: () => [],
            writeChannels: () => [],
            harness: {
              setup: () => ({}),
              observe: undefined as never,
            },
          },
        ],
      }),
    ).toThrow(
      "Invalid source plugin broken: harness.setup and harness.observe are required",
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
    expect(
      registry.adapters.cacheStorage.map((provider) => provider.id),
    ).toEqual(["next-cache-storage"]);
    expect(
      registry.plugins.some(
        (plugin) =>
          plugin.kind === "cache-storage" && plugin.id === "next-cache-storage",
      ),
    ).toBe(true);
  });

  it("omits Next cache/storage provider when Next is disabled", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { next: "^15.0.0" },
      disabledPlugins: ["next"],
    });
    expect(registry.adapters.cacheStorage).toEqual([]);
  });

  it("omits Next cache/storage provider without a Next dependency", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { "react-router-dom": "^6.0.0" },
    });
    expect(registry.adapters.cacheStorage).toEqual([]);
  });

  it("registers React Router navigation, module-role, and effect API providers", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { "react-router-dom": "^6.0.0" },
    });
    expect(registry.routerPluginId).toBe("router");
    expect(registry.adapters.moduleRoles.map((adapter) => adapter.id)).toEqual([
      "router-module-roles",
    ]);
    expect(registry.adapters.effectApis.map((provider) => provider.id)).toEqual(
      ["router-effect-api"],
    );
    expect(registry.plugins.map((plugin) => plugin.kind).sort()).toEqual(
      expect.arrayContaining(["navigation", "module-roles", "effect-api"]),
    );
    expect(
      registry.plugins.some(
        (plugin) => plugin.kind === "navigation" && plugin.id === "router",
      ),
    ).toBe(true);
    expect(
      registry.plugins.some(
        (plugin) =>
          plugin.kind === "module-roles" && plugin.id === "router-module-roles",
      ),
    ).toBe(true);
    expect(
      registry.plugins.some(
        (plugin) =>
          plugin.kind === "effect-api" && plugin.id === "router-effect-api",
      ),
    ).toBe(true);
    expect(registry.plugins.every((plugin) => plugin.kind !== "router")).toBe(
      true,
    );
  });

  it("registers TanStack Router when @tanstack/react-router is present", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { "@tanstack/react-router": "^1.0.0" },
    });
    expect(registry.routerPluginId).toBe("tanstack-router");
    expect(registry.adapters.navigation?.id).toBe("tanstack-router");
    expect(
      registry.plugins.some(
        (plugin) =>
          plugin.kind === "navigation" && plugin.id === "tanstack-router",
      ),
    ).toBe(true);
  });

  it("prefers Next over TanStack Router when both dependencies exist", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: {
        next: "^15.0.0",
        "@tanstack/react-router": "^1.0.0",
      },
    });
    expect(registry.routerPluginId).toBe("next");
  });

  it("omits TanStack Router when tanstack-router is disabled", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { "@tanstack/react-router": "^1.0.0" },
      disabledPlugins: ["tanstack-router"],
    });
    expect(registry.routerPluginId).toBeUndefined();
  });

  it("still activates React Router when only react-router-dom is present", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { "react-router-dom": "^6.0.0" },
    });
    expect(registry.routerPluginId).toBe("router");
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
