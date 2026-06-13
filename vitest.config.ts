import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    globals: false
  },
  resolve: {
    alias: {
      "@modality/kernel": new URL("./packages/kernel/src/index.ts", import.meta.url).pathname,
      "@modality/checker": new URL("./packages/checker/src/index.ts", import.meta.url).pathname,
      "@modality/extraction": new URL("./packages/extraction/src/index.ts", import.meta.url).pathname,
      "@modality/harness": new URL("./packages/harness/src/index.ts", import.meta.url).pathname,
      "@modality/source-swr": new URL("./packages/sources/swr/src/index.ts", import.meta.url).pathname
    }
  }
});
