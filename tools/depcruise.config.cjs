module.exports = {
  forbidden: [
    {
      name: "kernel-is-stable-core",
      severity: "error",
      from: { path: "^src/kernel", pathNot: "^src/.*/test/" },
      to: { path: "^src/(checker|extraction|harness|runtime|sources|modality)" }
    },
    {
      name: "checker-depends-only-on-kernel",
      severity: "error",
      from: { path: "^src/checker", pathNot: "^src/.*/test/" },
      to: { path: "^src/(extraction|harness|runtime|sources|modality)" }
    },
    {
      name: "extraction-is-node-only-and-independent",
      severity: "error",
      from: { path: "^src/extraction", pathNot: "^src/.*/test/" },
      to: { path: "^src/(checker|harness|runtime|sources|modality)" }
    },
    {
      name: "harness-does-not-import-product-or-analysis",
      severity: "error",
      from: { path: "^src/harness", pathNot: "^src/.*/test/" },
      to: { path: "^src/(checker|extraction|runtime|sources|modality)" }
    },
    {
      name: "runtime-stays-kernel-light",
      severity: "error",
      from: { path: "^src/runtime", pathNot: "^src/.*/test/" },
      to: { path: "^src/(checker|extraction|harness|sources|modality)" }
    },
    {
      name: "runtime-imports-kernel-props-subpath-only",
      severity: "error",
      from: { path: "^src/runtime", pathNot: "^src/.*/test/" },
      to: { path: "^src/kernel/(?!props/)" }
    },
    {
      name: "source-slices-do-not-import-product-or-peers",
      severity: "error",
      from: { path: "^src/sources/[^/]+", pathNot: "^src/.*/test/" },
      to: { path: "^src/(checker|runtime|modality)" }
    },
    {
      name: "source-slices-use-extraction-spi-only",
      severity: "error",
      from: { path: "^src/sources/[^/]+", pathNot: "^src/.*/test/" },
      to: {
        path: "^src/extraction/(?!spi/)"
      }
    },
    {
      name: "source-slices-are-independent",
      severity: "error",
      from: { path: "^src/sources/([^/]+)", pathNot: "^src/.*/test/" },
      to: { path: "^src/sources/([^/]+)", pathNot: "^src/sources/$1" }
    },
    {
      name: "modality-feature-slices-do-not-import-each-other",
      severity: "error",
      from: { path: "^src/modality/features/([^/]+)/", pathNot: "^src/.*/test/" },
      to: { path: "^src/modality/features/([^/]+)/", pathNot: "^src/modality/features/$1/" }
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
