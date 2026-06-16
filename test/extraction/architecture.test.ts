import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPluginRegistry,
  extractionPipelinePhases,
  runExtractionPipeline,
  type StateSourcePlugin,
} from "modality-ts/extract";
import type { RouterPlugin } from "modality-ts/extract/engine/spi";
import { locationVars } from "../../src/extract/sources/router/routes.js";
import { extractReactSourceTransitions } from "../../src/extract/engine/ts/react-source-transitions.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(testDir, "../../src");

function plugin(id: string): StateSourcePlugin {
  return {
    id,
    version: "1.0.0",
    packageNames: [id],
    discover: () => [],
    writeChannels: () => [],
    harness: {
      setup: () => ({}),
      observe: () => "unobservable",
    },
  };
}

describe("extraction architecture surface", () => {
  it("publishes the Spec 02 pipeline phases", () => {
    expect(
      extractionPipelinePhases.map((phase) => [phase.id, phase.name]),
    ).toEqual([
      ["P0", "project-load"],
      ["P1", "state-inventory"],
      ["P2", "domain-inference"],
      ["P3", "handler-discovery"],
      ["P4", "effect-summarization"],
      ["P5", "escape-analysis"],
      ["P6", "overlay-merge"],
      ["P7", "emit-artifacts"],
    ]);
  });

  it("keeps the extraction engine entry point as a thin barrel", () => {
    const indexText = readFileSync(
      resolve(srcDir, "extract/engine/index.ts"),
      "utf8",
    );
    expect(indexText.split("\n").length).toBeLessThanOrEqual(20);
    expect(indexText).not.toContain("typescript");
    expect(indexText).not.toContain("use-state");
  });

  it("validates source plugin ids through the public registry surface", () => {
    expect(createPluginRegistry([plugin("use-state"), plugin("swr")])).toEqual({
      sources: [
        {
          id: "swr",
          version: "1.0.0",
          kind: "state-source",
          packageNames: ["swr"],
        },
        {
          id: "use-state",
          version: "1.0.0",
          kind: "state-source",
          packageNames: ["use-state"],
        },
      ],
    });
    expect(() =>
      createPluginRegistry([plugin("use-state"), plugin("use-state")]),
    ).toThrow("Duplicate extraction source plugin use-state");
  });

  it("orchestrates discovery, channels, templates, handlers, and router vars through the public SPI", () => {
    const sourcePlugin: StateSourcePlugin = {
      ...plugin("demo"),
      discover: () => [
        {
          id: "local:Demo.flag",
          kind: "demo",
          origin: "system",
          var: {
            id: "local:Demo.flag",
            domain: { kind: "bool" },
            origin: "system",
            scope: { kind: "global" },
            initial: false,
          },
        },
      ],
      writeChannels: () => [
        {
          id: "flag.setter",
          varId: "local:Demo.flag",
          symbolName: "setFlag",
          source: { file: "Demo.tsx" },
        },
      ],
      template: () => ({
        vars: [
          {
            id: "lib:ready",
            domain: { kind: "bool" },
            origin: "library-template",
            scope: { kind: "global" },
            initial: false,
          },
        ],
        transitions: [
          {
            id: "lib:ready",
            cls: "library",
            label: { kind: "timer", key: "ready" },
            source: [],
            guard: { kind: "lit", value: true },
            effect: {
              kind: "assign",
              var: "lib:ready",
              expr: { kind: "lit", value: true },
            },
            reads: [],
            writes: ["lib:ready"],
            confidence: "exact",
          },
        ],
      }),
      extract: (options) => ({
        warnings: [],
        transitions: [
          {
            id: "Demo.onClick",
            cls: "user",
            label: { kind: "event", locator: { role: "button" } },
            source: [],
            guard: { kind: "lit", value: true },
            effect: {
              kind: "navigate",
              mode: "push",
              to: { kind: "lit", value: "/next" },
            },
            reads: [],
            writes: ["sys:route"],
            confidence:
              options.writeChannels[0]?.symbolName === "setFlag"
                ? "exact"
                : "over-approx",
          },
        ],
      }),
    };
    const inventory = {
      routes: [
        { pattern: "/", kind: "index" as const },
        { pattern: "/next", kind: "page" as const },
      ],
    };
    const routerPlugin: RouterPlugin = {
      id: "router",
      packageNames: ["router"],
      discoverRoutes: async () => inventory,
      classifyNavigationCall: () => "unsupported",
      locationVars: (routeInventory, options, lowering) =>
        locationVars(routeInventory, options, lowering),
      harness: {
        setup: () => ({}),
        observe: () => "unobservable",
        navigate: () => {},
      },
    };

    const result = runExtractionPipeline({
      sourceText: "",
      fileName: "Demo.tsx",
      route: "/",
      sourcePlugins: [sourcePlugin],
      routerPlugin,
      inventory,
      lowering: {
        pushTargets: ["/next"],
        pushOrigins: [],
        hasUnboundPush: true,
      },
    });

    expect(result.plugins).toEqual({
      sources: [
        {
          id: "demo",
          version: "1.0.0",
          kind: "state-source",
          packageNames: ["demo"],
        },
      ],
      router: {
        id: "router",
        version: "unknown",
        kind: "router",
        packageNames: ["router"],
      },
    });
    expect(result.stateVars.map((decl) => decl.id)).toEqual([
      "local:Demo.flag",
    ]);
    expect(
      result.templateFragments.flatMap((fragment) =>
        fragment.vars.map((decl) => decl.id),
      ),
    ).toEqual(["lib:ready"]);
    expect(result.transitions.map((transition) => transition.id)).toEqual([
      "Demo.onClick",
      "lib:ready",
    ]);
    expect(result.routeVars.map((decl) => decl.id)).toEqual([
      "sys:route",
      "sys:history",
    ]);
    expect(
      result.routeVars.find((decl) => decl.id === "sys:route")?.domain,
    ).toEqual({
      kind: "enum",
      values: ["/", "/next"],
    });
  });

  it("uses optional route-tree hooks when a navigation adapter provides them", () => {
    const inventory = {
      routes: [
        { pattern: "/", kind: "index" as const },
        { pattern: "/next", kind: "page" as const },
      ],
    };
    const routerPlugin: RouterPlugin = {
      id: "route-tree",
      packageNames: ["next"],
      discoverRoutes: async () => inventory,
      classifyNavigationCall: () => "unsupported",
      classifyNavigationJsx(_tag, attrs) {
        const href = attrs.get("href");
        return typeof href === "string"
          ? { mode: "push", to: href }
          : "unsupported";
      },
      locationVars: (routeInventory, options, lowering) =>
        locationVars(routeInventory, options, lowering),
      routeTreeVars: () => [
        {
          id: "sys:next:slot:children",
          domain: { kind: "enum", values: ["__none", "/next"] },
          origin: "system",
          scope: { kind: "global" },
          initial: "__none",
        },
      ],
      lowerNavigation(intent) {
        return {
          effect: {
            kind: "seq",
            effects: [
              {
                kind: "navigate",
                mode: intent.mode,
                ...(intent.to ? { to: { kind: "lit", value: intent.to } } : {}),
              },
              {
                kind: "assign",
                var: "sys:next:slot:children",
                expr: {
                  kind: "lit",
                  value: intent.to ?? "__none",
                },
              },
            ],
          },
          reads: ["sys:route", "sys:history"],
          writes: ["sys:route", "sys:history", "sys:next:slot:children"],
          confidence: "exact",
        };
      },
      harness: {
        setup: () => ({}),
        observe: () => "unobservable",
        navigate: () => {},
      },
    };

    const extracted = extractReactSourceTransitions(
      `
      import Link from 'next/link';
      export function App() {
        return <Link href="/next">Next</Link>;
      }
      `,
      {
        route: "/",
        fileName: "App.tsx",
        routePatterns: ["/", "/next"],
        routerPlugin,
        inventory,
      },
    );

    expect(
      extracted.transitions.find((transition) => transition.cls === "nav"),
    ).toEqual(
      expect.objectContaining({
        effect: {
          kind: "seq",
          effects: [
            {
              kind: "navigate",
              mode: "push",
              to: { kind: "lit", value: "/next" },
            },
            {
              kind: "assign",
              var: "sys:next:slot:children",
              expr: { kind: "lit", value: "/next" },
            },
          ],
        },
        writes: ["sys:route", "sys:history", "sys:next:slot:children"],
      }),
    );

    const pipeline = runExtractionPipeline({
      sourceText: "",
      fileName: "App.tsx",
      route: "/",
      routerPlugin,
      inventory,
      lowering: {
        pushTargets: ["/next"],
        pushOrigins: [],
        hasUnboundPush: true,
      },
    });

    expect(pipeline.routeVars.map((decl) => decl.id)).toEqual([
      "sys:route",
      "sys:history",
    ]);
  });

  it("root package exports source harness entry points", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(testDir, "../../package.json"), "utf8"),
    );
    for (const source of ["use-state", "jotai", "swr", "router", "next"]) {
      expect(packageJson.exports[`./extract/sources/${source}`]).toBeTruthy();
      expect(
        packageJson.exports[`./extract/sources/${source}/harness`],
      ).toBeTruthy();
    }
  });

  it("built-in source slices import extraction through the public SPI only", async () => {
    const sourcesDir = resolve(srcDir, "extract/sources");
    const files = await sourceFiles(sourcesDir);
    const violations: string[] = [];

    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(text)) {
        if (
          specifier === "modality-ts/extract" ||
          (specifier.startsWith("modality-ts/extract/") &&
            !specifier.startsWith("modality-ts/extract/engine/"))
        ) {
          violations.push(`${relativeToSrc(file)} imports ${specifier}`);
        }
        if (
          (specifier.startsWith("../../engine") ||
            specifier.startsWith("../engine")) &&
          !specifier.includes("/engine/ts/") &&
          !specifier.includes("/engine/spi/")
        ) {
          violations.push(`${relativeToSrc(file)} imports ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps src/cli/types limited to ambient declaration shims", async () => {
    const typesDir = resolve(srcDir, "cli/types");
    const entries = await readdir(typesDir, { withFileTypes: true });
    expect(
      entries.every((entry) => entry.isFile() && entry.name.endsWith(".d.ts")),
    ).toBe(true);
  });
});

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      if (entry.isFile() && path.endsWith(".ts")) return [path];
      return [];
    }),
  );
  return files.flat().sort();
}

function importSpecifiers(text: string): string[] {
  return [
    ...text.matchAll(
      /\bfrom\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g,
    ),
  ]
    .map((match) => match[1] ?? match[2])
    .filter((specifier): specifier is string => specifier !== undefined);
}

function relativeToSrc(path: string): string {
  return path.slice(srcDir.length + 1);
}
