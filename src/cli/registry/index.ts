import type { PluginProvenance } from "modality-ts/core";
import {
  observationSource,
  type ObservationSource,
} from "modality-ts/cli/harness";
import type {
  CacheStorageProvider,
  DomainRefinementProvider,
  EffectApiProvider,
  FrameworkPlugin,
  HandlerWrapperProvider,
  HarnessCtx,
  HarnessHooks,
  ModuleRoleAdapter,
  NavigationAdapter,
  ObservationProvider,
  ObservedRead,
  RouteExecutionProvider,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";
import { arktypeDomainRefinementProvider } from "modality-ts/extract/type-libraries/arktype";
import { zodDomainRefinementProvider } from "modality-ts/extract/type-libraries/zod";
import { jotaiSource } from "modality-ts/extract/sources/jotai";
import {
  nextAdapter,
  nextCacheStorageProvider,
  nextEffectApiProvider,
  nextModuleRoleAdapter,
  nextRouteExecutionProvider,
} from "modality-ts/extract/sources/next";
import {
  reactRouterAdapter,
  reactRouterEffectApiProvider,
  reactRouterModuleRoleAdapter,
  reactRouterRouteExecutionProvider,
} from "modality-ts/extract/sources/router";
import {
  tanstackRouterAdapter,
  tanstackRouterCacheStorageProvider,
  tanstackRouterEffectApiProvider,
  tanstackRouterModuleRoleAdapter,
  tanstackRouterRouteExecutionProvider,
} from "modality-ts/extract/sources/tanstack-router";
import { swrSource } from "modality-ts/extract/sources/swr";
import { tanstackQuerySource } from "modality-ts/extract/sources/tanstack-query";
import { useStateSource } from "modality-ts/extract/sources/use-state";
import { reduxSource } from "modality-ts/extract/sources/redux";
import { zustandSource } from "modality-ts/extract/sources/zustand";
import { reactHookFormSource } from "modality-ts/extract/sources/react-hook-form";
import { reactFramework } from "modality-ts/extract/frameworks/react";

export interface RegistryAdaptersBundle {
  navigation?: NavigationAdapter;
  moduleRoles: readonly ModuleRoleAdapter[];
  effectApis: readonly EffectApiProvider[];
  routeExecution: readonly RouteExecutionProvider[];
  cacheStorage: readonly CacheStorageProvider[];
  stateSources: readonly StateSourcePlugin[];
  domainRefinements: readonly DomainRefinementProvider[];
  observations: readonly ObservationProvider[];
}

export interface ModalityPluginRegistry {
  sourcePlugins: readonly StateSourcePlugin[];
  routerPlugin?: NavigationAdapter;
  framework?: FrameworkPlugin;
  domainRefinementProviders: readonly DomainRefinementProvider[];
  moduleRoleAdapters?: readonly ModuleRoleAdapter[];
  effectApiProviders?: readonly EffectApiProvider[];
  routeExecutionProviders?: readonly RouteExecutionProvider[];
  cacheStorageProviders?: readonly CacheStorageProvider[];
  handlerWrapperProviders?: readonly HandlerWrapperProvider[];
}

export interface BuiltinRegistryOptions {
  dependencies?: Readonly<Record<string, string>>;
  disabledPlugins?: readonly string[];
  /** Explicit config plugin list; suppresses built-in auto-detection when non-empty. */
  sourcePluginsOverride?: readonly StateSourcePlugin[];
  extraSourcePlugins?: readonly StateSourcePlugin[];
  extraDomainRefinementProviders?: readonly DomainRefinementProvider[];
  extraCacheStorageProviders?: readonly CacheStorageProvider[];
  extraHandlerWrapperProviders?: readonly HandlerWrapperProvider[];
  routerPlugin?: NavigationAdapter | false;
  framework?: FrameworkPlugin | false;
}

export interface RegistrySummary {
  sourcePluginIds: readonly string[];
  routerPluginId?: string;
  frameworkPluginId?: string;
  sourcePlugins: readonly StateSourcePlugin[];
  routerPlugin?: NavigationAdapter;
  framework?: FrameworkPlugin;
  domainRefinementProviders: readonly DomainRefinementProvider[];
  handlerWrapperProviders: readonly HandlerWrapperProvider[];
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
  const sourcePlugins = options.sourcePluginsOverride?.length
    ? [...options.sourcePluginsOverride, ...(options.extraSourcePlugins ?? [])]
    : [
        ...builtins.filter(
          (plugin) =>
            !disabled.has(plugin.id) &&
            shouldEnableBuiltin(plugin, dependencies),
        ),
        ...(options.extraSourcePlugins ?? []),
      ];
  const domainRefinementBuiltins = [
    zodDomainRefinementProvider(),
    arktypeDomainRefinementProvider(),
  ];
  const domainRefinementProviders = [
    ...domainRefinementBuiltins.filter(
      (provider) =>
        !disabled.has(provider.id) &&
        shouldEnableBuiltin(provider, dependencies),
    ),
    ...(options.extraDomainRefinementProviders ?? []),
  ];
  const builtinNavigation = resolveBuiltinNavigationBundle(options, disabled);
  const cacheStorageProviders = resolveBuiltinCacheStorageProviders(
    options,
    disabled,
  );
  const handlerWrapperBuiltins = [reactHookFormSource()];
  const handlerWrapperProviders = [
    ...handlerWrapperBuiltins.filter(
      (p) => !disabled.has(p.id) && shouldEnableBuiltin(p, dependencies),
    ),
    ...(options.extraHandlerWrapperProviders ?? []),
  ];
  return createModalityRegistry({
    sourcePlugins,
    routerPlugin: builtinNavigation.navigation,
    framework: resolveBuiltinFramework(options),
    domainRefinementProviders,
    moduleRoleAdapters: builtinNavigation.moduleRoles,
    effectApiProviders: builtinNavigation.effectApis,
    routeExecutionProviders: builtinNavigation.routeExecution,
    cacheStorageProviders,
    handlerWrapperProviders,
  });
}

function resolveBuiltinNavigationBundle(
  options: BuiltinRegistryOptions,
  disabled: Set<string>,
): {
  navigation?: NavigationAdapter;
  moduleRoles: ModuleRoleAdapter[];
  effectApis: EffectApiProvider[];
  routeExecution: RouteExecutionProvider[];
} {
  if (options.routerPlugin === false) {
    return { moduleRoles: [], effectApis: [], routeExecution: [] };
  }
  if (options.routerPlugin) {
    return {
      navigation: options.routerPlugin,
      moduleRoles: [],
      effectApis: [],
      routeExecution: [],
    };
  }

  const dependencies = options.dependencies;
  if (!disabled.has("next") && hasDependency(dependencies, "next")) {
    return {
      navigation: nextAdapter(),
      moduleRoles: [nextModuleRoleAdapter()],
      effectApis: [nextEffectApiProvider()],
      routeExecution: [nextRouteExecutionProvider()],
    };
  }
  if (
    !disabled.has("tanstack-router") &&
    hasDependency(dependencies, "@tanstack/react-router")
  ) {
    return {
      navigation: tanstackRouterAdapter(),
      moduleRoles: [tanstackRouterModuleRoleAdapter()],
      effectApis: [tanstackRouterEffectApiProvider()],
      routeExecution: [tanstackRouterRouteExecutionProvider()],
    };
  }
  if (
    !disabled.has("router") &&
    (hasDependency(dependencies, "react-router") ||
      hasDependency(dependencies, "react-router-dom"))
  ) {
    return {
      navigation: reactRouterAdapter(),
      moduleRoles: [reactRouterModuleRoleAdapter()],
      effectApis: [reactRouterEffectApiProvider()],
      routeExecution: [reactRouterRouteExecutionProvider()],
    };
  }
  if (!dependencies && !disabled.has("router")) {
    return {
      navigation: reactRouterAdapter(),
      moduleRoles: [reactRouterModuleRoleAdapter()],
      effectApis: [reactRouterEffectApiProvider()],
      routeExecution: [reactRouterRouteExecutionProvider()],
    };
  }
  return { moduleRoles: [], effectApis: [], routeExecution: [] };
}

function resolveBuiltinCacheStorageProviders(
  options: BuiltinRegistryOptions,
  disabled: Set<string>,
): CacheStorageProvider[] {
  if (options.routerPlugin === false) {
    return [...(options.extraCacheStorageProviders ?? [])];
  }
  if (options.routerPlugin) {
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
  return reactFramework();
}

function hasDependency(
  dependencies: Readonly<Record<string, string>> | undefined,
  packageName: string,
): boolean {
  return dependencies?.[packageName] !== undefined;
}

export function createModalityRegistry(
  options: ModalityPluginRegistry = {
    sourcePlugins: [],
    domainRefinementProviders: [],
  },
): RegistrySummary {
  const domainRefinementProviders = options.domainRefinementProviders ?? [];
  const moduleRoleAdapters = options.moduleRoleAdapters ?? [];
  const effectApiProviders = options.effectApiProviders ?? [];
  const routeExecutionProviders = options.routeExecutionProviders ?? [];
  const cacheStorageProviders = options.cacheStorageProviders ?? [];
  const handlerWrapperProviders = options.handlerWrapperProviders ?? [];
  for (const plugin of options.sourcePlugins) validateStateSourcePlugin(plugin);
  for (const provider of domainRefinementProviders)
    validateDomainRefinementProvider(provider);
  for (const adapter of moduleRoleAdapters) validateModuleRoleAdapter(adapter);
  for (const provider of effectApiProviders)
    validateEffectApiProvider(provider);
  for (const provider of routeExecutionProviders)
    validateRouteExecutionProvider(provider);
  for (const provider of cacheStorageProviders)
    validateCacheStorageProvider(provider);
  if (options.routerPlugin) validateNavigationAdapter(options.routerPlugin);
  if (options.framework) validateFrameworkPlugin(options.framework);
  const observations = buildObservationProviders(
    options.sourcePlugins,
    options.routerPlugin,
  );
  for (const provider of observations) validateObservationProvider(provider);
  const sourcePluginIds = sortedUnique(
    options.sourcePlugins.map((plugin) => plugin.id),
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
  return {
    sourcePluginIds,
    sourcePlugins: options.sourcePlugins,
    domainRefinementProviders,
    handlerWrapperProviders,
    ...(options.framework ? { framework: options.framework } : {}),
    ...(options.routerPlugin ? { routerPlugin: options.routerPlugin } : {}),
    adapters: {
      navigation: options.routerPlugin,
      moduleRoles: moduleRoleAdapters,
      effectApis: effectApiProviders,
      routeExecution: routeExecutionProviders,
      cacheStorage: cacheStorageProviders,
      stateSources: options.sourcePlugins,
      domainRefinements: domainRefinementProviders,
      observations,
    },
    plugins: [
      ...options.sourcePlugins.map((plugin) => ({
        id: plugin.id,
        version: plugin.version ?? "unknown",
        kind: "state-source" as const,
        packageNames: [...plugin.packageNames].sort(),
      })),
      ...(options.routerPlugin
        ? [
            {
              id: options.routerPlugin.id,
              version: options.routerPlugin.version ?? "unknown",
              kind: "navigation" as const,
              packageNames: [...options.routerPlugin.packageNames].sort(),
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
      ...domainRefinementProviders.map((provider) => ({
        id: provider.id,
        version: provider.version ?? "unknown",
        kind: "domain-refinement" as const,
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
    ...(options.routerPlugin
      ? { routerPluginId: options.routerPlugin.id }
      : {}),
    ...(options.framework
      ? { frameworkPluginId: options.framework.id }
      : {}),
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

function validateDomainRefinementProvider(
  provider: DomainRefinementProvider,
): void {
  validateCommonPluginShape(provider, "domain refinement provider");
  if (typeof provider.refineDomain !== "function")
    throw new Error(
      `Invalid domain refinement provider ${provider.id}: refineDomain must be a function`,
    );
}

function validateModuleRoleAdapter(adapter: ModuleRoleAdapter): void {
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

function validateRouteExecutionProvider(
  provider: RouteExecutionProvider,
): void {
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

function validateNavigationAdapter(adapter: NavigationAdapter): void {
  validateCommonPluginShape(adapter, "navigation adapter");
  if (typeof adapter.discoverRoutes !== "function")
    throw new Error(
      `Invalid navigation adapter ${adapter.id}: discoverRoutes must be a function`,
    );
  if (typeof adapter.classifyNavigationCall !== "function")
    throw new Error(
      `Invalid navigation adapter ${adapter.id}: classifyNavigationCall must be a function`,
    );
  if (typeof adapter.locationVars !== "function")
    throw new Error(
      `Invalid navigation adapter ${adapter.id}: locationVars must be a function`,
    );
  if (
    !adapter.harness ||
    typeof adapter.harness.setup !== "function" ||
    typeof adapter.harness.observe !== "function" ||
    typeof adapter.harness.navigate !== "function"
  ) {
    throw new Error(
      `Invalid navigation adapter ${adapter.id}: harness.setup, harness.observe, and harness.navigate are required`,
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

export interface ObservationProviderRuntime {
  readonly handlesByProviderId: ReadonlyMap<string, HarnessHooks>;
}

export function observationProviderFromStateSource(
  plugin: StateSourcePlugin,
): ObservationProvider {
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

export function observationProviderFromNavigation(
  navigation: NavigationAdapter,
): ObservationProvider {
  return {
    id: navigationObservationId(navigation),
    version: navigation.version,
    packageNames: navigation.packageNames,
    kind: "observation",
    setup: (ctx) => navigation.harness.setup(ctx),
    observe: (varId, handles) =>
      observeNavigationVar(navigation, varId, handles),
  };
}

export function navigationObservationId(navigation: NavigationAdapter): string {
  return `${navigation.id}-observation`;
}

export function setupObservationProviders(
  providers: readonly ObservationProvider[],
  ctx: HarnessCtx & Record<string, unknown> = {},
): ObservationProviderRuntime {
  const handlesByProviderId = new Map<string, HarnessHooks>();
  for (const provider of providers) {
    handlesByProviderId.set(provider.id, provider.setup(ctx));
  }
  return { handlesByProviderId };
}

export function observationSourcesFromProviders(
  providers: readonly ObservationProvider[],
  runtime: ObservationProviderRuntime,
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
  providers: readonly ObservationProvider[],
): string {
  const providerIds = providers.map((provider) => provider.id).sort();
  return `Unobservable model vars: ${varIds.join(", ")} (tried providers: ${providerIds.join(", ")})`;
}

function buildObservationProviders(
  sourcePlugins: readonly StateSourcePlugin[],
  navigation?: NavigationAdapter,
): ObservationProvider[] {
  return [
    ...sourcePlugins.map(observationProviderFromStateSource),
    ...(navigation ? [observationProviderFromNavigation(navigation)] : []),
  ];
}

function observeNavigationVar(
  navigation: NavigationAdapter,
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

function validateObservationProvider(provider: ObservationProvider): void {
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
