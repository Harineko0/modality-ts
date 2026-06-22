import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globals: false,
    testTimeout: 60_000,
    setupFiles: ["./test/setup/framework-default.ts"],
    pool: "threads",
    poolOptions: {
      threads: {
        minWorkers: 1,
        maxWorkers: 4,
      },
    },
  },
  resolve: {
    alias: {
      "modality-ts/core/props": new URL(
        "./src/core/props/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/properties": new URL(
        "./src/core/props/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/vars": new URL("./src/core/props/vars.ts", import.meta.url)
        .pathname,
      "modality-ts/core": new URL("./src/core/index.ts", import.meta.url)
        .pathname,
      "modality-ts/check": new URL("./src/check/index.ts", import.meta.url)
        .pathname,
      "modality-ts/cli/harness": new URL(
        "./src/cli/harness/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/cli/runtime": new URL(
        "./src/cli/runtime/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/jotai/harness": new URL(
        "./src/extract/sources/jotai/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/jotai": new URL(
        "./src/extract/sources/jotai/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/next/harness": new URL(
        "./src/extract/sources/next/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/next": new URL(
        "./src/extract/sources/next/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/router/harness": new URL(
        "./src/extract/sources/router/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/router": new URL(
        "./src/extract/sources/router/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/tanstack-router/harness": new URL(
        "./src/extract/sources/tanstack-router/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/tanstack-router": new URL(
        "./src/extract/sources/tanstack-router/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/swr/harness": new URL(
        "./src/extract/sources/swr/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/swr": new URL(
        "./src/extract/sources/swr/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/tanstack-query/harness": new URL(
        "./src/extract/sources/tanstack-query/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/tanstack-query": new URL(
        "./src/extract/sources/tanstack-query/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/use-state/harness": new URL(
        "./src/extract/sources/use-state/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/use-state": new URL(
        "./src/extract/sources/use-state/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/zustand/harness": new URL(
        "./src/extract/sources/zustand/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/zustand": new URL(
        "./src/extract/sources/zustand/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/react-hook-form": new URL(
        "./src/extract/sources/react-hook-form/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/redux/harness": new URL(
        "./src/extract/sources/redux/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/sources/redux": new URL(
        "./src/extract/sources/redux/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/type-libraries/zod": new URL(
        "./src/extract/type-libraries/zod/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/type-libraries/arktype": new URL(
        "./src/extract/type-libraries/arktype/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/engine/pipeline": new URL(
        "./src/extract/engine/pipeline/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/engine/spi": new URL(
        "./src/extract/engine/spi/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/frameworks/react": new URL(
        "./src/extract/frameworks/react/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/engine": new URL(
        "./src/extract/engine/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract": new URL("./src/extract/index.ts", import.meta.url)
        .pathname,
    },
  },
});
