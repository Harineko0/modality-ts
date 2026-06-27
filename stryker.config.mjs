/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  plugins: [
    "@stryker-mutator/vitest-runner",
    "@stryker-mutator/typescript-checker",
  ],
  testRunner: "vitest",
  checkers: ["typescript"],
  coverageAnalysis: "all",
  incremental: true,
  incrementalFile: ".modality/mutation/stryker-incremental.json",
  tempDirName: ".modality/mutation/.stryker-tmp",
  cleanTempDir: "always",
  concurrency: "50%",
  ignorePatterns: [
    "/.modality",
    "/benchmarks",
    "/dist",
    "/docs/.docusaurus",
    "/docs/build",
    "/target",
  ],
  reporters: ["clear-text", "json", "html"],
  jsonReporter: {
    fileName: ".modality/mutation/mutation.json",
  },
  htmlReporter: {
    fileName: ".modality/mutation/mutation.html",
  },
  thresholds: {
    high: 80,
    low: 80,
    break: 80,
  },
  mutate: [
    "src/**/*.ts",
    "!src/**/*.test.ts",
    "!src/**/*.d.ts",
  ],
  vitest: {
    configFile: "vitest.mutation.config.ts",
    related: false,
  },
  typescriptChecker: {
    prioritizePerformanceOverAccuracy: true,
  },
};
