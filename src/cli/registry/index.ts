import type { PluginProvenance } from "modality-ts/core";
import type {
  NavigationAdapter,
  StateSourcePlugin,
} from "modality-ts/extract/engine/spi";
import { jotaiSource } from "modality-ts/extract/sources/jotai";
import { routerSource } from "modality-ts/extract/sources/router";
import { swrSource } from "modality-ts/extract/sources/swr";
import { useStateSource } from "modality-ts/extract/sources/use-state";

export interface ModalityPluginRegistry {
  sourcePlugins: readonly StateSourcePlugin[];
  routerPlugin?: NavigationAdapter;
}

export interface BuiltinRegistryOptions {
  dependencies?: Readonly<Record<string, string>>;
  disabledPlugins?: readonly string[];
  extraSourcePlugins?: readonly StateSourcePlugin[];
  routerPlugin?: NavigationAdapter | false;
}

export interface RegistrySummary {
  sourcePluginIds: readonly string[];
  routerPluginId?: string;
  sourcePlugins: readonly StateSourcePlugin[];
  routerPlugin?: NavigationAdapter;
  plugins: readonly PluginProvenance[];
}

export function createBuiltinModalityRegistry(
  options: BuiltinRegistryOptions = {},
): RegistrySummary {
  const dependencies = options.dependencies;
  const disabled = new Set(options.disabledPlugins ?? []);
  const builtins = [useStateSource(), jotaiSource(), swrSource()];
  const sourcePlugins = [
    ...builtins.filter(
      (plugin) =>
        !disabled.has(plugin.id) && shouldEnableBuiltin(plugin, dependencies),
    ),
    ...(options.extraSourcePlugins ?? []),
  ];
  const defaultRouter = routerSource();
  const routerPlugin =
    options.routerPlugin === false || disabled.has(defaultRouter.id)
      ? undefined
      : (options.routerPlugin ??
        (shouldEnableBuiltin(defaultRouter, dependencies)
          ? defaultRouter
          : undefined));
  return createModalityRegistry({ sourcePlugins, routerPlugin });
}

export function createModalityRegistry(
  options: ModalityPluginRegistry = { sourcePlugins: [] },
): RegistrySummary {
  for (const plugin of options.sourcePlugins) validateStateSourcePlugin(plugin);
  if (options.routerPlugin) validateRouterPlugin(options.routerPlugin);
  const sourcePluginIds = sortedUnique(
    options.sourcePlugins.map((plugin) => plugin.id),
    "source plugin",
  );
  return {
    sourcePluginIds,
    sourcePlugins: options.sourcePlugins,
    ...(options.routerPlugin ? { routerPlugin: options.routerPlugin } : {}),
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
