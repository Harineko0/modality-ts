import type {
  RouteExecutionProvider,
  RouteLoaderDescriptor,
} from "modality-ts/extract/engine/spi";

export function tanstackRouterRouteExecutionProvider(
  options: { id?: string; packageNames?: readonly string[] } = {},
): RouteExecutionProvider {
  return {
    id: options.id ?? "tanstack-route-execution",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["@tanstack/react-router"],
    kind: "route-execution",
    describeRouteExecution(ctx) {
      const loaders = ctx.effectApis
        .filter((entry) => entry.opId.startsWith("LOADER "))
        .map((entry): RouteLoaderDescriptor | undefined => {
          const routePattern = routePatternFromLoaderOp(entry.opId);
          if (!routePattern) return undefined;
          return {
            id: loaderId(routePattern),
            op: entry.opId,
            routePattern,
            producesDomain: {
              kind: "tokens",
              count: 2,
              names: [`${routePattern}:empty`, `${routePattern}:data`],
            },
            readsResources: [resourceId(routePattern)],
            auto: "mount",
          };
        })
        .filter((loader): loader is RouteLoaderDescriptor => Boolean(loader));
      return {
        resources: uniqueStrings(
          loaders.flatMap((loader) => loader.readsResources),
        ).map((id) => ({
          id,
          domain: {
            kind: "tokens" as const,
            count: 2,
            names: [`${id}:0`, `${id}:1`],
          },
        })),
        loaders,
        actions: [],
      };
    },
  };
}

function routePatternFromLoaderOp(op: string): string | undefined {
  const prefix = "LOADER ";
  return op.startsWith(prefix) ? op.slice(prefix.length) : undefined;
}

function resourceId(routePattern: string): string {
  return `tanstack:${routePattern}`;
}

function loaderId(routePattern: string): string {
  return `tanstack-loader:${routePattern}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
