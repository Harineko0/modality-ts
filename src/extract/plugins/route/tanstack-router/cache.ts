import type {
  EffectIR,
  ExprIR,
  ExtractionCaveat,
  StateVarDecl,
  Transition,
} from "modality-ts/core";
import type {
  CacheStorageDiscoveryCtx,
  RouteInventory,
} from "modality-ts/extract/engine/spi";
import { PENDING_QUEUE_VAR } from "../../../compile/index.js";
import { modelSlackCaveat, staleReadCaveat } from "../../../engine/ts/caveats.js";
import { parseTanstackRouteModule } from "./route-options.js";
import { tanstackLoaderOpId } from "./server-effects.js";

export const TANSTACK_LOADER_CACHE_DOMAIN = [
  "empty",
  "fresh",
  "stale",
  "refreshing",
  "error",
] as const;

export const MAX_TANSTACK_LOADER_CACHE_ROUTES = 16;

export interface TanstackLoaderRoute {
  pattern: string;
  routeId: string;
  fileName: string;
}

export interface TanstackCacheDiscovery {
  loaderRoutes: TanstackLoaderRoute[];
  caveats: ExtractionCaveat[];
  warnings: string[];
}

export function tanstackLoaderCacheVarId(routePattern: string): string {
  const safe =
    routePattern.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") ||
    "root";
  return `sys:tanstack:loader-cache:${safe}`;
}

function normalizedPath(fileName: string): string {
  return fileName.split("\\").join("/");
}

function routePatternForFile(
  fileName: string,
  inventory: RouteInventory | undefined,
): string | undefined {
  if (!inventory) return undefined;
  const resolved = normalizedPath(fileName);
  return inventory.routes.find(
    (node) => node.file && normalizedPath(node.file) === resolved,
  )?.pattern;
}

function safeRouteId(routePattern: string): string {
  return (
    routePattern.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "") ||
    "root"
  );
}

export function discoverTanstackLoaderRoutes(
  files: readonly { fileName: string; sourceText: string }[],
  inventory?: RouteInventory,
): TanstackCacheDiscovery {
  const loaderRoutes: TanstackLoaderRoute[] = [];
  const caveats: ExtractionCaveat[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const routeModule = parseTanstackRouteModule(
      file.sourceText,
      file.fileName,
    );
    if (!routeModule?.hasLoader) continue;
    const pattern =
      routeModule.routePath ??
      routePatternForFile(file.fileName, inventory) ??
      undefined;
    if (!pattern) {
      warnings.push(
        `Skipped TanStack loader cache for ${file.fileName}: missing route pattern`,
      );
      continue;
    }
    loaderRoutes.push({
      pattern,
      routeId: safeRouteId(pattern),
      fileName: file.fileName,
    });
  }

  loaderRoutes.sort((left, right) => left.pattern.localeCompare(right.pattern));
  return { loaderRoutes, caveats, warnings };
}

export function selectTanstackLoaderCacheRoutes(
  discovery: TanstackCacheDiscovery,
  currentRoute: string,
): {
  routes: TanstackLoaderRoute[];
  caveats: ExtractionCaveat[];
  warnings: string[];
} {
  if (discovery.loaderRoutes.length <= MAX_TANSTACK_LOADER_CACHE_ROUTES) {
    return {
      routes: discovery.loaderRoutes,
      caveats: discovery.caveats,
      warnings: discovery.warnings,
    };
  }

  const selected = new Map<string, TanstackLoaderRoute>();
  const current = discovery.loaderRoutes.find(
    (route) => route.pattern === currentRoute,
  );
  if (current) selected.set(current.pattern, current);

  for (const route of discovery.loaderRoutes) {
    if (selected.size >= MAX_TANSTACK_LOADER_CACHE_ROUTES) break;
    selected.set(route.pattern, route);
  }

  const skipped = discovery.loaderRoutes.filter(
    (route) => !selected.has(route.pattern),
  );
  const caveats = [
    ...discovery.caveats,
    modelSlackCaveat(
      "tanstack-loader-cache:reduction",
      `Reduced TanStack loader cache vars to ${selected.size} routes (${skipped.length} loader routes skipped)`,
      undefined,
      "over-approx",
    ),
  ];
  const warnings = [
    ...discovery.warnings,
    `Reduced TanStack loader cache vars to ${selected.size} of ${discovery.loaderRoutes.length} loader routes`,
  ];

  return {
    routes: [...selected.values()].sort((left, right) =>
      left.pattern.localeCompare(right.pattern),
    ),
    caveats,
    warnings,
  };
}

function assignLit(varId: string, value: string): EffectIR {
  return {
    kind: "assign",
    var: varId,
    expr: { kind: "lit", value },
  };
}

