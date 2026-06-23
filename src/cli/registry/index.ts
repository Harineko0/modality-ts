import {
  type ObservationSource,
  observationSource,
} from "modality-ts/cli/harness";
import type { PluginProvenance } from "modality-ts/core";
import { timerEffectPlugin } from "modality-ts/extract/plugins/effect/timers";
import { websocketEffectPlugin } from "modality-ts/extract/plugins/effect/websocket";
import type {
  CacheStorageProvider,
  EffectApiProvider,
  EffectPlugin,
  FrameworkPlugin,
  HarnessCtx,
  HarnessHooks,
  ModuleRolePlugin,
  ObservationPlugin,
  ObservedRead,
  RouteExecutionPlugin,
  RoutePlugin,
  StateSourcePlugin,
  TypePlugin,
} from "modality-ts/extract/engine/spi";
import { registerEffectPlugins } from "modality-ts/extract/engine/spi";
import { reactFramework } from "modality-ts/extract/plugins/framework/react";
import { jotaiSource } from "modality-ts/extract/plugins/state/jotai";
import {
  nextAdapter,
  nextCacheStorageProvider,
  nextEffectApiProvider,
  nextModuleRolePlugin,
  nextRouteExecutionPlugin,
} from "modality-ts/extract/plugins/route/next";
import { reduxSource } from "modality-ts/extract/plugins/state/redux";
import {
  reactRouterAdapter,
  reactRouterEffectApiProvider,
  reactRouterModuleRolePlugin,
  reactRouterRouteExecutionPlugin,
} from "modality-ts/extract/plugins/route/router";
import { swrSource } from "modality-ts/extract/plugins/state/swr";
import { tanstackQuerySource } from "modality-ts/extract/plugins/state/tanstack-query";
import {
  tanstackRouterAdapter,
  tanstackRouterCacheStorageProvider,
  tanstackRouterEffectApiProvider,
  tanstackRouterModuleRolePlugin,
  tanstackRouterRouteExecutionPlugin,
} from "modality-ts/extract/plugins/route/tanstack-router";
import { useStateSource } from "modality-ts/extract/plugins/state/use-state";
import { zustandSource } from "modality-ts/extract/plugins/state/zustand";
import { arktypeTypePlugin } from "modality-ts/extract/plugins/type/arktype";
import { zodTypePlugin } from "modality-ts/extract/plugins/type/zod";
import { extendFrameworkWithTsUnwrap } from "../../extract/engine/ts/framework-ts-bridge.js";
import { extendReactFrameworkWithTsFacets } from "../../extract/plugins/framework/react/ts-facets.js";
import { unwrapReactHookFormHandler } from "../../extract/plugins/framework/react-hook-form/unwrap.js";

export interface RegistryAdaptersBundle {
  navigation?: RoutePlugin;
  moduleRoles: readonly ModuleRolePlugin[];
  effectApis: readonly EffectApiProvider[];
  routeExecution: readonly RouteExecutionPlugin[];
  cacheStorage: readonly CacheStorageProvider[];
  stateSources: readonly StateSourcePlugin[];
  typePlugins: readonly TypePlugin[];
  observations: readonly ObservationPlugin[];
}

export interface ModalityPluginRegistry {
  statePlugins: readonly StateSourcePlugin[];
  routePlugin?: RoutePlugin;
  framework?: FrameworkPlugin;
  effectPlugins?: readonly EffectPlugin[];
  typePlugins: readonly TypePlugin[];
  moduleRoleAdapters?: readonly ModuleRolePlugin[];
  effectApiProviders?: readonly EffectApiProvider[];
  routeExecutionProviders?: readonly RouteExecutionPlugin[];
  cacheStorageProviders?: readonly CacheStorageProvider[];
}

export interface BuiltinRegistryOptions {
  dependencies?: Readonly<Record<string, string>>;
  disabledPlugins?: readonly string[];
  /** Explicit config plugin list; suppresses built-in auto-detection when non-empty. */
  statePluginsOverride?: readonly StateSourcePlugin[];
  extraSourcePlugins?: readonly StateSourcePlugin[];
  extraTypePlugins?: readonly TypePlugin[];
  extraCacheStorageProviders?: readonly CacheStorageProvider[];
  routePlugin?: RoutePlugin | false;
  framework?: FrameworkPlugin | false;
  effectPlugins?: readonly EffectPlugin[];
}

