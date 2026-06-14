import type { RouterPlugin } from "modality-ts/extract/engine/spi";
import * as harness from "./harness.js";
import { navigationCall } from "./navigation.js";
import { routeVars } from "./routes.js";

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
