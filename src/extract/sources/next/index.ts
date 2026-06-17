import type {
  EffectApiProvider,
  ModuleRoleAdapter,
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
import { discoverNextServerEffectApis } from "./server-effects.js";
import {
  locationVars,
  lowerNextNavigation,
  mountScopeForComponent,
  routeTreeVars,
} from "./routes.js";
export { nextCacheStorageProvider } from "./cache-provider.js";

export interface NextSourceOptions {
  id?: string;
  packageNames?: readonly string[];
  historyMaxLen?: number;
}

export function nextModuleRoleAdapter(
  options: Pick<NextSourceOptions, "id" | "packageNames"> = {},
): ModuleRoleAdapter {
  return {
    id: options.id ?? "next-module-roles",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["next"],
    kind: "module-roles",
    classifyModule: classifyNextModule,
    moduleEntryExports: nextModuleEntryExports,
    classifyImportEdge: classifyNextImportEdge,
    isServerOnlyModule: (fileName, classification) =>
      isNextServerOnlyModule(fileName) || classification?.serverOnly === true,
    shouldDiscoverEffectApis(ctx) {
      return (
        ctx.classification.serverOnly === true ||
        ctx.classification.defaultContext === "server" ||
        ctx.classification.defaultContext === "shared"
      );
    },
  };
}

export function nextEffectApiProvider(
  options: Pick<NextSourceOptions, "id" | "packageNames"> = {},
): EffectApiProvider {
  return {
    id: options.id ?? "next-effect-api",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["next"],
    kind: "effect-api",
    discoverEffectApis: discoverNextServerEffectApis,
  };
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
    locationVars: (inventory, resolvedOptions, lowering) =>
      locationVars(inventory, withHistoryBounds(resolvedOptions), lowering),
    routeTreeVars,
    lowerNavigation: lowerNextNavigation,
    harness,
  };
}

export const nextSource = nextAdapter;

export default nextAdapter;