export interface RegistrySummary {
  statePluginIds: readonly string[];
  routePluginId?: string;
  frameworkPluginId?: string;
  effectPluginIds: readonly string[];
  statePlugins: readonly StateSourcePlugin[];
  routePlugin?: RoutePlugin;
  framework?: FrameworkPlugin;
  effectPlugins: readonly EffectPlugin[];
  typePlugins: readonly TypePlugin[];
  plugins: readonly PluginProvenance[];
  adapters: RegistryAdaptersBundle;
}

export function createBuiltinModalityRegistry(
  options: BuiltinRegistryOptions = {},
): RegistrySummary {
  const dependencies = options.dependencies;
  const disabled = new Set(options.disabledPlugins ?? []);
  const builtins = [
    useStateSource(),
    jotaiSource(),
    swrSource(),
    zustandSource(),
    tanstackQuerySource(),
    reduxSource(),
  ];
  const statePlugins = options.statePluginsOverride?.length
    ? [...options.statePluginsOverride, ...(options.extraSourcePlugins ?? [])]
    : [
        ...builtins.filter(
          (plugin) =>
            !disabled.has(plugin.id) &&
            shouldEnableBuiltin(plugin, dependencies),
        ),
        ...(options.extraSourcePlugins ?? []),
      ];
  const domainRefinementBuiltins = [zodTypePlugin(), arktypeTypePlugin()];
  const typePlugins = [
    ...domainRefinementBuiltins.filter(
      (provider) =>
        !disabled.has(provider.id) &&
        shouldEnableBuiltin(provider, dependencies),
    ),
    ...(options.extraTypePlugins ?? []),
  ];
  const builtinNavigation = resolveBuiltinNavigationBundle(options, disabled);
  const cacheStorageProviders = resolveBuiltinCacheStorageProviders(
    options,
    disabled,
  );
  const effectPlugins = resolveBuiltinEffectModels(options);
  registerEffectPlugins(effectPlugins);
  return createModalityRegistry({
    statePlugins,
    routePlugin: builtinNavigation.navigation,
    framework: resolveBuiltinFramework(options),
    effectPlugins,
    typePlugins,
    moduleRoleAdapters: builtinNavigation.moduleRoles,
    effectApiProviders: builtinNavigation.effectApis,
    routeExecutionProviders: builtinNavigation.routeExecution,
    cacheStorageProviders,
  });
}

function resolveBuiltinNavigationBundle(
  options: BuiltinRegistryOptions,
  disabled: Set<string>,
): {
  navigation?: RoutePlugin;
  moduleRoles: ModuleRolePlugin[];
  effectApis: EffectApiProvider[];
  routeExecution: RouteExecutionPlugin[];
} {
  if (options.routePlugin === false) {
    return { moduleRoles: [], effectApis: [], routeExecution: [] };
  }
  if (options.routePlugin) {
    return {
      navigation: options.routePlugin,
      moduleRoles: [],
      effectApis: [],
      routeExecution: [],
    };
  }

  const dependencies = options.dependencies;
  if (!disabled.has("next") && hasDependency(dependencies, "next")) {
    return {
      navigation: nextAdapter(),
      moduleRoles: [nextModuleRolePlugin()],
      effectApis: [nextEffectApiProvider()],
      routeExecution: [nextRouteExecutionPlugin()],
    };
  }
  if (
    !disabled.has("tanstack-router") &&
    hasDependency(dependencies, "@tanstack/react-router")
  ) {
    return {
      navigation: tanstackRouterAdapter(),
      moduleRoles: [tanstackRouterModuleRolePlugin()],
      effectApis: [tanstackRouterEffectApiProvider()],
      routeExecution: [tanstackRouterRouteExecutionPlugin()],
    };
  }
  if (
    !disabled.has("router") &&
    (hasDependency(dependencies, "react-router") ||
      hasDependency(dependencies, "react-router-dom"))
  ) {
    return {
      navigation: reactRouterAdapter(),
      moduleRoles: [reactRouterModuleRolePlugin()],
      effectApis: [reactRouterEffectApiProvider()],
      routeExecution: [reactRouterRouteExecutionPlugin()],
    };
  }
  if (!dependencies && !disabled.has("router")) {
    return {
      navigation: reactRouterAdapter(),
      moduleRoles: [reactRouterModuleRolePlugin()],
      effectApis: [reactRouterEffectApiProvider()],
      routeExecution: [reactRouterRouteExecutionPlugin()],
    };
  }
  return { moduleRoles: [], effectApis: [], routeExecution: [] };
}

