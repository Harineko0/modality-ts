const { themes: prismThemes } = require("prism-react-renderer");

/** @type {import("@docusaurus/types").Config} */
const config = {
  title: "modality-ts",
  tagline: "Model-check React state-transition behavior before users find it.",
  favicon: "img/favicon.png",

  url: "https://modality-ts.yuni.cat",
  baseUrl: "/",
  organizationName: "Harineko0",
  projectName: "modality-ts",

  onBrokenLinks: "throw",
  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: "warn",
    },
  },
  themes: ["@docusaurus/theme-mermaid"],
  trailingSlash: false,

  presets: [
    [
      "classic",
      {
        docs: {
          path: ".",
          routeBasePath: "/",
          sidebarPath: "./sidebars.js",
          exclude: [
            "**/_*/**",
            "**/_*.md",
            "**/_*.mdx",
            "build/**",
            "node_modules/**",
            "src/**",
            "static/**",
          ],
          editUrl: "https://github.com/Harineko0/modality-ts/tree/main/docs/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      },
    ],
  ],

  themeConfig: {
    image: "img/social-card.png",
    navbar: {
      title: "modality-ts",
      logo: {
        alt: "modality-ts logo",
        src: "img/logo.png",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docsSidebar",
          position: "left",
          label: "Docs",
        },
        {
          href: "https://github.com/Harineko0/modality-ts",
          label: "GitHub",
          position: "right",
        },
        {
          href: "https://www.npmjs.com/package/modality-ts",
          label: "npm",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        {
          title: "Docs",
          items: [
            { label: "Introduction", to: "/" },
            { label: "Concepts", to: "/concepts" },
            { label: "Architecture", to: "/architecture" },
            { label: "Soundness", to: "/soundness" },
            { label: "Guides", to: "/guides" },
            { label: "Reference", to: "/reference" },
          ],
        },
        {
          title: "Project",
          items: [
            {
              label: "GitHub",
              href: "https://github.com/Harineko0/modality-ts",
            },
            {
              label: "npm",
              href: "https://www.npmjs.com/package/modality-ts",
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} modality-ts contributors.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  },
};

module.exports = config;
