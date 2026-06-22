import type {
  EffectApiProvider,
  ModuleRolePlugin,
  ResolvedOptions,
  RouteExecutionPlugin,
  RoutePlugin,
} from "modality-ts/extract/engine/spi";
import { createRoutePlugin } from "modality-ts/extract/plugins";
import { discoverRoutes, routeForComponent } from "./discover.js";
import {
  recognizeFormSubmit,
  recognizeUseSubmitHandler,
} from "./form-submit.js";
import * as harness from "./harness.js";
import {
  classifyReactRouterImportEdge,
  classifyReactRouterModule,
  isServerOnlyModulePath,
  reactRouterModuleEntryExports,
} from "./module-roles.js";
import { classifyNavigationCall, classifyNavigationJsx } from "./navigation.js";
import { reactRouterRouteExecutionPlugin as createReactRouterRouteExecutionPlugin } from "./route-execution.js";
import { locationVars } from "./routes.js";
import { discoverReactRouterActionEffectApis } from "./server-effects.js";

export interface RouterSourceOptions {
  id?: string;
  packageNames?: readonly string[];
  historyMaxLen?: number;
}

export function reactRouterModuleRolePlugin(
  options: Pick<RouterSourceOptions, "id" | "packageNames"> = {},
): ModuleRolePlugin {
  return {
    id: options.id ?? "router-module-roles",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["react-router", "react-router-dom"],
    kind: "module-roles",
    classifyModule: classifyReactRouterModule,
    moduleEntryExports: reactRouterModuleEntryExports,
    classifyImportEdge: classifyReactRouterImportEdge,
    isServerOnlyModule: (fileName, classification) =>
      isServerOnlyModulePath(fileName) || classification?.serverOnly === true,
    shouldDiscoverEffectApis(ctx) {
      return (
        ctx.classification.serverOnly === true ||
        ctx.classification.defaultContext === "server" ||
        (ctx.classification.defaultContext === "shared" &&
          ctx.entryExports.some((entry) => entry.context === "server"))
      );
    },
  };
}

export function reactRouterEffectApiProvider(
  options: Pick<RouterSourceOptions, "id" | "packageNames"> = {},
): EffectApiProvider {
  return {
    id: options.id ?? "router-effect-api",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["react-router", "react-router-dom"],
    kind: "effect-api",
    discoverEffectApis: discoverReactRouterActionEffectApis,
  };
}

export function reactRouterRouteExecutionPlugin(
  options: Pick<RouterSourceOptions, "id" | "packageNames"> = {},
): RouteExecutionPlugin {
  return createReactRouterRouteExecutionPlugin(options);
}

export function reactRouterAdapter(
  options: RouterSourceOptions = {},
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
    id: options.id ?? "router",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["react-router", "react-router-dom"],
    discoverRoutes,
    classifyNavigationCall,
    classifyNavigationJsx,
    routeForComponent,
    locationVars: (inventory, resolvedOptions, lowering) =>
      locationVars(inventory, withHistoryBounds(resolvedOptions), lowering),
    recognizeFormSubmit,
    recognizeUseSubmitHandler,
    harness,
  });
}

export { parseReactRouterRoutes } from "./discover.js";

export default reactRouterAdapter;