function resolveBuiltinCacheStorageProviders(
  options: BuiltinRegistryOptions,
  disabled: Set<string>,
): CacheStorageProvider[] {
  if (options.routePlugin === false) {
    return [...(options.extraCacheStorageProviders ?? [])];
  }
  if (options.routePlugin) {
    return [...(options.extraCacheStorageProviders ?? [])];
  }

  const dependencies = options.dependencies;
  if (!disabled.has("next") && hasDependency(dependencies, "next")) {
    return [
      nextCacheStorageProvider(),
      ...(options.extraCacheStorageProviders ?? []),
    ];
  }
  if (
    !disabled.has("tanstack-router") &&
    hasDependency(dependencies, "@tanstack/react-router")
  ) {
    return [
      tanstackRouterCacheStorageProvider(),
      ...(options.extraCacheStorageProviders ?? []),
    ];
  }
  return [...(options.extraCacheStorageProviders ?? [])];
}

function resolveBuiltinFramework(
  options: BuiltinRegistryOptions,
): FrameworkPlugin {
  if (options.framework !== undefined && options.framework !== false) {
    return options.framework;
  }
  const base = extendReactFrameworkWithTsFacets(reactFramework());
  const dependencies = options.dependencies;
  const disabled = new Set(options.disabledPlugins ?? []);
  if (
    disabled.has("react-hook-form") ||
    (dependencies && dependencies["react-hook-form"] === undefined)
  ) {
    return base;
  }
  return extendFrameworkWithTsUnwrap(base, (node, ctx) =>
    unwrapReactHookFormHandler(node, ctx),
  );
}

function resolveBuiltinEffectModels(
  options: BuiltinRegistryOptions,
): readonly EffectPlugin[] {
  if (options.effectPlugins !== undefined) {
    return options.effectPlugins;
  }
  return [timerEffectPlugin(), websocketEffectPlugin()];
}

function hasDependency(
  dependencies: Readonly<Record<string, string>> | undefined,
  packageName: string,
): boolean {
  return dependencies?.[packageName] !== undefined;
}

