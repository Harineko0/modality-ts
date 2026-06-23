module.exports = {
  forbidden: [
    {
      name: "core-is-stable-center",
      severity: "error",
      from: { path: "^src/core", pathNot: "^src/.*/test/" },
      to: { path: "^src/(check|extract|cli)" },
    },
    {
      name: "check-depends-only-on-core",
      severity: "error",
      from: { path: "^src/check", pathNot: "^src/.*/test/" },
      to: { path: "^src/(extract|cli)" },
    },
    {
      name: "extract-engine-is-node-only-and-independent",
      severity: "error",
      from: { path: "^src/extract/engine", pathNot: "^src/.*/test/" },
      to: {
        path: "^src/(check|cli)|^src/extract/plugins",
      },
    },
    {
      name: "extract-lang-imports-core-only",
      severity: "error",
      from: { path: "^src/extract/lang", pathNot: "^src/.*/test/" },
      to: {
        path: "^src/",
        pathNot: ["^src/core", "^src/extract/lang"],
      },
    },
    {
      name: "extract-compile-imports-core-and-spi-only",
      severity: "error",
      from: { path: "^src/extract/compile", pathNot: "^src/.*/test/" },
      to: {
        path: "^src/",
        pathNot: [
          "^src/core",
          "^src/extract/engine/spi",
          "^src/extract/lang",
          "^src/extract/compile",
        ],
      },
    },
    {
      name: "extract-wiring-is-outside-engine",
      severity: "error",
      from: { path: "^src/extract/wiring", pathNot: "^src/.*/test/" },
      to: { path: "^src/(check|cli)" },
    },
    {
      name: "harness-does-not-import-product-or-analysis",
      severity: "error",
      from: { path: "^src/cli/harness", pathNot: "^src/.*/test/" },
      to: {
        path: "^src/(check|extract)|^src/cli/(features|registry|codegen|runtime)",
      },
    },
    {
      name: "runtime-stays-kernel-light",
      severity: "error",
      from: { path: "^src/cli/runtime", pathNot: "^src/.*/test/" },
      to: {
        path: "^src/(check|extract)|^src/cli/(features|registry|codegen|harness)",
      },
    },
    {
      name: "runtime-imports-core-props-subpath-only",
      severity: "error",
      from: { path: "^src/cli/runtime", pathNot: "^src/.*/test/" },
      to: { path: "^src/core/(?!props/)" },
    },
    {
      name: "plugin-slices-do-not-import-product-or-peers",
      severity: "error",
      from: {
        path: "^src/extract/plugins/(?:state|route|type|framework|effect)/[^/]+",
        pathNot: "^src/.*/test/",
      },
      to: { path: "^src/check|^src/cli/(features|registry|codegen|runtime)" },
    },
    {
      name: "plugin-slices-use-extraction-spi-only",
      severity: "error",
      from: {
        path: "^src/extract/plugins/(?:state|route|type|framework|effect)/[^/]+",
        pathNot: "^src/.*/test/",
      },
      to: {
        path: "^src/extract/engine/(?!spi/|ts/)",
      },
    },
    {
      name: "plugin-slices-are-independent",
      severity: "error",
      from: {
        path: "^src/extract/plugins/(?:state|route|type|framework|effect)/([^/]+)",
        pathNot: ["^src/.*/test/", "^src/extract/plugins/[^/]+/index\\.ts$"],
      },
      to: {
        path: "^src/extract/plugins/(?:state|route|type|framework|effect)/([^/]+)",
        pathNot: "^src/extract/plugins/(?:[^/]+/$1|shared)",
      },
    },
    {
      name: "cli-feature-slices-do-not-import-each-other",
      severity: "error",
      from: { path: "^src/cli/features/([^/]+)/", pathNot: "^src/.*/test/" },
      to: {
        path: "^src/cli/features/([^/]+)/",
        pathNot: "^src/cli/features/$1/",
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsConfig: {
      fileName: "tsconfig.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "node", "default"],
    },
  },
};
