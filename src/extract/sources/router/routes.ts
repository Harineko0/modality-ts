import type {
  LocationLowering,
  ResolvedOptions,
  RouteInventory,
} from "modality-ts/extract/engine/spi";
import type { AbstractDomain, StateVarDecl } from "modality-ts/core";

export function locationVars(
  inventory: RouteInventory,
  options: ResolvedOptions,
  lowering: LocationLowering,
): readonly StateVarDecl[] {
  const uiPatterns = inventory.routes
    .filter((node) => node.kind === "page" || node.kind === "index")
    .map((node) => node.pattern);
  const routeValues = uniqueRoutes([
    options.route,
    ...uiPatterns,
    ...lowering.pushTargets,
  ]);
  const routeDomain: AbstractDomain = { kind: "enum", values: routeValues };

  const historyRoutes = clampToRouteDomain(
    lowering.hasUnboundPush
      ? routeValues
      : uniqueRoutes([
          options.route,
          ...lowering.pushTargets,
          ...lowering.pushOrigins,
        ]),
    routeValues,
  );

  return [
    {
      id: "sys:route",
      domain: routeDomain,
      origin: "system",
      scope: { kind: "global" },
      role: { kind: "location-current", group: "default" },
      initial: options.route,
    },
    {
      id: "sys:history",
      domain: {
        kind: "boundedList",
        inner: { kind: "enum", values: historyRoutes },
        maxLen: options.bounds?.maxHistory ?? 4,
      },
      origin: "system",
      scope: { kind: "global" },
      role: { kind: "location-history", group: "default" },
      initial: [],
    },
  ];
}

function clampToRouteDomain(
  historyRoutes: readonly string[],
  routeValues: readonly string[],
): string[] {
  const allowed = new Set(routeValues);
  return uniqueRoutes(historyRoutes.filter((route) => allowed.has(route)));
}

function uniqueRoutes(routes: readonly string[]): string[] {
  return [...new Set(routes)];
}