export function createModalityRegistry(
  options: ModalityPluginRegistry = {
    statePlugins: [],
    typePlugins: [],
  },
): RegistrySummary {
  const typePlugins = options.typePlugins ?? [];
  const moduleRoleAdapters = options.moduleRoleAdapters ?? [];
  const effectApiProviders = options.effectApiProviders ?? [];
  const routeExecutionProviders = options.routeExecutionProviders ?? [];
  const cacheStorageProviders = options.cacheStorageProviders ?? [];
  const effectPlugins = options.effectPlugins ?? [];
  for (const plugin of options.statePlugins) validateStateSourcePlugin(plugin);
  for (const provider of typePlugins) validateTypePlugin(provider);
  for (const adapter of moduleRoleAdapters) validateModuleRolePlugin(adapter);
  for (const provider of effectApiProviders)
    validateEffectApiProvider(provider);
  for (const provider of routeExecutionProviders)
    validateRouteExecutionPlugin(provider);
  for (const provider of cacheStorageProviders)
    validateCacheStorageProvider(provider);
  if (options.routePlugin) validateRoutePlugin(options.routePlugin);
  if (options.framework) validateFrameworkPlugin(options.framework);
  for (const provider of effectPlugins) validateEffectPlugin(provider);
  const observations = buildObservationPlugins(
    options.statePlugins,
    options.routePlugin,
  );
  for (const provider of observations) validateObservationPlugin(provider);
  const statePluginIds = sortedUnique(
    options.statePlugins.map((plugin) => plugin.id),
    "source plugin",
  );
  sortedUnique(
    moduleRoleAdapters.map((adapter) => adapter.id),
    "module-role adapter",
  );
  sortedUnique(
    effectApiProviders.map((provider) => provider.id),
    "effect API provider",
  );
  sortedUnique(
    routeExecutionProviders.map((provider) => provider.id),
    "route-execution provider",
  );
  sortedUnique(
    cacheStorageProviders.map((provider) => provider.id),
    "cache/storage provider",
  );
  sortedUnique(
    observations.map((provider) => provider.id),
    "observation provider",
  );
  const effectPluginIds = sortedUnique(
    effectPlugins.map((provider) => provider.id),
    "effect plugin",
  );
  return {
    statePluginIds,
    effectPluginIds,
    statePlugins: options.statePlugins,
    effectPlugins,
    typePlugins,
    ...(options.framework ? { framework: options.framework } : {}),
    ...(options.routePlugin ? { routePlugin: options.routePlugin } : {}),
    adapters: {
      navigation: options.routePlugin,
      moduleRoles: moduleRoleAdapters,
      effectApis: effectApiProviders,
      routeExecution: routeExecutionProviders,
      cacheStorage: cacheStorageProviders,
      stateSources: options.statePlugins,
      typePlugins: typePlugins,
      observations,
    },
    plugins: [
      ...options.statePlugins.map((plugin) => ({
        id: plugin.id,
        version: plugin.version ?? "unknown",
        kind: "state-source" as const,
        packageNames: [...plugin.packageNames].sort(),
      })),
      ...(options.routePlugin
        ? [
            {
              id: options.routePlugin.id,
              version: options.routePlugin.version ?? "unknown",
              kind: "route" as const,
              packageNames: [...options.routePlugin.packageNames].sort(),
            },
          ]
        : []),
      ...(options.framework
        ? [
            {
              id: options.framework.id,
              version: options.framework.version ?? "unknown",
              kind: "framework" as const,
              packageNames: [...options.framework.packageNames].sort(),
            },
          ]
        : []),
      ...effectPlugins.map((provider) => ({
        id: provider.id,
        version: provider.version ?? "unknown",
        kind: "effect" as const,
        packageNames: [...provider.packageNames].sort(),
      })),
      ...moduleRoleAdapters.map((adapter) => ({
        id: adapter.id,
        version: adapter.version ?? "unknown",
        kind: "module-roles" as const,
        packageNames: [...adapter.packageNames].sort(),
      })),
      ...effectApiProviders.map((provider) => ({
        id: provider.id,
        version: provider.version ?? "unknown",
        kind: "effect-api" as const,
        packageNames: [...provider.packageNames].sort(),
      })),
      ...routeExecutionProviders.map((provider) => ({
        id: provider.id,
        version: provider.version ?? "unknown",
        kind: "route-execution" as const,
        packageNames: [...provider.packageNames].sort(),
      })),
      ...cacheStorageProviders.map((provider) => ({
        id: provider.id,
        version: provider.version ?? "unknown",
        kind: "cache-storage" as const,
        packageNames: [...provider.packageNames].sort(),
      })),
      ...typePlugins.map((provider) => ({
        id: provider.id,
        version: provider.version ?? "unknown",
        kind: "type" as const,
        packageNames: [...provider.packageNames].sort(),
      })),
      ...observations.map((provider) => ({
        id: provider.id,
        version: provider.version ?? "unknown",
        kind: "observation" as const,
        packageNames: [...provider.packageNames].sort(),
      })),
    ].sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
    ),
    ...(options.routePlugin ? { routePluginId: options.routePlugin.id } : {}),
    ...(options.framework ? { frameworkPluginId: options.framework.id } : {}),
  };
}

function shouldEnableBuiltin(
  plugin: { packageNames: readonly string[] },
  dependencies: Readonly<Record<string, string>> | undefined,
): boolean {
  if (!dependencies) return true;
  return plugin.packageNames.some(
    (packageName) => dependencies[packageName] !== undefined,
  );
}

function validateStateSourcePlugin(plugin: StateSourcePlugin): void {
  validateCommonPluginShape(plugin, "source plugin");
  if (typeof plugin.discover !== "function")
    throw new Error(
      `Invalid source plugin ${plugin.id}: discover must be a function`,
    );
  if (typeof plugin.writeChannels !== "function")
    throw new Error(
      `Invalid source plugin ${plugin.id}: writeChannels must be a function`,
    );
  if (
    !plugin.harness ||
    typeof plugin.harness.setup !== "function" ||
    typeof plugin.harness.observe !== "function"
  ) {
    throw new Error(
      `Invalid source plugin ${plugin.id}: harness.setup and harness.observe are required`,
    );
  }
}

function validateTypePlugin(provider: TypePlugin): void {
  validateCommonPluginShape(provider, "domain refinement provider");
  if (typeof provider.refineDomain !== "function")
    throw new Error(
      `Invalid domain refinement provider ${provider.id}: refineDomain must be a function`,
    );
}

