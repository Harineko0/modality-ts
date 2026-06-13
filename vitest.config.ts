import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    globals: false
  },
  resolve: {
    alias: {
      "modality-ts/kernel/props": new URL("./packages/kernel/src/props/index.ts", import.meta.url).pathname,
      "modality-ts/kernel": new URL("./packages/kernel/src/index.ts", import.meta.url).pathname,
      "modality-ts/checker": new URL("./packages/checker/src/index.ts", import.meta.url).pathname,
      "modality-ts/extraction/spi": new URL("./packages/extraction/src/spi/index.ts", import.meta.url).pathname,
      "modality-ts/extraction": new URL("./packages/extraction/src/index.ts", import.meta.url).pathname,
      "modality-ts/harness": new URL("./packages/harness/src/index.ts", import.meta.url).pathname,
      "modality-ts/source-jotai": new URL("./packages/sources/jotai/src/index.ts", import.meta.url).pathname,
      "modality-ts/source-router": new URL("./packages/sources/router/src/index.ts", import.meta.url).pathname,
      "modality-ts/source-swr": new URL("./packages/sources/swr/src/index.ts", import.meta.url).pathname,
      "modality-ts/source-use-state": new URL("./packages/sources/use-state/src/index.ts", import.meta.url).pathname
    }
  }
});
