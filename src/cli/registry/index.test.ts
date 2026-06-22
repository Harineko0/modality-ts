import type {
  CacheStorageProvider,
  EffectApiProvider,
  EffectPlugin,
  FrameworkPlugin,
  LocationLowering,
  ModuleRolePlugin,
  ResolvedOptions,
  RouteDiscoveryCtx,
  RouteInventory,
  RoutePlugin,
  StateVarDecl,
} from "modality-ts/extract/engine/spi";
import { reactFramework } from "modality-ts/extract/frameworks/react";
import { jotaiSource } from "modality-ts/extract/sources/jotai";
import { reactRouterAdapter } from "modality-ts/extract/sources/router";
import { useStateSource } from "modality-ts/extract/sources/use-state";
import { describe, expect, it } from "vitest";
import {
  createBuiltinModalityRegistry,
  createModalityRegistry,
} from "./index.js";

function fakeRoutePlugin(overrides: Partial<RoutePlugin> = {}): RoutePlugin {
  return {
    id: "fake-router",
    version: "0.0.1",
    packageNames: ["fake-router"],
    kind: "route",
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

describe("validateRoutePlugin", () => {
  it("accepts a RoutePlugin with the required methods", () => {
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
        routePlugin: fakeRoutePlugin(),
      }),
    ).not.toThrow();
  });

  it("rejects adapters missing discoverRoutes", () => {
    const { discoverRoutes: _, ...incomplete } = fakeRoutePlugin();
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
        routePlugin: incomplete as RoutePlugin,
      }),
    ).toThrow(
      "Invalid route plugin fake-router: discoverRoutes must be a function",
    );
  });

  it("rejects adapters missing classifyNavigationCall", () => {
    const { classifyNavigationCall: _, ...incomplete } = fakeRoutePlugin();
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
        routePlugin: incomplete as RoutePlugin,
      }),
    ).toThrow(
      "Invalid route plugin fake-router: classifyNavigationCall must be a function",
    );
  });

  it("rejects adapters missing locationVars", () => {
    const { locationVars: _, ...incomplete } = fakeRoutePlugin();
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
        routePlugin: incomplete as RoutePlugin,
      }),
    ).toThrow(
      "Invalid route plugin fake-router: locationVars must be a function",
    );
  });

  it("rejects adapters missing harness.navigate", () => {
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
        routePlugin: fakeRoutePlugin({
          harness: {
            setup: () => ({}),
            observe: () => "unobservable",
          },
        }),
      }),
    ).toThrow(
      "Invalid route plugin fake-router: harness.setup, harness.observe, and harness.navigate are required",
    );
  });

  it("rejects legacy-only router plugins without RoutePlugin methods", () => {
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
        routePlugin: {
          id: "legacy-router",
          kind: "route",
          packageNames: ["react-router"],
          harness: {
            setup: () => ({}),
            observe: () => "unobservable",
            navigate: () => undefined,
          },
        } as RoutePlugin,
      }),
    ).toThrow(
      "Invalid route plugin legacy-router: discoverRoutes must be a function",
    );
  });
});