function validateModuleRolePlugin(adapter: ModuleRolePlugin): void {
  validateCommonPluginShape(adapter, "module-role adapter");
  if (adapter.kind !== "module-roles")
    throw new Error(
      `Invalid module-role adapter ${adapter.id}: kind must be "module-roles"`,
    );
  if (typeof adapter.classifyModule !== "function")
    throw new Error(
      `Invalid module-role adapter ${adapter.id}: classifyModule must be a function`,
    );
  if (typeof adapter.moduleEntryExports !== "function")
    throw new Error(
      `Invalid module-role adapter ${adapter.id}: moduleEntryExports must be a function`,
    );
  if (typeof adapter.classifyImportEdge !== "function")
    throw new Error(
      `Invalid module-role adapter ${adapter.id}: classifyImportEdge must be a function`,
    );
  if (typeof adapter.isServerOnlyModule !== "function")
    throw new Error(
      `Invalid module-role adapter ${adapter.id}: isServerOnlyModule must be a function`,
    );
}

function validateEffectApiProvider(provider: EffectApiProvider): void {
  validateCommonPluginShape(provider, "effect API provider");
  if (provider.kind !== "effect-api")
    throw new Error(
      `Invalid effect API provider ${provider.id}: kind must be "effect-api"`,
    );
  if (typeof provider.discoverEffectApis !== "function")
    throw new Error(
      `Invalid effect API provider ${provider.id}: discoverEffectApis must be a function`,
    );
}

function validateRouteExecutionPlugin(provider: RouteExecutionPlugin): void {
  validateCommonPluginShape(provider, "route-execution provider");
  if (provider.kind !== "route-execution")
    throw new Error(
      `Invalid route-execution provider ${provider.id}: kind must be "route-execution"`,
    );
  if (typeof provider.describeRouteExecution !== "function")
    throw new Error(
      `Invalid route-execution provider ${provider.id}: describeRouteExecution must be a function`,
    );
}

function validateCacheStorageProvider(provider: CacheStorageProvider): void {
  validateCommonPluginShape(provider, "cache/storage provider");
  if (provider.kind !== "cache-storage")
    throw new Error(
      `Invalid cache/storage provider ${provider.id}: kind must be "cache-storage"`,
    );
  if (typeof provider.discoverCacheStorage !== "function")
    throw new Error(
      `Invalid cache/storage provider ${provider.id}: discoverCacheStorage must be a function`,
    );
}

function validateRoutePlugin(adapter: RoutePlugin): void {
  validateCommonPluginShape(adapter, "route plugin");
  if (adapter.kind !== "route")
    throw new Error(`Invalid route plugin ${adapter.id}: kind must be "route"`);
  if (typeof adapter.discoverRoutes !== "function")
    throw new Error(
      `Invalid route plugin ${adapter.id}: discoverRoutes must be a function`,
    );
  if (typeof adapter.classifyNavigationCall !== "function")
    throw new Error(
      `Invalid route plugin ${adapter.id}: classifyNavigationCall must be a function`,
    );
  if (typeof adapter.locationVars !== "function")
    throw new Error(
      `Invalid route plugin ${adapter.id}: locationVars must be a function`,
    );
  if (
    !adapter.harness ||
    typeof adapter.harness.setup !== "function" ||
    typeof adapter.harness.observe !== "function" ||
    typeof adapter.harness.navigate !== "function"
  ) {
    throw new Error(
      `Invalid route plugin ${adapter.id}: harness.setup, harness.observe, and harness.navigate are required`,
    );
  }
}

function validateFrameworkPlugin(plugin: FrameworkPlugin): void {
  validateCommonPluginShape(plugin, "framework plugin");
  if (typeof plugin.recognizeHook !== "function")
    throw new Error(
      `Invalid framework plugin ${plugin.id}: recognizeHook must be a function`,
    );
  if (typeof plugin.recognizeRenderBoundary !== "function")
    throw new Error(
      `Invalid framework plugin ${plugin.id}: recognizeRenderBoundary must be a function`,
    );
}

function validateEffectPlugin(provider: EffectPlugin): void {
  validateCommonPluginShape(provider, "effect plugin");
  if (provider.kind !== "effect")
    throw new Error(
      `Invalid effect plugin ${provider.id}: kind must be "effect"`,
    );
  if (typeof provider.recognizeEffect !== "function")
    throw new Error(
      `Invalid effect plugin ${provider.id}: recognizeEffect must be a function`,
    );
}

