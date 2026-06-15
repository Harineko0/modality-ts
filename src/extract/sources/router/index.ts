import type {
  NavigationAdapter,
  ResolvedOptions,
} from "modality-ts/extract/engine/spi";
import { discoverRoutes, routeForComponent } from "./discover.js";
import * as harness from "./harness.js";
import { classifyNavigationCall, classifyNavigationJsx } from "./navigation.js";
import { locationVars } from "./routes.js";

export interface RouterSourceOptions {
  id?: string;
  packageNames?: readonly string[];
  historyMaxLen?: number;
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
    harness,
  };
}

/** @deprecated use reactRouterAdapter */
export const routerSource = reactRouterAdapter;

export { parseReactRouterRoutes } from "./discover.js";
export { synthesizeRedirectTransitions } from "./redirects.js";

export default reactRouterAdapter;