function fakeModuleRolePlugin(
  overrides: Partial<ModuleRolePlugin> = {},
): ModuleRolePlugin {
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

describe("validateModuleRolePlugin", () => {
  it("accepts a complete ModuleRolePlugin", () => {
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
        moduleRoleAdapters: [fakeModuleRolePlugin()],
      }),
    ).not.toThrow();
  });

  it("rejects adapters missing classifyModule", () => {
    const { classifyModule: _, ...incomplete } = fakeModuleRolePlugin();
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
        moduleRoleAdapters: [incomplete as ModuleRolePlugin],
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
        statePlugins: [],
        effectApiProviders: [fakeEffectApiProvider()],
      }),
    ).not.toThrow();
  });

  it("rejects providers missing discoverEffectApis", () => {
    const { discoverEffectApis: _, ...incomplete } = fakeEffectApiProvider();
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
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
        statePlugins: [],
        cacheStorageProviders: [fakeCacheStorageProvider()],
      }),
    ).not.toThrow();
  });

  it("rejects providers missing discoverCacheStorage", () => {
    const { discoverCacheStorage: _, ...incomplete } =
      fakeCacheStorageProvider();
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
        cacheStorageProviders: [incomplete as CacheStorageProvider],
      }),
    ).toThrow(
      "Invalid cache/storage provider fake-cache-storage: discoverCacheStorage must be a function",
    );
  });

  it("rejects providers with the wrong kind", () => {
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
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
    ).toEqual(
      expect.arrayContaining([
        "use-state",
        "jotai",
        "swr",
        "zustand",
        "tanstack-query",
        "redux",
      ]),
    );
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
        statePlugins: [
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
    expect(registry.routePluginId).toBe("next");
    expect(registry.adapters.navigation?.id).toBe("next");
    expect(registry.adapters.moduleRoles.map((adapter) => adapter.id)).toEqual([
      "next-module-roles",
    ]);
    expect(registry.adapters.effectApis.map((provider) => provider.id)).toEqual(
      ["next-effect-api"],
    );
    expect(
      registry.adapters.routeExecution.map((provider) => provider.id),
    ).toEqual(["next-route-execution"]);
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
    expect(registry.routePluginId).toBe("router");
    expect(registry.adapters.moduleRoles.map((adapter) => adapter.id)).toEqual([
      "router-module-roles",
    ]);
    expect(registry.adapters.effectApis.map((provider) => provider.id)).toEqual(
      ["router-effect-api"],
    );
    expect(
      registry.adapters.routeExecution.map((provider) => provider.id),
    ).toEqual(["router-route-execution"]);
    expect(registry.plugins.map((plugin) => plugin.kind).sort()).toEqual(
      expect.arrayContaining([
        "route",
        "module-roles",
        "effect-api",
        "route-execution",
      ]),
    );
    expect(
      registry.plugins.some(
        (plugin) => plugin.kind === "route" && plugin.id === "router",
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
    expect(registry.routePluginId).toBe("tanstack-router");
    expect(registry.adapters.navigation?.id).toBe("tanstack-router");
    expect(registry.adapters.moduleRoles.map((adapter) => adapter.id)).toEqual([
      "tanstack-module-roles",
    ]);
    expect(registry.adapters.effectApis.map((provider) => provider.id)).toEqual(
      ["tanstack-effect-api"],
    );
    expect(
      registry.adapters.routeExecution.map((provider) => provider.id),
    ).toEqual(["tanstack-route-execution"]);
    expect(
      registry.adapters.cacheStorage.map((provider) => provider.id),
    ).toEqual(["tanstack-cache-storage"]);
    expect(
      registry.plugins.some(
        (plugin) => plugin.kind === "route" && plugin.id === "tanstack-router",
      ),
    ).toBe(true);
    expect(
      registry.plugins.some(
        (plugin) =>
          plugin.kind === "module-roles" &&
          plugin.id === "tanstack-module-roles",
      ),
    ).toBe(true);
    expect(
      registry.plugins.some(
        (plugin) =>
          plugin.kind === "effect-api" && plugin.id === "tanstack-effect-api",
      ),
    ).toBe(true);
    expect(
      registry.plugins.some(
        (plugin) =>
          plugin.kind === "cache-storage" &&
          plugin.id === "tanstack-cache-storage",
      ),
    ).toBe(true);
    expect(
      registry.adapters.observations.some(
        (provider) => provider.id === "tanstack-router-observation",
      ),
    ).toBe(true);
  });

  it("omits TanStack Router when tanstack-router is disabled", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { "@tanstack/react-router": "^1.0.0" },
      disabledPlugins: ["tanstack-router"],
    });
    expect(registry.routePluginId).toBeUndefined();
    expect(registry.adapters.moduleRoles).toEqual([]);
    expect(registry.adapters.effectApis).toEqual([]);
    expect(registry.adapters.cacheStorage).toEqual([]);
    expect(
      registry.plugins.some((plugin) => plugin.id.startsWith("tanstack")),
    ).toBe(false);
  });

  it("prefers Next over TanStack Router when both dependencies exist", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: {
        next: "^15.0.0",
        "@tanstack/react-router": "^1.0.0",
      },
    });
    expect(registry.routePluginId).toBe("next");
  });

  it("still activates React Router when only react-router-dom is present", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { "react-router-dom": "^6.0.0" },
    });
    expect(registry.routePluginId).toBe("router");
  });
});

