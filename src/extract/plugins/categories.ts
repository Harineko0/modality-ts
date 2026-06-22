import type {
  CacheStorageProvider,
  EffectApiProvider,
  EffectPlugin,
  FrameworkPlugin,
  ModuleRolePlugin,
  ObservationPlugin,
  RouteExecutionPlugin,
  RoutePlugin,
  StateSourcePlugin,
  TypePlugin,
} from "../engine/spi/index.js";
import { createPlugin, rejectUnknownKeys } from "./create-plugin.js";
import {
  validateCacheStoragePlugin,
  validateEffectApiPlugin,
  validateEffectPlugin,
  validateFrameworkPlugin,
  validateModuleRolePlugin,
  validateObservationPlugin,
  validateRouteExecutionPlugin,
  validateRoutePlugin,
  validateStateSourcePlugin,
  validateTypePlugin,
} from "./plugin-validators.js";

const STATE_SOURCE_KEYS = [
  "id",
  "kind",
  "version",
  "packageNames",
  "discover",
  "domainHints",
  "decodeBinding",
  "writeChannels",
  "safetyWarnings",
  "extract",
  "summarizeWrite",
  "template",
  "harness",
  "conformance",
] as const;

export function createStateSourcePlugin(
  config: Omit<StateSourcePlugin, "kind" | "packageNames"> & {
    packageNames: readonly string[];
  },
): StateSourcePlugin {
  rejectUnknownKeys(
    config as Record<string, unknown>,
    STATE_SOURCE_KEYS,
    config.id,
    "state-source",
  );
  const plugin = createPlugin({ ...config, kind: "state-source" as const });
  validateStateSourcePlugin(plugin);
  return plugin;
}

const FRAMEWORK_KEYS = [
  "id",
  "kind",
  "version",
  "packageNames",
  "recognizeHook",
  "recognizeRenderBoundary",
  "classifyComponent",
  "unwrapHandler",
] as const;

export function createFrameworkPlugin(
  config: Omit<FrameworkPlugin, "kind" | "packageNames"> & {
    packageNames: readonly string[];
  },
): FrameworkPlugin {
  rejectUnknownKeys(
    config as Record<string, unknown>,
    FRAMEWORK_KEYS,
    config.id,
    "framework",
  );
  const plugin = createPlugin({ ...config, kind: "framework" as const });
  validateFrameworkPlugin(plugin);
  return plugin;
}

const ROUTE_KEYS = [
  "id",
  "kind",
  "version",
  "packageNames",
  "discoverRoutes",
  "classifyNavigationCall",
  "classifyNavigationJsx",
  "routeForComponent",
  "locationVars",
  "routeTreeVars",
  "lowerNavigation",
  "mountScopeForComponent",
  "recognizeFormSubmit",
  "recognizeUseSubmitHandler",
  "harness",
] as const;

export function createRoutePlugin(
  config: Omit<RoutePlugin, "kind" | "packageNames"> & {
    packageNames: readonly string[];
  },
): RoutePlugin {
  rejectUnknownKeys(
    config as Record<string, unknown>,
    ROUTE_KEYS,
    config.id,
    "route",
  );
  const plugin = createPlugin({ ...config, kind: "route" as const });
  validateRoutePlugin(plugin);
  return plugin;
}

const TYPE_KEYS = [
  "id",
  "kind",
  "version",
  "packageNames",
  "refineDomain",
] as const;

export function createTypePlugin(
  config: Omit<TypePlugin, "kind" | "packageNames"> & {
    packageNames: readonly string[];
  },
): TypePlugin {
  rejectUnknownKeys(
    config as Record<string, unknown>,
    TYPE_KEYS,
    config.id,
    "type",
  );
  const plugin = createPlugin({ ...config, kind: "type" as const });
  validateTypePlugin(plugin);
  return plugin;
}

const EFFECT_KEYS = [
  "id",
  "kind",
  "version",
  "packageNames",
  "recognizeEffect",
  "recognizeEffectAssignment",
] as const;

export function createEffectPlugin(
  config: Omit<EffectPlugin, "kind" | "packageNames"> & {
    packageNames: readonly string[];
  },
): EffectPlugin {
  rejectUnknownKeys(
    config as Record<string, unknown>,
    EFFECT_KEYS,
    config.id,
    "effect",
  );
  const plugin = createPlugin({ ...config, kind: "effect" as const });
  validateEffectPlugin(plugin);
  return plugin;
}

const MODULE_ROLE_KEYS = [
  "id",
  "kind",
  "version",
  "packageNames",
  "classifyModule",
  "moduleEntryExports",
  "classifyImportEdge",
  "isServerOnlyModule",
  "shouldDiscoverEffectApis",
] as const;

export function createModulePlugin(
  config: Omit<ModuleRolePlugin, "kind" | "packageNames"> & {
    packageNames: readonly string[];
  },
): ModuleRolePlugin {
  rejectUnknownKeys(
    config as Record<string, unknown>,
    MODULE_ROLE_KEYS,
    config.id,
    "module-roles",
  );
  const plugin = createPlugin({ ...config, kind: "module-roles" as const });
  validateModuleRolePlugin(plugin);
  return plugin;
}

const CACHE_KEYS = [
  "id",
  "kind",
  "version",
  "packageNames",
  "discoverCacheStorage",
] as const;

export function createCachePlugin(
  config: Omit<CacheStorageProvider, "kind" | "packageNames"> & {
    packageNames: readonly string[];
  },
): CacheStorageProvider {
  rejectUnknownKeys(
    config as Record<string, unknown>,
    CACHE_KEYS,
    config.id,
    "cache-storage",
  );
  const plugin = createPlugin({ ...config, kind: "cache-storage" as const });
  validateCacheStoragePlugin(plugin);
  return plugin;
}

const OBSERVATION_KEYS = [
  "id",
  "kind",
  "version",
  "packageNames",
  "setup",
  "observe",
  "witness",
] as const;

export function createObservationPlugin(
  config: Omit<ObservationPlugin, "kind" | "packageNames"> & {
    packageNames: readonly string[];
  },
): ObservationPlugin {
  rejectUnknownKeys(
    config as Record<string, unknown>,
    OBSERVATION_KEYS,
    config.id,
    "observation",
  );
  const plugin = createPlugin({ ...config, kind: "observation" as const });
  validateObservationPlugin(plugin);
  return plugin;
}

const ROUTE_EXECUTION_KEYS = [
  "id",
  "kind",
  "version",
  "packageNames",
  "describeRouteExecution",
] as const;

export function createRouteExecutionPlugin(
  config: Omit<RouteExecutionPlugin, "kind" | "packageNames"> & {
    packageNames: readonly string[];
  },
): RouteExecutionPlugin {
  rejectUnknownKeys(
    config as Record<string, unknown>,
    ROUTE_EXECUTION_KEYS,
    config.id,
    "route-execution",
  );
  const plugin = createPlugin({ ...config, kind: "route-execution" as const });
  validateRouteExecutionPlugin(plugin);
  return plugin;
}

const EFFECT_API_KEYS = [
  "id",
  "kind",
  "version",
  "packageNames",
  "discoverEffectApis",
] as const;

export function createEffectApiPlugin(
  config: Omit<EffectApiProvider, "kind" | "packageNames"> & {
    packageNames: readonly string[];
  },
): EffectApiProvider {
  rejectUnknownKeys(
    config as Record<string, unknown>,
    EFFECT_API_KEYS,
    config.id,
    "effect-api",
  );
  const plugin = createPlugin({ ...config, kind: "effect-api" as const });
  validateEffectApiPlugin(plugin);
  return plugin;
}
