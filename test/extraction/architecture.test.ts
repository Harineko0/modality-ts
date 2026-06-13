import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPluginRegistry, extractionPipelinePhases, runExtractionPipeline, type StateSourcePlugin } from "modality-ts/extraction";
import type { RouterPlugin } from "modality-ts/extraction/spi";

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
      observe: () => "unobservable"
    }
  };
}

describe("extraction architecture surface", () => {
  it("publishes the Spec 02 pipeline phases", () => {
    expect(extractionPipelinePhases.map((phase) => [phase.id, phase.name])).toEqual([
      ["P0", "project-load"],
      ["P1", "state-inventory"],
      ["P2", "domain-inference"],
      ["P3", "handler-discovery"],
      ["P4", "effect-summarization"],
      ["P5", "escape-analysis"],
      ["P6", "overlay-merge"],
      ["P7", "emit-artifacts"]
    ]);
  });

  it("validates source plugin ids through the public registry surface", () => {
    expect(createPluginRegistry([plugin("use-state"), plugin("swr")])).toEqual({
      sources: [
        { id: "swr", version: "1.0.0", kind: "state-source", packageNames: ["swr"] },
        { id: "use-state", version: "1.0.0", kind: "state-source", packageNames: ["use-state"] }
      ]
    });
    expect(() => createPluginRegistry([plugin("use-state"), plugin("use-state")])).toThrow("Duplicate extraction source plugin use-state");
  });

  it("orchestrates discovery, channels, templates, handlers, and router vars through the public SPI", () => {
    const sourcePlugin: StateSourcePlugin = {
      ...plugin("demo"),
      discover: () => [{
        id: "local:Demo.flag",
        kind: "demo",
        origin: "system",
        var: { id: "local:Demo.flag", domain: { kind: "bool" }, origin: "system", scope: { kind: "global" }, initial: false }
      }],
      writeChannels: () => [{ id: "flag.setter", varId: "local:Demo.flag", symbolName: "setFlag", source: { file: "Demo.tsx" } }],
      template: () => ({
        vars: [{ id: "lib:ready", domain: { kind: "bool" }, origin: "library-template", scope: { kind: "global" }, initial: false }],
        transitions: [{
          id: "lib:ready",
          cls: "library",
          label: { kind: "timer", key: "ready" },
          source: [],
          guard: { kind: "lit", value: true },
          effect: { kind: "assign", var: "lib:ready", expr: { kind: "lit", value: true } },
          reads: [],
          writes: ["lib:ready"],
          confidence: "exact"
        }]
      })
    };
    const routerPlugin: RouterPlugin = {
      id: "router",
      packageNames: ["router"],
      routeVars: (routes) => routes.map((route) => ({ id: `route:${route}`, domain: { kind: "enum", values: [route] }, origin: "system", scope: { kind: "global" }, initial: route })),
      navigationCall: () => "unsupported",
      harness: { setup: () => ({}), observe: () => "unobservable", navigate: () => {} }
    };

    const result = runExtractionPipeline({
      sourceText: "",
      fileName: "Demo.tsx",
      route: "/",
      sourcePlugins: [sourcePlugin],
      routerPlugin,
      extractHandlers: (_sourceText, options) => ({
        warnings: [],
        transitions: [{
          id: "Demo.onClick",
          cls: "user",
          label: { kind: "event", locator: { role: "button" } },
          source: [],
          guard: { kind: "lit", value: true },
          effect: { kind: "navigate", mode: "push", to: { kind: "lit", value: "/next" } },
          reads: [],
          writes: ["sys:route"],
          confidence: options.writeChannels[0]?.symbolName === "setFlag" ? "exact" : "over-approx"
        }]
      })
    });

    expect(result.plugins).toEqual({
      sources: [{ id: "demo", version: "1.0.0", kind: "state-source", packageNames: ["demo"] }],
      router: { id: "router", version: "unknown", kind: "router", packageNames: ["router"] }
    });
    expect(result.stateVars.map((decl) => decl.id)).toEqual(["local:Demo.flag"]);
    expect(result.templateFragments.flatMap((fragment) => fragment.vars.map((decl) => decl.id))).toEqual(["lib:ready"]);
    expect(result.transitions.map((transition) => transition.id)).toEqual(["Demo.onClick", "lib:ready"]);
    expect(result.routeVars.map((decl) => decl.id)).toEqual(["route:/", "route:/next"]);
  });

  it("root package exports source harness entry points", () => {
    const packageJson = JSON.parse(readFileSync(resolve(testDir, "../../package.json"), "utf8"));
    for (const source of ["source-use-state", "source-jotai", "source-swr", "source-router"]) {
      expect(packageJson.exports[`./${source}`]).toBeTruthy();
      expect(packageJson.exports[`./${source}/harness`]).toBeTruthy();
    }
  });

  it("built-in source slices import extraction through the public SPI only", async () => {
    const sourcesDir = resolve(srcDir, "sources");
    const files = await sourceFiles(sourcesDir);
    const violations: string[] = [];

    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(text)) {
        if (specifier === "modality-ts/extraction" || specifier.startsWith("modality-ts/extraction/") && specifier !== "modality-ts/extraction/spi") {
          violations.push(`${relativeToSrc(file)} imports ${specifier}`);
        }
        if (specifier.startsWith("../../extraction") || specifier.startsWith("../extraction")) {
          violations.push(`${relativeToSrc(file)} imports ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps src/types limited to ambient declaration shims", async () => {
    const typesDir = resolve(srcDir, "types");
    const entries = await readdir(typesDir, { withFileTypes: true });
    expect(entries.every((entry) => entry.isFile() && entry.name.endsWith(".d.ts"))).toBe(true);
  });
});

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (entry.isFile() && path.endsWith(".ts")) return [path];
    return [];
  }));
  return files.flat().sort();
}

function importSpecifiers(text: string): string[] {
  return [...text.matchAll(/\bfrom\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier): specifier is string => specifier !== undefined);
}

function relativeToSrc(path: string): string {
  return path.slice(srcDir.length + 1);
}
