import type {
  CacheStorageDiscoveryCtx,
  CacheStorageFragment,
  CacheStorageProvider,
} from "modality-ts/extract/engine/spi";
import { discoverNextCacheFromSources } from "./cache.js";

export function nextCacheStorageProvider(
  options: { id?: string; packageNames?: readonly string[] } = {},
): CacheStorageProvider {
  return {
    id: options.id ?? "next-cache-storage",
    version: "0.1.0",
    packageNames: options.packageNames ?? ["next"],
    kind: "cache-storage",
    discoverCacheStorage(ctx: CacheStorageDiscoveryCtx): CacheStorageFragment {
      const result = discoverNextCacheFromSources(
        ctx.files.map((file) => ({
          fileName: file.path,
          sourceText: file.text,
        })),
        ctx.inventory,
      );
      return {
        vars: result.vars,
        transitions: result.transitions,
        caveats: result.caveats,
        warnings: result.warnings,
      };
    },
  };
}
