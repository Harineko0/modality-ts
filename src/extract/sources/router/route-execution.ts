import type {
  RouteActionDescriptor,
  RouteExecutionProvider,
  RouteLoaderDescriptor,
} from "modality-ts/extract/engine/spi";

const AUTH_GUARD_PATTERNS =
  /\b(auth|session|unauthorized|forbidden|getSession|currentUser|requireAuth|assertAuth|isAuthenticated|checkAuth|verifyAuth)\b/i;

export function reactRouterRouteExecutionProvider(
  options: { id?: string; packageNames?: readonly string[] } = {},
): RouteExecutionProvider {
  return {
    id: options.id ?? "router-route-execution",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["react-router", "react-router-dom"],
    kind: "route-execution",
    describeRouteExecution(ctx) {
      const filesByPath = new Map(ctx.files.map((file) => [file.path, file]));
      const loaders = ctx.effectApis
        .filter((entry) => entry.opId.startsWith("DATA "))
        .map((entry): RouteLoaderDescriptor | undefined => {
          const routePattern = routePatternFromOp(entry.opId, "DATA");
          if (!routePattern) return undefined;
          const file = filesByPath.get(entry.source.file);
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
            ...(file?.text && AUTH_GUARD_PATTERNS.test(file.text)
              ? { gated: true }
              : {}),
          };
        })
        .filter((loader): loader is RouteLoaderDescriptor => Boolean(loader));
      const loaderIds = loaders.map((loader) => loader.id);
      const actions = ctx.effectApis
        .filter((entry) => entry.opId.startsWith("ACTION "))
        .map((entry): RouteActionDescriptor | undefined => {
          const routePattern = routePatternFromOp(entry.opId, "ACTION");
          if (!routePattern) return undefined;
          return {
            id: actionId(routePattern),
            op: entry.opId,
            mutatesResources: [resourceId(routePattern)],
            revalidates: loaderIds,
            outcomes: "success-error",
          };
        })
        .filter((action): action is RouteActionDescriptor => Boolean(action));
      const resources = uniqueStrings([
        ...loaders.flatMap((loader) => loader.readsResources),
        ...actions.flatMap((action) => action.mutatesResources),
      ]).map((id) => ({
        id,
        domain: {
          kind: "tokens" as const,
          count: 2,
          names: [`${id}:0`, `${id}:1`],
        },
      }));
      return { resources, loaders, actions };
    },
  };
}

function routePatternFromOp(
  op: string,
  prefix: "ACTION" | "DATA",
): string | undefined {
  const expected = `${prefix} `;
  return op.startsWith(expected) ? op.slice(expected.length) : undefined;
}

function resourceId(routePattern: string): string {
  return `router:${routePattern}`;
}

function loaderId(routePattern: string): string {
  return `router-loader:${routePattern}`;
}

function actionId(routePattern: string): string {
  return `router-action:${routePattern}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
