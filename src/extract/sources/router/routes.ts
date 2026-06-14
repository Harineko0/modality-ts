import type { ResolvedOptions } from "modality-ts/extract/engine/spi";
import type { AbstractDomain, StateVarDecl } from "modality-ts/core";

export function routeVars(
  routes: readonly string[],
  options: ResolvedOptions,
): readonly StateVarDecl[] {
  const values = uniqueRoutes(routes, options.route);
  const routeDomain: AbstractDomain = { kind: "enum", values };
  return [
    {
      id: "sys:route",
      domain: routeDomain,
      origin: "system",
      scope: { kind: "global" },
      initial: options.route,
    },
    {
      id: "sys:history",
      domain: {
        kind: "boundedList",
        inner: routeDomain,
        maxLen: options.bounds?.maxHistory ?? 4,
      },
      origin: "system",
      scope: { kind: "global" },
      initial: [],
    },
  ];
}

function uniqueRoutes(
  routes: readonly string[],
  initialRoute: string,
): string[] {
  return [...new Set([initialRoute, ...routes])];
}
