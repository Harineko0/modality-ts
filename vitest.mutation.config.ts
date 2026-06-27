import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      include: [
        "src/core/**/*.test.ts",
        "src/extract/**/*.test.ts",
        "test/compile/**/*.test.ts",
        "test/core/**/*.test.ts",
        "test/effect-models/**/*.test.ts",
        "test/extract/**/*.test.ts",
        "test/extraction/**/*.test.ts",
        "test/frameworks/**/*.test.ts",
        "test/kernel/**/*.test.ts",
        "test/lang/**/*.test.ts",
        "test/runtime/**/*.test.ts",
        "test/sources/**/*.test.ts",
      ],
      exclude: [
        "test/benchmarks/**",
        "test/modality/**",
        "test/canaries/**",
        "test/conformance/**",
        "test/validity/**",
      ],
    },
  }),
);