function cacheIs(varId: string, state: string): ExprIR {
  return {
    kind: "eq",
    args: [
      { kind: "read", var: varId },
      { kind: "lit", value: state },
    ],
  };
}

function loaderCacheTransitions(route: TanstackLoaderRoute): Transition[] {
  const varId = tanstackLoaderCacheVarId(route.pattern);
  const loaderOp = tanstackLoaderOpId(route.pattern);
  const base = `tanstack:loader-cache:${route.routeId}`;
  return [
    {
      id: `${base}:resolve:success`,
      cls: "env",
      label: { kind: "resolve", op: loaderOp, outcome: "success" },
      source: [],
      guard: {
        kind: "eq",
        args: [
          { kind: "read", var: PENDING_QUEUE_VAR, path: ["0", "opId"] },
          { kind: "lit", value: loaderOp },
        ],
      },
      effect: {
        kind: "seq",
        effects: [{ kind: "dequeue", index: 0 }, assignLit(varId, "fresh")],
      },
      reads: [PENDING_QUEUE_VAR],
      writes: [PENDING_QUEUE_VAR, varId],
      confidence: "exact",
    },
    {
      id: `${base}:resolve:error`,
      cls: "env",
      label: { kind: "resolve", op: loaderOp, outcome: "error" },
      source: [],
      guard: {
        kind: "eq",
        args: [
          { kind: "read", var: PENDING_QUEUE_VAR, path: ["0", "opId"] },
          { kind: "lit", value: loaderOp },
        ],
      },
      effect: {
        kind: "seq",
        effects: [{ kind: "dequeue", index: 0 }, assignLit(varId, "error")],
      },
      reads: [PENDING_QUEUE_VAR],
      writes: [PENDING_QUEUE_VAR, varId],
      confidence: "exact",
    },
    {
      id: `${base}:stale`,
      cls: "env",
      label: { kind: "internal", text: `stale ${route.pattern} loader cache` },
      source: [],
      guard: cacheIs(varId, "fresh"),
      effect: assignLit(varId, "stale"),
      reads: [varId],
      writes: [varId],
      confidence: "over-approx",
    },
    {
      id: `${base}:revalidate`,
      cls: "env",
      label: {
        kind: "internal",
        text: `revalidate ${route.pattern} loader cache`,
      },
      source: [],
      guard: cacheIs(varId, "stale"),
      effect: {
        kind: "seq",
        effects: [
          assignLit(varId, "refreshing"),
          {
            kind: "enqueue",
            op: loaderOp,
            continuation: `${base}:resolve`,
            args: {},
          },
        ],
      },
      reads: [varId],
      writes: [varId, PENDING_QUEUE_VAR],
      confidence: "over-approx",
    },
  ];
}

export function createTanstackLoaderCacheFragment(
  routes: readonly TanstackLoaderRoute[],
  caveats: readonly ExtractionCaveat[] = [],
): {
  vars: StateVarDecl[];
  transitions: Transition[];
  caveats: ExtractionCaveat[];
} {
  const vars = routes.map((route) => ({
    id: tanstackLoaderCacheVarId(route.pattern),
    domain: {
      kind: "enum" as const,
      values: [...TANSTACK_LOADER_CACHE_DOMAIN],
    },
    origin: "system" as const,
    scope: { kind: "global" as const },
    role: { kind: "cache-entry" as const },
    initial: "empty",
  }));

  const transitions = routes.flatMap((route) => loaderCacheTransitions(route));
  const mergedCaveats = [
    ...caveats,
    ...routes.map((route) =>
      staleReadCaveat(tanstackLoaderCacheVarId(route.pattern), {
        file: route.fileName,
        line: 1,
        column: 1,
      }),
    ),
    modelSlackCaveat(
      "tanstack-loader-cache:approximation",
      "TanStack route loader cache uses bounded stale/revalidate/error approximations",
      undefined,
      "over-approx",
    ),
  ];

  return { vars, transitions, caveats: mergedCaveats };
}

export function discoverTanstackLoaderCache(ctx: CacheStorageDiscoveryCtx): {
  vars: StateVarDecl[];
  transitions: Transition[];
  caveats: ExtractionCaveat[];
  warnings: string[];
} {
  const discovery = discoverTanstackLoaderRoutes(
    ctx.files.map((file) => ({
      fileName: file.path,
      sourceText: file.text,
    })),
    ctx.inventory,
  );
  const selected = selectTanstackLoaderCacheRoutes(
    discovery,
    ctx.options.route,
  );
  const fragment = createTanstackLoaderCacheFragment(
    selected.routes,
    selected.caveats,
  );
  return {
    vars: fragment.vars,
    transitions: fragment.transitions,
    caveats: fragment.caveats,
    warnings: selected.warnings,
  };
}
