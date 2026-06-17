import type { PluginProvenance } from "modality-ts/core";
import type {
  DomainRefinementProvider,
  EffectApiProvider,
  ModuleRoleAdapter,
  NavigationAdapter,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";
import { arktypeDomainRefinementProvider } from "modality-ts/extract/type-libraries/arktype";
import { zodDomainRefinementProvider } from "modality-ts/extract/type-libraries/zod";
import { jotaiSource } from "modality-ts/extract/sources/jotai";
import {
  nextAdapter,
  nextEffectApiProvider,
  nextModuleRoleAdapter,
} from "modality-ts/extract/sources/next";
import {
  reactRouterAdapter,
  reactRouterEffectApiProvider,
  reactRouterModuleRoleAdapter,
} from "modality-ts/extract/sources/router";
import { swrSource } from "modality-ts/extract/sources/swr";
import { useStateSource } from "modality-ts/extract/sources/use-state";
import { zustandSource } from "modality-ts/extract/sources/zustand";

export interface RegistryAdaptersBundle {
  navigation?: NavigationAdapter;
  moduleRoles: readonly ModuleRoleAdapter[];
  effectApis: readonly EffectApiProvider[];
  stateSources: readonly StateSourcePlugin[];
  domainRefinements: readonly DomainRefinementProvider[];
  observations: readonly [];
}

export interface ModalityPluginRegistry {
  sourcePlugins: readonly StateSourcePlugin[];
  routerPlugin?: NavigationAdapter;
  domainRefinementProviders: readonly DomainRefinementProvider[];
  moduleRoleAdapters?: readonly ModuleRoleAdapter[];
  effectApiProviders?: readonly EffectApiProvider[];
}

export interface BuiltinRegistryOptions {
  dependencies?: Readonly<Record<string, string>>;
  disabledPlugins?: readonly string[];
  extraSourcePlugins?: readonly StateSourcePlugin[];
  extraDomainRefinementProviders?: readonly DomainRefinementProvider[];
  routerPlugin?: NavigationAdapter | false;
}

export interface RegistrySummary {
  sourcePluginIds: readonly string[];
  routerPluginId?: string;
  sourcePlugins: readonly StateSourcePlugin[];
  routerPlugin?: NavigationAdapter;
  domainRefinementProviders: readonly DomainRefinementProvider[];
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
  ];
  const sourcePlugins = [
    ...builtins.filter(
      (plugin) =>
        !disabled.has(plugin.id) && shouldEnableBuiltin(plugin, dependencies),
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
  return createModalityRegistry({
    sourcePlugins,
    routerPlugin: builtinNavigation.navigation,
    domainRefinementProviders,
    moduleRoleAdapters: builtinNavigation.moduleRoles,
    effectApiProviders: builtinNavigation.effectApis,
  });
}

function resolveBuiltinNavigationBundle(
  options: BuiltinRegistryOptions,
  disabled: Set<string>,
): {
  navigation?: NavigationAdapter;
  moduleRoles: ModuleRoleAdapter[];
  effectApis: EffectApiProvider[];
} {
  if (options.routerPlugin === false) {
    return { moduleRoles: [], effectApis: [] };
  }
  if (options.routerPlugin) {
    return {
      navigation: options.routerPlugin,
      moduleRoles: [],
      effectApis: [],
    };
  }

  const dependencies = options.dependencies;
  if (!disabled.has("next") && hasDependency(dependencies, "next")) {
    return {
      navigation: nextAdapter(),
      moduleRoles: [nextModuleRoleAdapter()],
      effectApis: [nextEffectApiProvider()],
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
    };
  }
  if (!dependencies && !disabled.has("router")) {
    return {
      navigation: reactRouterAdapter(),
      moduleRoles: [reactRouterModuleRoleAdapter()],
      effectApis: [reactRouterEffectApiProvider()],
    };
  }
  return { moduleRoles: [], effectApis: [] };
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
  for (const plugin of options.sourcePlugins) validateStateSourcePlugin(plugin);
  for (const provider of domainRefinementProviders)
    validateDomainRefinementProvider(provider);
  for (const adapter of moduleRoleAdapters) validateModuleRoleAdapter(adapter);
  for (const provider of effectApiProviders)
    validateEffectApiProvider(provider);
  if (options.routerPlugin) validateRouterPlugin(options.routerPlugin);
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
  return {
    sourcePluginIds,
    sourcePlugins: options.sourcePlugins,
    domainRefinementProviders,
    ...(options.routerPlugin ? { routerPlugin: options.routerPlugin } : {}),
    adapters: {
      navigation: options.routerPlugin,
      moduleRoles: moduleRoleAdapters,
      effectApis: effectApiProviders,
      stateSources: options.sourcePlugins,
      domainRefinements: domainRefinementProviders,
      observations: [],
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
              kind: "router" as const,
              packageNames: [...options.routerPlugin.packageNames].sort(),
            },
          ]
        : []),
      ...moduleRoleAdapters.map((adapter) => ({
        id: adapter.id,
        version: adapter.version ?? "unknown",
        kind: "module-role" as const,
        packageNames: [...adapter.packageNames].sort(),
      })),
      ...effectApiProviders.map((provider) => ({
        id: provider.id,
        version: provider.version ?? "unknown",
        kind: "effect-api" as const,
        packageNames: [...provider.packageNames].sort(),
      })),
      ...domainRefinementProviders.map((provider) => ({
        id: provider.id,
        version: provider.version ?? "unknown",
        kind: "domain-refinement" as const,
        packageNames: [...provider.packageNames].sort(),
      })),
    ].sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
    ),
    ...(options.routerPlugin
      ? { routerPluginId: options.routerPlugin.id }
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

function validateRouterPlugin(plugin: NavigationAdapter): void {
  validateCommonPluginShape(plugin, "router plugin");
  if (typeof plugin.discoverRoutes !== "function")
    throw new Error(
      `Invalid router plugin ${plugin.id}: discoverRoutes must be a function`,
    );
  if (typeof plugin.classifyNavigationCall !== "function")
    throw new Error(
      `Invalid router plugin ${plugin.id}: classifyNavigationCall must be a function`,
    );
  if (typeof plugin.locationVars !== "function")
    throw new Error(
      `Invalid router plugin ${plugin.id}: locationVars must be a function`,
    );
  if (
    !plugin.harness ||
    typeof plugin.harness.setup !== "function" ||
    typeof plugin.harness.observe !== "function" ||
    typeof plugin.harness.navigate !== "function"
  ) {
    throw new Error(
      `Invalid router plugin ${plugin.id}: harness.setup, harness.observe, and harness.navigate are required`,
    );
  }
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
