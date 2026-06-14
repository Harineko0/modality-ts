import type {
  RouterPlugin,
  ResolvedOptions,
} from "modality-ts/extract/engine/spi";
import type { AbstractDomain, StateVarDecl } from "modality-ts/core";
import * as harness from "./harness.js";

export interface RouterSourceOptions {
  id?: string;
  packageNames?: readonly string[];
  historyMaxLen?: number;
}

export function routerSource(options: RouterSourceOptions = {}): RouterPlugin {
  const historyMaxLen = options.historyMaxLen ?? 4;
  return {
    id: options.id ?? "router",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["react-router", "react-router-dom"],
    routeVars: (routes, resolvedOptions) =>
      routeVars(routes, {
        ...resolvedOptions,
        bounds: {
          ...resolvedOptions.bounds,
          maxHistory: resolvedOptions.bounds?.maxHistory ?? historyMaxLen,
        },
      }),
    navigationCall,
    harness,
  };
}

export default routerSource;

function routeVars(
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

function navigationCall(
  callee: string,
  args: readonly unknown[],
): { mode: "push" | "replace" | "back"; to?: string } | "unsupported" {
  if (callee === "navigate" && args.length === 1 && typeof args[0] === "string")
    return { mode: "push", to: args[0] };
  if (
    (callee.endsWith(".push") || callee.endsWith(".replace")) &&
    args.length === 1 &&
    typeof args[0] === "string"
  ) {
    return {
      mode: callee.endsWith(".replace") ? "replace" : "push",
      to: args[0],
    };
  }
  if (callee.endsWith(".back") && args.length === 0) return { mode: "back" };
  return "unsupported";
}

function uniqueRoutes(
  routes: readonly string[],
  initialRoute: string,
): string[] {
  return [...new Set([initialRoute, ...routes])];
}
