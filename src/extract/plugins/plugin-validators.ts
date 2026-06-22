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
import { validateCommonPluginShape } from "./validate.js";

export function validateStateSourcePlugin(plugin: StateSourcePlugin): void {
  validateCommonPluginShape(plugin, "state-source plugin");
  if (plugin.kind !== "state-source") {
    throw new Error(
      `Invalid state-source plugin ${plugin.id}: kind must be "state-source"`,
    );
  }
  if (typeof plugin.discover !== "function") {
    throw new Error(
      `Invalid state-source plugin ${plugin.id}: discover must be a function`,
    );
  }
  if (typeof plugin.writeChannels !== "function") {
    throw new Error(
      `Invalid state-source plugin ${plugin.id}: writeChannels must be a function`,
    );
  }
  if (
    !plugin.harness ||
    typeof plugin.harness.setup !== "function" ||
    typeof plugin.harness.observe !== "function"
  ) {
    throw new Error(
      `Invalid state-source plugin ${plugin.id}: harness.setup and harness.observe are required`,
    );
  }
}

export function validateTypePlugin(provider: TypePlugin): void {
  validateCommonPluginShape(provider, "type plugin");
  if (provider.kind !== "type") {
    throw new Error(`Invalid type plugin ${provider.id}: kind must be "type"`);
  }
  if (typeof provider.refineDomain !== "function") {
    throw new Error(
      `Invalid type plugin ${provider.id}: refineDomain must be a function`,
    );
  }
}

export function validateModuleRolePlugin(adapter: ModuleRolePlugin): void {
  validateCommonPluginShape(adapter, "module-role plugin");
  if (adapter.kind !== "module-roles") {
    throw new Error(
      `Invalid module-role plugin ${adapter.id}: kind must be "module-roles"`,
    );
  }
  if (typeof adapter.classifyModule !== "function") {
    throw new Error(
      `Invalid module-role plugin ${adapter.id}: classifyModule must be a function`,
    );
  }
  if (typeof adapter.moduleEntryExports !== "function") {
    throw new Error(
      `Invalid module-role plugin ${adapter.id}: moduleEntryExports must be a function`,
    );
  }
  if (typeof adapter.classifyImportEdge !== "function") {
    throw new Error(
      `Invalid module-role plugin ${adapter.id}: classifyImportEdge must be a function`,
    );
  }
  if (typeof adapter.isServerOnlyModule !== "function") {
    throw new Error(
      `Invalid module-role plugin ${adapter.id}: isServerOnlyModule must be a function`,
    );
  }
}

export function validateEffectApiPlugin(provider: EffectApiProvider): void {
  validateCommonPluginShape(provider, "effect-api plugin");
  if (provider.kind !== "effect-api") {
    throw new Error(
      `Invalid effect-api plugin ${provider.id}: kind must be "effect-api"`,
    );
  }
  if (typeof provider.discoverEffectApis !== "function") {
    throw new Error(
      `Invalid effect-api plugin ${provider.id}: discoverEffectApis must be a function`,
    );
  }
}

export function validateRouteExecutionPlugin(
  provider: RouteExecutionPlugin,
): void {
  validateCommonPluginShape(provider, "route-execution plugin");
  if (provider.kind !== "route-execution") {
    throw new Error(
      `Invalid route-execution plugin ${provider.id}: kind must be "route-execution"`,
    );
  }
  if (typeof provider.describeRouteExecution !== "function") {
    throw new Error(
      `Invalid route-execution plugin ${provider.id}: describeRouteExecution must be a function`,
    );
  }
}

export function validateCacheStoragePlugin(
  provider: CacheStorageProvider,
): void {
  validateCommonPluginShape(provider, "cache-storage plugin");
  if (provider.kind !== "cache-storage") {
    throw new Error(
      `Invalid cache-storage plugin ${provider.id}: kind must be "cache-storage"`,
    );
  }
  if (typeof provider.discoverCacheStorage !== "function") {
    throw new Error(
      `Invalid cache-storage plugin ${provider.id}: discoverCacheStorage must be a function`,
    );
  }
}

export function validateRoutePlugin(adapter: RoutePlugin): void {
  validateCommonPluginShape(adapter, "route plugin");
  if (adapter.kind !== "route") {
    throw new Error(`Invalid route plugin ${adapter.id}: kind must be "route"`);
  }
  if (typeof adapter.discoverRoutes !== "function") {
    throw new Error(
      `Invalid route plugin ${adapter.id}: discoverRoutes must be a function`,
    );
  }
  if (typeof adapter.classifyNavigationCall !== "function") {
    throw new Error(
      `Invalid route plugin ${adapter.id}: classifyNavigationCall must be a function`,
    );
  }
  if (typeof adapter.locationVars !== "function") {
    throw new Error(
      `Invalid route plugin ${adapter.id}: locationVars must be a function`,
    );
  }
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

export function validateFrameworkPlugin(plugin: FrameworkPlugin): void {
  validateCommonPluginShape(plugin, "framework plugin");
  if (plugin.kind !== "framework") {
    throw new Error(
      `Invalid framework plugin ${plugin.id}: kind must be "framework"`,
    );
  }
  if (typeof plugin.recognizeHook !== "function") {
    throw new Error(
      `Invalid framework plugin ${plugin.id}: recognizeHook must be a function`,
    );
  }
  if (typeof plugin.recognizeRenderBoundary !== "function") {
    throw new Error(
      `Invalid framework plugin ${plugin.id}: recognizeRenderBoundary must be a function`,
    );
  }
}

export function validateEffectPlugin(provider: EffectPlugin): void {
  validateCommonPluginShape(provider, "effect plugin");
  if (provider.kind !== "effect") {
    throw new Error(
      `Invalid effect plugin ${provider.id}: kind must be "effect"`,
    );
  }
  if (typeof provider.recognizeEffect !== "function") {
    throw new Error(
      `Invalid effect plugin ${provider.id}: recognizeEffect must be a function`,
    );
  }
}

export function validateObservationPlugin(provider: ObservationPlugin): void {
  validateCommonPluginShape(provider, "observation plugin");
  if (provider.kind !== "observation") {
    throw new Error(
      `Invalid observation plugin ${provider.id}: kind must be "observation"`,
    );
  }
  if (typeof provider.setup !== "function") {
    throw new Error(
      `Invalid observation plugin ${provider.id}: setup must be a function`,
    );
  }
  if (typeof provider.observe !== "function") {
    throw new Error(
      `Invalid observation plugin ${provider.id}: observe must be a function`,
    );
  }
}
