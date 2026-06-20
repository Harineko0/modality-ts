import type {
  NavigationAdapter,
  ResolvedOptions,
} from "modality-ts/extract/engine/spi";
import { discoverRoutes, routeForComponent } from "./discover.js";
import * as harness from "./harness.js";
import { classifyNavigationCall, classifyNavigationJsx } from "./navigation.js";
import {
  locationVars,
  lowerNavigation,
  mountScopeForComponent,
  routeTreeVars,
} from "./routes.js";

export interface TanstackRouterSourceOptions {
  id?: string;
  packageNames?: readonly string[];
  historyMaxLen?: number;
}

export function tanstackRouterAdapter(
  options: TanstackRouterSourceOptions = {},
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
  };
}

export {
  discoverRoutes,
  parseTanstackCodeRoutes,
  parseTanstackCreateFileRoute,
  routeForComponent,
  tanstackFilePathToPattern,
  tanstackPathToPattern,
} from "./discover.js";

export default tanstackRouterAdapter;