// Type-level fixture: a complete adapter literal must satisfy RoutePlugin.
const _navigationAdapterFixture: RoutePlugin = {
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

describe("framework plugin registration", () => {
  function fakeFramework(
    overrides: Partial<FrameworkPlugin> = {},
  ): FrameworkPlugin {
    return {
      id: "fake-framework",
      version: "0.0.1",
      packageNames: ["fake-framework"],
      recognizeHook: () => undefined,
      recognizeRenderBoundary: () => undefined,
      ...overrides,
    };
  }

  it("registers and validates the default react framework", () => {
    const registry = createBuiltinModalityRegistry();
    expect(registry.frameworkPluginId).toBe("react");
    expect(registry.framework?.id).toBe("react");
    expect(
      registry.plugins.some(
        (plugin) => plugin.kind === "framework" && plugin.id === "react",
      ),
    ).toBe(true);
  });

  it("stamps framework provenance in stable kind/id order", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: { "react-router-dom": "^6.0.0" },
    });
    const kinds = registry.plugins.map(
      (plugin) => `${plugin.kind}:${plugin.id}`,
    );
    const frameworkIndex = kinds.indexOf("framework:react");
    const navigationIndex = kinds.indexOf("route:router");
    expect(frameworkIndex).toBeGreaterThanOrEqual(0);
    expect(navigationIndex).toBeGreaterThanOrEqual(0);
    expect(frameworkIndex).toBeLessThan(navigationIndex);
  });

  it("accepts explicit config.framework override", () => {
    const custom = fakeFramework({ id: "custom-react" });
    const registry = createBuiltinModalityRegistry({ framework: custom });
    expect(registry.frameworkPluginId).toBe("custom-react");
    expect(registry.framework).toBe(custom);
    expect(
      registry.plugins.some(
        (plugin) => plugin.kind === "framework" && plugin.id === "custom-react",
      ),
    ).toBe(true);
  });

  it("rejects invalid framework plugins missing recognizeHook", () => {
    const { recognizeHook: _, ...incomplete } = fakeFramework();
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
        framework: incomplete as FrameworkPlugin,
      }),
    ).toThrow(
      "Invalid framework plugin fake-framework: recognizeHook must be a function",
    );
  });

  it("rejects invalid framework plugins missing recognizeRenderBoundary", () => {
    const { recognizeRenderBoundary: _, ...incomplete } = fakeFramework();
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
        framework: incomplete as FrameworkPlugin,
      }),
    ).toThrow(
      "Invalid framework plugin fake-framework: recognizeRenderBoundary must be a function",
    );
  });

  it("defaults to reactFramework when config omits framework", () => {
    const registry = createBuiltinModalityRegistry({
      dependencies: {},
    });
    expect(registry.framework?.id).toBe("react");
    expect(registry.framework).not.toBe(reactFramework());
    expect(registry.framework?.packageNames).toEqual(
      reactFramework().packageNames,
    );
  });
});

