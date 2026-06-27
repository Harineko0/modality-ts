import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      exclude: [
        "src/cli/features/extract/command.run.test.ts",
        "test/benchmarks/**",
        "test/modality/**",
        "test/canaries/**",
        "test/conformance/**",
        "test/validity/**",
      ],
    },
  }),
);
