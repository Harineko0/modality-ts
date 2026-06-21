import type {
  RouteActionDescriptor,
  RouteExecutionProvider,
  RouteLoaderDescriptor,
} from "modality-ts/extract/engine/spi";
import { discoverNextServerCacheUsage } from "./server-effects.js";

const AUTH_GUARD_PATTERNS =
  /\b(auth|session|unauthorized|forbidden|getServerSession|getSession|currentUser|requireAuth|assertAuth|isAuthenticated|checkAuth|verifyAuth)\b/i;

export function nextRouteExecutionProvider(
  options: { id?: string; packageNames?: readonly string[] } = {},
): RouteExecutionProvider {
  return {
    id: options.id ?? "next-route-execution",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["next"],
    kind: "route-execution",
    describeRouteExecution(ctx) {
      const filesByPath = new Map(ctx.files.map((file) => [file.path, file]));
      const loaders = ctx.effectApis
        .filter((entry) => entry.opId.startsWith("DATA "))
        .map((entry): RouteLoaderDescriptor | undefined => {
          const routePattern = routePatternFromDataOp(entry.opId);
          if (!routePattern) return undefined;
          const file = filesByPath.get(entry.source.file);
          return {
            id: loaderId(routePattern, entry.opId),
            op: entry.opId,
            routePattern,
            producesDomain: {
              kind: "tokens",
              count: 2,
              names: [`${routePattern}:empty`, `${routePattern}:data`],
            },
            readsResources: [resourceId(routePattern)],
            auto: "mount",
            ...(file?.text && AUTH_GUARD_PATTERNS.test(file.text)
              ? { gated: true }
              : {}),
          };
        })
        .filter((loader): loader is RouteLoaderDescriptor => Boolean(loader));
      const loaderIdsByRoute = new Map(
        loaders.map((loader) => [loader.routePattern, loader.id]),
      );
      const actions = ctx.effectApis
        .filter((entry) => entry.opId.startsWith("ACTION "))
        .map((entry): RouteActionDescriptor => {
          const file = filesByPath.get(entry.source.file);
          const revalidatedRoutes = file
            ? revalidatedRoutePatterns(file.path, file.text)
            : [];
          const effectiveRevalidatedRoutes = revalidatedRoutes.includes("*")
            ? loaders.map((loader) => loader.routePattern)
            : revalidatedRoutes;
          const revalidates =
            effectiveRevalidatedRoutes.length > 0
              ? effectiveRevalidatedRoutes
                  .map((route) => loaderIdsByRoute.get(route))
                  .filter((id): id is string => Boolean(id))
              : [];
          const mutatedRoutes =
            effectiveRevalidatedRoutes.length > 0
              ? effectiveRevalidatedRoutes
              : file?.route?.pattern
                ? [file.route.pattern]
                : loaders.map((loader) => loader.routePattern);
          return {
            id: actionId(entry.opId),
            op: entry.opId,
            mutatesResources: uniqueStrings(mutatedRoutes.map(resourceId)),
            revalidates: uniqueStrings(revalidates),
            outcomes: "success-error",
          };
        });
      const resources = uniqueStrings(
        loaders
          .flatMap((loader) => loader.readsResources)
          .concat(actions.flatMap((action) => action.mutatesResources)),
      ).map((id) => ({
        id,
        domain: {
          kind: "tokens" as const,
          count: 2,
          names: [`${id}:0`, `${id}:1`],
        },
      }));
      return {
        resources,
        loaders,
        actions,
      };
    },
  };
}

function routePatternFromDataOp(opId: string): string | undefined {
  const match = /^DATA\s+\S+\s+(.+)$/.exec(opId);
  return match?.[1];
}

function revalidatedRoutePatterns(
  fileName: string,
  sourceText: string,
): string[] {
  const discovery = discoverNextServerCacheUsage({
    fileName,
    sourceText,
  });
  const routes = discovery.revalidations
    .filter((entry) => entry.kind === "revalidatePath")
    .map((entry) => entry.target);
  if (/\brefresh\s*\(/.test(sourceText)) routes.push("*");
  return uniqueStrings(routes);
}

function resourceId(routePattern: string): string {
  return `next:${routePattern}`;
}

function loaderId(routePattern: string, op: string): string {
  return `next-loader:${routePattern}:${op}`;
}

function actionId(op: string): string {
  return op.replace(/^ACTION\s+/, "next-action:");
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
