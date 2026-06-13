import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globals: false
  },
  resolve: {
    alias: {
      "modality-ts/kernel/props": new URL("./src/kernel/props/index.ts", import.meta.url).pathname,
      "modality-ts/kernel": new URL("./src/kernel/index.ts", import.meta.url).pathname,
      "modality-ts/checker": new URL("./src/checker/index.ts", import.meta.url).pathname,
      "modality-ts/extraction/spi": new URL("./src/extraction/spi/index.ts", import.meta.url).pathname,
      "modality-ts/extraction": new URL("./src/extraction/index.ts", import.meta.url).pathname,
      "modality-ts/harness": new URL("./src/harness/index.ts", import.meta.url).pathname,
      "modality-ts/source-jotai": new URL("./src/sources/jotai/index.ts", import.meta.url).pathname,
      "modality-ts/source-jotai/harness": new URL("./src/sources/jotai/harness.ts", import.meta.url).pathname,
      "modality-ts/source-router": new URL("./src/sources/router/index.ts", import.meta.url).pathname,
      "modality-ts/source-router/harness": new URL("./src/sources/router/harness.ts", import.meta.url).pathname,
      "modality-ts/source-swr": new URL("./src/sources/swr/index.ts", import.meta.url).pathname,
      "modality-ts/source-swr/harness": new URL("./src/sources/swr/harness.ts", import.meta.url).pathname,
      "modality-ts/source-use-state": new URL("./src/sources/use-state/index.ts", import.meta.url).pathname,
      "modality-ts/source-use-state/harness": new URL("./src/sources/use-state/harness.ts", import.meta.url).pathname
    }
  }
});
