/** @type {import("@docusaurus/plugin-content-docs").SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    {
      type: "category",
      label: "Introduction",
      link: { type: "doc", id: "intro/index" },
      items: ["intro/installation", "intro/quickstart", "intro/how-it-works"],
    },
    {
      type: "category",
      label: "Guides",
      link: { type: "doc", id: "guides/index" },
      items: [
        "guides/writing-properties",
        "guides/refining-domains-and-overlays",
        "guides/modeling-side-effects",
        "guides/diagnostics-and-search-limits",
        "guides/debugging-counterexamples",
        "guides/ci-integration",
        "guides/exporting-to-tla",
      ],
    },
    {
      type: "category",
      label: "Concepts",
      link: { type: "doc", id: "concepts/index" },
      items: [
        "concepts/transition-system",
        "concepts/state-and-domains",
        "concepts/transitions",
        "concepts/route-execution",
        "concepts/stabilization",
        "concepts/properties",
        "concepts/state-space-control",
      ],
    },
    {
      type: "category",
      label: "Architecture",
      link: { type: "doc", id: "architecture/index" },
      items: [
        "architecture/ir",
        "architecture/extraction-pipeline",
        "architecture/checker",
        "architecture/state-sources",
        "architecture/navigation",
        "architecture/conformance-and-replay",
      ],
    },
    {
      type: "category",
      label: "Soundness & Validity",
      link: { type: "doc", id: "soundness/index" },
      items: [
        "soundness/e1-invariant",
        "soundness/trust-ledger",
        "soundness/checker-correctness",
        "soundness/limitations",
      ],
    },
    {
      type: "category",
      label: "State Sources",
      link: { type: "doc", id: "sources/index" },
      items: [
        "sources/use-state",
        "sources/jotai",
        "sources/swr",
        "sources/zustand",
        "sources/tanstack-query",
        "sources/redux",
        "sources/router",
        "sources/next",
        "sources/react-features",
        "sources/tanstack-router",
        "sources/react-hook-form",
      ],
    },
    {
      type: "category",
      label: "Examples",
      link: { type: "doc", id: "examples/index" },
      items: ["examples/todo", "examples/checkout", "examples/demo"],
    },
    {
      type: "category",
      label: "Reference",
      link: { type: "doc", id: "reference/index" },
      items: [
        "reference/cli",
        "reference/property-api",
        "reference/domains",
        "reference/config-and-overlay-api",
        "reference/schemas",
        "reference/package-entry-points",
      ],
    },
  ],
};

module.exports = sidebars;
