import type {
  EffectApiProvider,
  ModuleRoleAdapter,
  NavigationAdapter,
  ResolvedOptions,
  RouteExecutionProvider,
} from "modality-ts/extract/engine/spi";
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
import { reactRouterRouteExecutionProvider as createReactRouterRouteExecutionProvider } from "./route-execution.js";
import { discoverReactRouterActionEffectApis } from "./server-effects.js";
import { locationVars } from "./routes.js";

export interface RouterSourceOptions {
  id?: string;
  packageNames?: readonly string[];
  historyMaxLen?: number;
}

export function reactRouterModuleRoleAdapter(
  options: Pick<RouterSourceOptions, "id" | "packageNames"> = {},
): ModuleRoleAdapter {
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

export function reactRouterRouteExecutionProvider(
  options: Pick<RouterSourceOptions, "id" | "packageNames"> = {},
): RouteExecutionProvider {
  return createReactRouterRouteExecutionProvider(options);
}

export function reactRouterAdapter(
  options: RouterSourceOptions = {},
): NavigationAdapter {
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

  return {
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
  };
}

export { parseReactRouterRoutes } from "./discover.js";

export default reactRouterAdapter;
