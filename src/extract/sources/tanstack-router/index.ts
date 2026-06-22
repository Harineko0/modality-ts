import type {
  EffectApiProvider,
  ModuleRolePlugin,
  ResolvedOptions,
  RouteExecutionPlugin,
  RoutePlugin,
} from "modality-ts/extract/engine/spi";
import { discoverRoutes, routeForComponent } from "./discover.js";
import * as harness from "./harness.js";
import {
  classifyTanstackImportEdge,
  classifyTanstackModule,
  shouldDiscoverTanstackEffectApis,
  tanstackModuleEntryExports,
} from "./module-roles.js";
import { classifyNavigationCall, classifyNavigationJsx } from "./navigation.js";
import { tanstackRouterRouteExecutionPlugin as createTanstackRouterRouteExecutionPlugin } from "./route-execution.js";
import { isServerOnlyModulePath } from "./route-options.js";
import {
  locationVars,
  lowerNavigation,
  mountScopeForComponent,
  routeTreeVars,
} from "./routes.js";
import { discoverTanstackRouteEffectApis } from "./server-effects.js";

export interface TanstackRouterSourceOptions {
  id?: string;
  packageNames?: readonly string[];
  historyMaxLen?: number;
}

export function tanstackRouterModuleRolePlugin(
  options: Pick<TanstackRouterSourceOptions, "id" | "packageNames"> = {},
): ModuleRolePlugin {
  return {
    id: options.id ?? "tanstack-module-roles",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["@tanstack/react-router"],
    kind: "module-roles",
    classifyModule: classifyTanstackModule,
    moduleEntryExports: tanstackModuleEntryExports,
    classifyImportEdge: classifyTanstackImportEdge,
    isServerOnlyModule: (fileName, classification) =>
      isServerOnlyModulePath(fileName) || classification?.serverOnly === true,
    shouldDiscoverEffectApis: shouldDiscoverTanstackEffectApis,
  };
}

export function tanstackRouterEffectApiProvider(
  options: Pick<TanstackRouterSourceOptions, "id" | "packageNames"> = {},
): EffectApiProvider {
  return {
    id: options.id ?? "tanstack-effect-api",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["@tanstack/react-router"],
    kind: "effect-api",
    discoverEffectApis: discoverTanstackRouteEffectApis,
  };
}

export function tanstackRouterRouteExecutionPlugin(
  options: Pick<TanstackRouterSourceOptions, "id" | "packageNames"> = {},
): RouteExecutionPlugin {
  return createTanstackRouterRouteExecutionPlugin(options);
}

export function tanstackRouterAdapter(
  options: TanstackRouterSourceOptions = {},
): RoutePlugin {
  const historyMaxLen = options.historyMaxLen ?? 4;
  const withHistoryBounds = (
    resolvedOptions: ResolvedOptions,
  ): ResolvedOptions => ({
    ...resolvedOptions,
    bounds: {
      ...resolvedOptions.bounds,
      maxHistory: resolvedOptions.bounds?.maxHistory ?? historyMaxLen,
    },
  });

  return createRoutePlugin({
    id: options.id ?? "tanstack-router",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["@tanstack/react-router"],
    discoverRoutes,
    classifyNavigationCall,
    classifyNavigationJsx,
    routeForComponent,
    locationVars: (inventory, resolvedOptions, lowering) =>
      locationVars(inventory, withHistoryBounds(resolvedOptions), lowering),
    routeTreeVars: (inventory, resolvedOptions) =>
      routeTreeVars(inventory, withHistoryBounds(resolvedOptions)),
    lowerNavigation,
    mountScopeForComponent,
    harness,
  });
}

export { tanstackRouterCacheStorageProvider } from "./cache-provider.js";

import { createRoutePlugin } from "modality-ts/extract/plugins";

export {
  discoverTanstackLoaderCache,
  tanstackLoaderCacheVarId,
} from "./cache.js";
export {
  discoverRoutes,
  parseTanstackCodeRoutes,
  parseTanstackCreateFileRoute,
  routeForComponent,
  tanstackFilePathToPattern,
  tanstackPathToPattern,
} from "./discover.js";
export {
  classifyTanstackModule,
  shouldDiscoverTanstackEffectApis,
  tanstackModuleEntryExports,
} from "./module-roles.js";
export {
  discoverTanstackRouteEffectApis,
  tanstackBeforeLoadOpId,
  tanstackLoaderOpId,
  tanstackRedirectTargetForFile,
} from "./server-effects.js";

export default tanstackRouterAdapter;