function validateCommonPluginShape(
  plugin: { id?: unknown; packageNames?: unknown; version?: unknown },
  kind: string,
): void {
  if (typeof plugin.id !== "string" || plugin.id.length === 0)
    throw new Error(`Invalid ${kind}: id must be a non-empty string`);
  if (
    !Array.isArray(plugin.packageNames) ||
    !plugin.packageNames.every(
      (name) => typeof name === "string" && name.length > 0,
    )
  ) {
    throw new Error(
      `Invalid ${kind} ${plugin.id}: packageNames must be non-empty strings`,
    );
  }
  if (plugin.version !== undefined && typeof plugin.version !== "string")
    throw new Error(`Invalid ${kind} ${plugin.id}: version must be a string`);
}

function sortedUnique(values: readonly string[], kind: string): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${kind} ${value}`);
    seen.add(value);
  }
  return [...values].sort();
}

export interface ObservationPluginRuntime {
  readonly handlesByProviderId: ReadonlyMap<string, HarnessHooks>;
}

export function observationProviderFromStateSource(
  plugin: StateSourcePlugin,
): ObservationPlugin {
  return {
    id: plugin.id,
    version: plugin.version,
    packageNames: plugin.packageNames,
    kind: "observation",
    setup: (ctx) => plugin.harness.setup(ctx),
    observe: (varId, handles) => plugin.harness.observe(varId, handles),
    ...(plugin.harness.witness
      ? {
          witness: (domain, varId) => plugin.harness.witness?.(domain, varId),
        }
      : {}),
  };
}

export function observationPluginFromRoute(
  navigation: RoutePlugin,
): ObservationPlugin {
  return {
    id: routeObservationId(navigation),
    version: navigation.version,
    packageNames: navigation.packageNames,
    kind: "observation",
    setup: (ctx) => navigation.harness.setup(ctx),
    observe: (varId, handles) =>
      observeNavigationVar(navigation, varId, handles),
  };
}

export function routeObservationId(navigation: RoutePlugin): string {
  return `${navigation.id}-observation`;
}

export function setupObservationPlugins(
  providers: readonly ObservationPlugin[],
  ctx: HarnessCtx & Record<string, unknown> = {},
): ObservationPluginRuntime {
  const handlesByProviderId = new Map<string, HarnessHooks>();
  for (const provider of providers) {
    handlesByProviderId.set(provider.id, provider.setup(ctx));
  }
  return { handlesByProviderId };
}

export function observationSourcesFromProviders(
  providers: readonly ObservationPlugin[],
  runtime: ObservationPluginRuntime,
): ObservationSource[] {
  return providers.map((provider) =>
    observationSource(provider.id, (varId) => {
      const handles = runtime.handlesByProviderId.get(provider.id);
      if (!handles) return "unobservable";
      return provider.observe(varId, handles);
    }),
  );
}

export function replayBlockingReasonForUnobservableVars(
  varIds: readonly string[],
  providers: readonly ObservationPlugin[],
): string {
  const providerIds = providers.map((provider) => provider.id).sort();
  return `Unobservable model vars: ${varIds.join(", ")} (tried providers: ${providerIds.join(", ")})`;
}

function buildObservationPlugins(
  statePlugins: readonly StateSourcePlugin[],
  navigation?: RoutePlugin,
): ObservationPlugin[] {
  return [
    ...statePlugins.map(observationProviderFromStateSource),
    ...(navigation ? [observationPluginFromRoute(navigation)] : []),
  ];
}

function observeNavigationVar(
  navigation: RoutePlugin,
  varId: string,
  handles: HarnessHooks,
): ObservedRead | "unobservable" {
  if (!varId.startsWith("sys:")) return "unobservable";
  const observe = navigation.harness.observe as (
    handles: HarnessHooks,
    observedVarId?: string,
  ) => ObservedRead | "unobservable";
  return observe(handles, varId);
}

function validateObservationPlugin(provider: ObservationPlugin): void {
  validateCommonPluginShape(provider, "observation provider");
  if (provider.kind !== "observation")
    throw new Error(
      `Invalid observation provider ${provider.id}: kind must be "observation"`,
    );
  if (typeof provider.setup !== "function")
    throw new Error(
      `Invalid observation provider ${provider.id}: setup must be a function`,
    );
  if (typeof provider.observe !== "function")
    throw new Error(
      `Invalid observation provider ${provider.id}: observe must be a function`,
    );
}
