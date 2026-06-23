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
      "modality-ts/cli/registry": new URL(
        "./src/cli/registry/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/cli/runtime": new URL(
        "./src/cli/runtime/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/state/jotai/harness": new URL(
        "./src/extract/plugins/state/jotai/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/state/jotai": new URL(
        "./src/extract/plugins/state/jotai/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/route/next/harness": new URL(
        "./src/extract/plugins/route/next/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/route/next": new URL(
        "./src/extract/plugins/route/next/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/route/router/harness": new URL(
        "./src/extract/plugins/route/router/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/route/router": new URL(
        "./src/extract/plugins/route/router/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/route/tanstack-router/harness": new URL(
        "./src/extract/plugins/route/tanstack-router/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/route/tanstack-router": new URL(
        "./src/extract/plugins/route/tanstack-router/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/state/swr/harness": new URL(
        "./src/extract/plugins/state/swr/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/state/swr": new URL(
        "./src/extract/plugins/state/swr/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/state/tanstack-query/harness": new URL(
        "./src/extract/plugins/state/tanstack-query/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/state/tanstack-query": new URL(
        "./src/extract/plugins/state/tanstack-query/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/state/use-state/harness": new URL(
        "./src/extract/plugins/state/use-state/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/state/use-state": new URL(
        "./src/extract/plugins/state/use-state/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/state/zustand/harness": new URL(
        "./src/extract/plugins/state/zustand/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/state/zustand": new URL(
        "./src/extract/plugins/state/zustand/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/framework/react-hook-form/unwrap": new URL(
        "./src/extract/plugins/framework/react-hook-form/unwrap.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/framework/react-hook-form": new URL(
        "./src/extract/plugins/framework/react-hook-form/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/state/redux/harness": new URL(
        "./src/extract/plugins/state/redux/harness.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/state/redux": new URL(
        "./src/extract/plugins/state/redux/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/type/zod": new URL(
        "./src/extract/plugins/type/zod/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/type/arktype": new URL(
        "./src/extract/plugins/type/arktype/index.ts",
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
      "modality-ts/extract/lang/ts": new URL(
        "./src/extract/lang/ts/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/compile": new URL(
        "./src/extract/compile/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/framework/react": new URL(
        "./src/extract/plugins/framework/react/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/effect/timers": new URL(
        "./src/extract/plugins/effect/timers/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/effect/websocket": new URL(
        "./src/extract/plugins/effect/websocket/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins/effect": new URL(
        "./src/extract/plugins/effect/index.ts",
        import.meta.url,
      ).pathname,
      "modality-ts/extract/plugins": new URL(
        "./src/extract/plugins/index.ts",
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