describe("effect-model provider registration", () => {
  function fakeEffectModel(
    overrides: Partial<EffectPlugin> = {},
  ): EffectPlugin {
    return {
      id: "fake-effect-model",
      version: "0.0.1",
      packageNames: [],
      kind: "effect",
      recognizeEffect: () => undefined,
      ...overrides,
    };
  }

  it("registers built-in timer and websocket providers by default", () => {
    const registry = createBuiltinModalityRegistry();
    expect(registry.effectPluginIds).toEqual(["timers", "websocket"]);
    expect(
      registry.plugins.some(
        (plugin) => plugin.kind === "effect" && plugin.id === "timers",
      ),
    ).toBe(true);
    expect(
      registry.plugins.some(
        (plugin) => plugin.kind === "effect" && plugin.id === "websocket",
      ),
    ).toBe(true);
  });

  it("accepts explicit config.effectModels override", () => {
    const custom = fakeEffectModel({ id: "custom-timers" });
    const registry = createBuiltinModalityRegistry({ effectModels: [custom] });
    expect(registry.effectPluginIds).toEqual(["custom-timers"]);
    expect(registry.effectPlugins).toEqual([custom]);
  });

  it("exercises router recognizeFormSubmit on explicit routePlugin", () => {
    const router = reactRouterAdapter();
    expect(router.recognizeFormSubmit).toBeTypeOf("function");
    expect(router.recognizeUseSubmitHandler).toBeTypeOf("function");
    const registry = createBuiltinModalityRegistry({ routePlugin: router });
    expect(registry.routePlugin?.recognizeFormSubmit).toBe(
      router.recognizeFormSubmit,
    );
  });

  it("rejects invalid effect-model providers missing recognizeEffect", () => {
    const { recognizeEffect: _, ...incomplete } = fakeEffectModel();
    expect(() =>
      createModalityRegistry({
        statePlugins: [],
        effectPlugins: [incomplete as EffectPlugin],
      }),
    ).toThrow(
      "Invalid effect plugin fake-effect-model: recognizeEffect must be a function",
    );
  });
});

describe("statePluginsOverride", () => {
  it("suppresses auto-detected built-ins when non-empty", () => {
    const override = [useStateSource(), jotaiSource()];
    const registry = createBuiltinModalityRegistry({
      dependencies: { react: "^19.0.0", jotai: "^2.0.0", swr: "^2.0.0" },
      statePluginsOverride: override,
    });
    expect(registry.statePluginIds).toEqual(["jotai", "use-state"]);
    expect(registry.statePlugins.map((plugin) => plugin.id)).toEqual([
      "use-state",
      "jotai",
    ]);
  });

  it("merges CLI extras with override ids", () => {
    const extra = {
      id: "custom-extra",
      packageNames: ["custom-extra"],
      discover: () => [],
      writeChannels: () => [],
      harness: {
        setup: () => ({}),
        observe: () => "unobservable",
      },
    };
    const registry = createBuiltinModalityRegistry({
      dependencies: { react: "^19.0.0", swr: "^2.0.0" },
      statePluginsOverride: [useStateSource()],
      extraSourcePlugins: [extra],
    });
    expect(registry.statePluginIds.sort()).toEqual([
      "custom-extra",
      "use-state",
    ]);
  });

  it("preserves auto-detection when override is omitted or empty", () => {
    const withDeps = createBuiltinModalityRegistry({
      dependencies: { react: "^19.0.0", jotai: "^2.0.0" },
    });
    expect(withDeps.statePluginIds).toEqual(
      expect.arrayContaining(["use-state", "jotai"]),
    );

    const emptyOverride = createBuiltinModalityRegistry({
      dependencies: { react: "^19.0.0", jotai: "^2.0.0" },
      statePluginsOverride: [],
    });
    expect(emptyOverride.statePluginIds).toEqual(
      expect.arrayContaining(["use-state", "jotai"]),
    );
  });

  it("rejects duplicate ids between override and CLI extras", () => {
    expect(() =>
      createBuiltinModalityRegistry({
        statePluginsOverride: [useStateSource()],
        extraSourcePlugins: [useStateSource()],
      }),
    ).toThrow("Duplicate source plugin use-state");
  });

  it("matches auto-detection source ids for equivalent deps", () => {
    const dependencies = { react: "^19.0.0", jotai: "^2.0.0" };
    const autoDetected = createBuiltinModalityRegistry({ dependencies });
    const overridden = createBuiltinModalityRegistry({
      dependencies,
      statePluginsOverride: [useStateSource(), jotaiSource()],
    });
    expect(new Set(overridden.statePluginIds)).toEqual(
      new Set(
        autoDetected.statePluginIds.filter((id) =>
          ["use-state", "jotai"].includes(id),
        ),
      ),
    );
  });
});
