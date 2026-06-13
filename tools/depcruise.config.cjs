module.exports = {
  forbidden: [
    {
      name: "kernel-is-stable-core",
      severity: "error",
      from: { path: "^packages/kernel/src" },
      to: { path: "^packages/(checker|extraction|harness|runtime|sources|modality)/src" }
    },
    {
      name: "checker-depends-only-on-kernel",
      severity: "error",
      from: { path: "^packages/checker/src" },
      to: { path: "^packages/(extraction|harness|runtime|sources|modality)/src" }
    },
    {
      name: "extraction-is-node-only-and-independent",
      severity: "error",
      from: { path: "^packages/extraction/src" },
      to: { path: "^packages/(checker|harness|runtime|sources|modality)/src" }
    },
    {
      name: "harness-does-not-import-product-or-analysis",
      severity: "error",
      from: { path: "^packages/harness/src" },
      to: { path: "^packages/(checker|extraction|runtime|sources|modality)/src" }
    },
    {
      name: "runtime-stays-kernel-light",
      severity: "error",
      from: { path: "^packages/runtime/src" },
      to: { path: "^packages/(checker|extraction|harness|sources|modality)/src" }
    },
    {
      name: "runtime-imports-kernel-props-subpath-only",
      severity: "error",
      from: { path: "^packages/runtime/src" },
      to: { path: "^packages/kernel/src/(?!props/)" }
    },
    {
      name: "source-slices-do-not-import-product-or-peers",
      severity: "error",
      from: { path: "^packages/sources/[^/]+/src" },
      to: { path: "^packages/(checker|runtime|modality)/src" }
    },
    {
      name: "source-slices-use-extraction-spi-only",
      severity: "error",
      from: { path: "^packages/sources/[^/]+/src" },
      to: {
        path: "^packages/extraction/src/(?!spi/)"
      }
    },
    {
      name: "source-slices-are-independent",
      severity: "error",
      from: { path: "^packages/sources/([^/]+)/src" },
      to: { path: "^packages/sources/([^/]+)/src", pathNot: "^packages/sources/$1/src" }
    },
    {
      name: "modality-feature-slices-do-not-import-each-other",
      severity: "error",
      from: { path: "^packages/modality/src/features/([^/]+)/" },
      to: { path: "^packages/modality/src/features/([^/]+)/", pathNot: "^packages/modality/src/features/$1/" }
    }
  ],
  options: {
    doNotFollow: {
      path: "node_modules"
    },
    tsConfig: {
      fileName: "tsconfig.json"
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "node", "default"]
    }
  }
};
