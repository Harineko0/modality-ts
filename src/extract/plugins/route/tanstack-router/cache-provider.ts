import type {
  CacheStorageDiscoveryCtx,
  CacheStorageFragment,
  CacheStorageProvider,
} from "modality-ts/extract/engine/spi";
import { discoverTanstackLoaderCache } from "./cache.js";

export function tanstackRouterCacheStorageProvider(
  options: { id?: string; packageNames?: readonly string[] } = {},
): CacheStorageProvider {
  return {
    id: options.id ?? "tanstack-cache-storage",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["@tanstack/react-router"],
    kind: "cache-storage",
    discoverCacheStorage(ctx: CacheStorageDiscoveryCtx): CacheStorageFragment {
      const result = discoverTanstackLoaderCache(ctx);
      return {
        vars: result.vars,
        transitions: result.transitions,
        caveats: result.caveats,
        warnings: result.warnings,
      };
    },
  };
}
