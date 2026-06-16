import type {
  NavigationAdapter,
  ResolvedOptions,
} from "modality-ts/extract/engine/spi";
import { discoverRoutes, routeForComponent } from "./discover.js";
import * as harness from "./harness.js";
import {
  classifyNextImportEdge,
  classifyNextModule,
  isNextServerOnlyModule,
  nextModuleEntryExports,
} from "./module-roles.js";
import { classifyNavigationCall, classifyNavigationJsx } from "./navigation.js";
import {
  locationVars,
  lowerNextNavigation,
  mountScopeForComponent,
  routeTreeVars,
} from "./routes.js";

export interface NextSourceOptions {
  id?: string;
  packageNames?: readonly string[];
  historyMaxLen?: number;
}

export function nextAdapter(
  options: NextSourceOptions = {},
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
    id: options.id ?? "next",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["next"],
    discoverRoutes,
    classifyNavigationCall,
    classifyNavigationJsx,
    routeForComponent,
    mountScopeForComponent,
    classifyModule: classifyNextModule,
    moduleEntryExports: nextModuleEntryExports,
    classifyImportEdge: classifyNextImportEdge,
    isServerOnlyModule: isNextServerOnlyModule,
    locationVars: (inventory, resolvedOptions, lowering) =>
      locationVars(inventory, withHistoryBounds(resolvedOptions), lowering),
    routeTreeVars,
    lowerNavigation: lowerNextNavigation,
    harness,
  };
}

export const nextSource = nextAdapter;

export default nextAdapter;
