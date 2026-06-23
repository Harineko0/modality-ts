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
import type { RoutePlugin } from "modality-ts/extract/engine/spi";
import { describe, expect, it } from "vitest";
import { extractReactSourceTransitions } from "../../src/extract/engine/ts/react-source-transitions.js";
import { locationEffect } from "../../src/extract/engine/ts/transition/navigation.js";
import { locationVars } from "../../src/extract/plugins/route/router/routes.js";
import { useStateSource } from "../../src/extract/plugins/state/use-state/index.js";

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
              kind: "assign",
              var: "sys:route",
              expr: { kind: "lit", value: "/next" },
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
    const routePlugin: RoutePlugin = {
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
      statePlugins: [sourcePlugin],
      routePlugin,
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
        kind: "route",
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
    const routePlugin: RoutePlugin = {
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
        const location = locationEffect({
          currentVar: "sys:route",
          historyVar: "sys:history",
          mode: intent.mode,
          to: intent.to ? { kind: "lit", value: intent.to } : undefined,
          routeValues: ["/", "/next"],
        });
        return {
          effect: {
            kind: "seq",
            effects: [
              location.effect,
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
          reads: [...location.reads, "sys:next:slot:children"],
          writes: [...location.writes, "sys:next:slot:children"],
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
        routePlugin,
        inventory,
      },
    );

    expect(
      extracted.transitions.find((transition) => transition.cls === "nav"),
    ).toEqual(
      expect.objectContaining({
        effect: expect.objectContaining({
          kind: "seq",
          effects: expect.arrayContaining([
            expect.objectContaining({ kind: "if" }),
            {
              kind: "assign",
              var: "sys:next:slot:children",
              expr: { kind: "lit", value: "/next" },
            },
          ]),
        }),
        writes: ["sys:route", "sys:history", "sys:next:slot:children"],
      }),
    );

    const pipeline = runExtractionPipeline({
      sourceText: "",
      fileName: "App.tsx",
      route: "/",
      routePlugin,
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
    const statePlugins = [
      "use-state",
      "jotai",
      "swr",
      "zustand",
      "tanstack-query",
      "redux",
    ];
    const routePlugins = ["router", "next"];
    for (const source of statePlugins) {
      expect(
        packageJson.exports[`./extract/plugins/state/${source}`],
      ).toBeTruthy();
      expect(
        packageJson.exports[`./extract/plugins/state/${source}/harness`],
      ).toBeTruthy();
    }
    for (const source of routePlugins) {
      expect(
        packageJson.exports[`./extract/plugins/route/${source}`],
      ).toBeTruthy();
      expect(
        packageJson.exports[`./extract/plugins/route/${source}/harness`],
      ).toBeTruthy();
    }
  });

  it("root package exports type-library adapter entry points without harness", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(testDir, "../../package.json"), "utf8"),
    );
    for (const library of ["zod", "arktype"]) {
      expect(
        packageJson.exports[`./extract/plugins/type/${library}`],
      ).toBeTruthy();
      expect(
        packageJson.exports[`./extract/plugins/type/${library}/harness`],
      ).toBeUndefined();
    }
  });

  it("extraction engine does not import built-in plugin slices", async () => {
    const engineDir = resolve(srcDir, "extract/engine");
    const files = await sourceFiles(engineDir);
    const violations: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(text)) {
        if (specifier.includes("extract/plugins")) {
          violations.push(`${relativeToSrc(file)} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("CLI extraction code does not import private built-in adapter modules", async () => {
    const cliExtractDir = resolve(srcDir, "cli/features/extract");
    const files = await sourceFiles(cliExtractDir);
    const violations: string[] = [];
    const allowedPublicPrefixes = [
      "modality-ts/extract/plugins/route/next",
      "modality-ts/extract/plugins/route/router",
    ];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(text)) {
        if (
          specifier.includes("extract/plugins/route/next/") ||
          specifier.endsWith("/next/cache.js") ||
          specifier.endsWith("/next/cache") ||
          specifier.includes("extract/plugins/route/router/") ||
          specifier.match(/extract\/sources\/next\/[^"']+\.js$/) ||
          specifier.match(/\.\.\/.*\/extract\/sources\/(next|router)\//)
        ) {
          violations.push(`${relativeToSrc(file)} imports ${specifier}`);
          continue;
        }
        if (
          (specifier.startsWith("../../../extract/plugins/route/next") ||
            specifier.startsWith("../../../extract/plugins/route/router")) &&
          !allowedPublicPrefixes.some((prefix) => specifier === prefix)
        ) {
          violations.push(`${relativeToSrc(file)} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("built-in source slices import extraction through the public SPI only", async () => {
    const sourcesDir = resolve(srcDir, "extract/plugins");
    const files = await sourceFiles(sourcesDir);
    const violations: string[] = [];

    const allowedPublicPackagePrefixes = [
      "modality-ts/extract/engine/",
      "modality-ts/extract/lang/ts",
      "modality-ts/extract/plugins",
    ];

    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(text)) {
        if (
          specifier === "modality-ts/extract" ||
          (specifier.startsWith("modality-ts/extract/") &&
            !allowedPublicPackagePrefixes.some((prefix) =>
              specifier.startsWith(prefix),
            ))
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

  it("widens untyped numeric useState domains from functional updater transitions", () => {
    const maxDepth = 12;
    const sourceText = `
      import { useState } from "react";

      export function LaneTimer() {
        const [draftSec, setDraftSec] = useState(0);
        return (
          <>
            <button onClick={() => setDraftSec((s) => s + 10)}>+10秒</button>
            <button onClick={() => setDraftSec((s) => s + 60)}>+1分</button>
            <button onClick={() => setDraftSec((s) => s + 180)}>+3分</button>
            <button onClick={() => setDraftSec(0)}>リセット</button>
          </>
        );
      }
    `;
    const result = runExtractionPipeline({
      sourceText,
      fileName: "LaneTimer.tsx",
      route: "/",
      statePlugins: [useStateSource()],
      bounds: { maxDepth },
    });
    const draftSec = result.stateVars.find(
      (decl) => decl.id === "local:LaneTimer.draftSec",
    );
    expect(draftSec).toBeDefined();
    expect(draftSec?.domain).toEqual({
      kind: "boundedInt",
      min: 0,
      max: 180 * maxDepth,
      overflow: "forbid",
    });
    const draftTransitions = result.transitions.filter((transition) =>
      transition.writes.includes("local:LaneTimer.draftSec"),
    );
    expect(
      draftTransitions.some((transition) =>
        transition.id.includes(".unrepresentable"),
      ),
    ).toBe(false);
    const incrementTransitions = draftTransitions.filter(
      (transition) => transition.effect.kind === "assign",
    );
    expect(incrementTransitions).toHaveLength(4);
    expect(
      incrementTransitions.filter(
        (transition) =>
          transition.effect.kind === "assign" &&
          transition.effect.expr.kind === "add",
      ),
    ).toHaveLength(3);
    for (const delta of [10, 60, 180]) {
      expect(
        incrementTransitions.some(
          (transition) =>
            transition.effect.kind === "assign" &&
            transition.effect.expr.kind === "add" &&
            transition.effect.expr.args[0]?.kind === "read" &&
            transition.effect.expr.args[0]?.var ===
              "local:LaneTimer.draftSec" &&
            transition.effect.expr.args[1]?.kind === "lit" &&
            transition.effect.expr.args[1]?.value === delta,
        ),
      ).toBe(true);
    }
    expect(
      incrementTransitions.some(
        (transition) =>
          transition.effect.kind === "assign" &&
          transition.effect.expr.kind === "lit" &&
          transition.effect.expr.value === 0,
      ),
    ).toBe(true);
    const ids = incrementTransitions.map((transition) => transition.id);
    expect(new Set(ids).size).toBe(4);
    expect(
      result.transitions.some(
        (transition) => transition.id === "LaneTimer.onClick.draftSec",
      ),
    ).toBe(false);
  });

  it("does not reference obsolete adapter SPI names in active source", async () => {
    const forbidden = [
      new RegExp(`\\b${["Router", "Plugin"].join("")}\\b`),
      new RegExp(`\\b${["router", "Source"].join("")}\\b`),
      new RegExp(`\\b${["with", "Server", "Effect", "Discovery"].join("")}\\b`),
      new RegExp(`\\b${["plugin", "Safety", "Warning"].join("")}\\b`),
      new RegExp(`\\b${["validate", "Router", "Plugin"].join("")}\\b`),
    ];
    const violations = await collectPatternViolations(srcDir, forbidden);
    expect(violations).toEqual([]);
  });

  it("does not branch extraction flow on navigation adapter ids", async () => {
    const forbidden = [
      new RegExp(`${["adapter", '.id === "next"'].join("")}`),
      new RegExp(`${["adapter", '.id === "router"'].join("")}`),
      new RegExp(`${["routerAdapter", ".id ==="].join("")}`),
    ];
    const violations = await collectPatternViolations(srcDir, forbidden);
    expect(violations).toEqual([]);
  });

  it("does not parse warning message prefixes to recover caveats", async () => {
    const files = await sourceFiles(srcDir);
    const globalTaintPrefix = ["Global", " taint "].join("");
    const forbidden = [
      new RegExp(`\\b${["plugin", "Safety", "Warning"].join("")}\\b`),
      /unextractableHandlerFromWarning/,
      new RegExp(
        `startsWith\\(\\s*["']${globalTaintPrefix.replace(/ /g, " ")}`,
      ),
      /startsWith\(\s*["']global-taint:/,
      /\^Unextractable handler /,
    ];
    const violations: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(text)) {
          violations.push(`${relativeToSrc(file)}: ${pattern}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("does not regex-parse warning.message in report-building code", async () => {
    const reportFiles = await sourceFiles(
      resolve(srcDir, "cli/features/extract"),
    );
    const forbidden = [
      /warning\.message\.match\(/,
      /warning\.message\.exec\(/,
      /\.match\([^)]*warning\.message/,
      /\.exec\([^)]*warning\.message/,
    ];
    const violations: string[] = [];
    for (const file of reportFiles) {
      const text = await readFile(file, "utf8");
      for (const pattern of forbidden) {
        if (pattern.test(text)) {
          violations.push(`${relativeToSrc(file)}: ${pattern}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("trusted-layer vocabulary guards", () => {
  const repoRoot = resolve(testDir, "../..");
  const trustedRoots = [
    resolve(repoRoot, "src/core"),
    resolve(repoRoot, "src/check"),
    resolve(repoRoot, "crates/checker/src"),
  ];
  const forbiddenPatterns: {
    label: string;
    pattern: RegExp;
    skip?: (file: string) => boolean;
  }[] = [
    { label: "route-local", pattern: /route-local/ },
    { label: "EffectIR::Navigate", pattern: /EffectIR::Navigate/ },
    {
      label: "navigate effect kind",
      pattern: /\|\s*\{\s*kind:\s*["']navigate["']/,
      skip: (file) => file.endsWith("src/core/ir/types.ts"),
    },
    { label: "navigatedTo", pattern: /\bnavigatedTo\b/ },
    { label: "navigated()", pattern: /\bnavigated\s*\(/ },
    { label: "sys_route_index", pattern: /sys_route_index/ },
    { label: "sys_history_index", pattern: /sys_history_index/ },
    { label: "sys_pending_index", pattern: /sys_pending_index/ },
  ];

  it("does not reintroduce removed framework semantics in trusted layers", async () => {
    const violations: string[] = [];
    for (const root of trustedRoots) {
      const files = await sourceFiles(root);
      for (const file of files) {
        const text = await readFile(file, "utf8");
        const relative = file.slice(repoRoot.length + 1);
        for (const { label, pattern, skip } of forbiddenPatterns) {
          if (skip?.(relative)) continue;
          if (pattern.test(text)) {
            violations.push(`${relative}: ${label}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("conformance and canary runner boundaries", () => {
  const repoRoot = resolve(testDir, "../..");
  const runnerRoots = [
    resolve(repoRoot, "tools/conformance"),
    resolve(repoRoot, "tools/canary"),
    resolve(repoRoot, "tools/shared-gates"),
  ];
  const runnerEntrypoints = [
    resolve(repoRoot, "tools/conformance-ci.ts"),
    resolve(repoRoot, "tools/canary-ci.ts"),
    resolve(repoRoot, "tools/examples-ci.ts"),
  ];
  const allowedCliWrappers = new Set([
    "../../src/cli/check.ts",
    "../../src/cli/ci.ts",
    "../../src/cli/conform.ts",
    "../../src/cli/extract.ts",
    "../../src/cli/replay.ts",
  ]);

  it("keeps runners and shared gates off private adapter and feature internals", async () => {
    const files = [
      ...(await Promise.all(runnerRoots.map((dir) => sourceFiles(dir)))).flat(),
      ...runnerEntrypoints,
    ];
    const violations: string[] = [];

    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(text)) {
        if (isForbiddenRunnerImport(specifier, allowedCliWrappers)) {
          violations.push(`${relativeToRepo(file)} imports ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

async function collectPatternViolations(
  rootDir: string,
  patterns: readonly RegExp[],
): Promise<string[]> {
  const files = await sourceFiles(rootDir);
  const violations: string[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        violations.push(`${relativeToSrc(file)}: ${pattern}`);
      }
    }
  }
  return violations;
}

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

function relativeToRepo(path: string): string {
  return path.slice(resolve(testDir, "../..").length + 1);
}

function isForbiddenRunnerImport(
  specifier: string,
  allowedCliWrappers: ReadonlySet<string>,
): boolean {
  if (allowedCliWrappers.has(specifier)) return false;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    if (!specifier.includes("/src/") && !specifier.includes("src/"))
      return false;
    if (specifier.includes("src/cli/features")) return true;
    if (specifier.includes("src/extract/plugins")) return true;
    if (
      specifier.includes("src/extract/engine") &&
      !specifier.includes("src/extract/engine/spi")
    ) {
      return true;
    }
    return false;
  }
  if (specifier.includes("extract/plugins")) return true;
  if (
    specifier.includes("extract/engine") &&
    !specifier.includes("extract/engine/spi")
  ) {
    return true;
  }
  if (specifier.includes("cli/features")) return true;
  return false;
}

describe("plugin-layering coupling guardrails", () => {
  const repoRoot = resolve(testDir, "../..");
  const engineRoot = resolve(repoRoot, "src/extract/engine/ts");

  it("engine/ts does not contain timer API string literals", async () => {
    const files = await sourceFiles(engineRoot);
    const timerApis = [
      "setTimeout",
      "setInterval",
      "clearTimeout",
      "clearInterval",
    ];
    const violations: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const api of timerApis) {
        const pattern = new RegExp(`["'\`]${api}["'\`]`);
        if (pattern.test(text)) {
          violations.push(`${file.slice(repoRoot.length + 1)}: "${api}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("engine/ts does not contain WebSocket constructor string literal", async () => {
    const files = await sourceFiles(engineRoot);
    const violations: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      if (/["'`]WebSocket["'`]/.test(text)) {
        violations.push(file.slice(repoRoot.length + 1));
      }
    }
    expect(violations).toEqual([]);
  });
});
