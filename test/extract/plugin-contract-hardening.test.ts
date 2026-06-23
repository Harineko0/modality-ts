import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEffectPlugin,
  createFrameworkPlugin,
  createPlugin,
  createRoutePlugin,
  createStateSourcePlugin,
  createTypePlugin,
} from "modality-ts/extract/plugins";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

const FORBIDDEN_LEGACY_NAMES =
  /\b(NavigationAdapter|DomainRefinementProvider|EffectModelProvider|HandlerWrapperProvider|sourcePlugins|routerPlugin|effectModelProviders)\b/;

async function collectProductFiles(
  dir: string,
  acc: string[] = [],
): Promise<string[]> {
  if (!existsSync(dir)) return acc;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      await collectProductFiles(path, acc);
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    acc.push(path);
  }
  return acc;
}

describe("plugin factory foundation", () => {
  it("createPlugin normalizes and sorts package names", () => {
    const plugin = createPlugin({
      id: "demo",
      kind: "framework",
      packageNames: ["react"],
      version: "1.0.0",
      recognizeHook: () => undefined,
      recognizeRenderBoundary: () => undefined,
    });
    expect(plugin.kind).toBe("framework");
    expect(plugin.packageNames).toEqual(["react"]);
  });

  it("createPlugin rejects duplicate package names", () => {
    expect(() =>
      createPlugin({
        id: "demo",
        kind: "framework",
        packageNames: ["react", "react"],
      }),
    ).toThrow(/duplicate package name/);
  });

  it("createStateSourcePlugin requires discover and writeChannels", () => {
    expect(() =>
      createStateSourcePlugin({
        id: "broken",
        packageNames: ["react"],
        discover: () => [],
        writeChannels: () => [],
        harness: {
          setup: () => ({}),
          observe: () => "unobservable",
        },
      }),
    ).not.toThrow();
  });

  it("createFrameworkPlugin rejects unrelated hooks", () => {
    expect(() =>
      createFrameworkPlugin({
        id: "broken",
        packageNames: ["react"],
        recognizeHook: () => undefined,
        recognizeRenderBoundary: () => undefined,
        discover: () => [],
      } as never),
    ).toThrow(/unexpected field discover/);
  });

  it("createRoutePlugin requires route hooks", () => {
    const plugin = createRoutePlugin({
      id: "route",
      packageNames: ["router"],
      discoverRoutes: async () => ({ routes: [] }),
      classifyNavigationCall: () => "unsupported",
      locationVars: () => [],
      harness: {
        setup: () => ({}),
        observe: () => "unobservable",
        navigate: () => undefined,
      },
    });
    expect(plugin.kind).toBe("route");
  });

  it("createTypePlugin requires refineDomain", () => {
    const plugin = createTypePlugin({
      id: "zod",
      packageNames: ["zod"],
      refineDomain: () => undefined,
    });
    expect(plugin.kind).toBe("type");
  });

  it("createEffectPlugin requires recognizeEffect", () => {
    const plugin = createEffectPlugin({
      id: "timers",
      packageNames: [],
      recognizeEffect: () => undefined,
    });
    expect(plugin.kind).toBe("effect");
  });
});

describe("SPI contract hardening", () => {
  it("uses a single canonical Surface IR under lang", () => {
    expect(
      existsSync(resolve(repoRoot, "src/extract/engine/spi/surface-ir.ts")),
    ).toBe(false);
    expect(
      existsSync(resolve(repoRoot, "src/extract/lang/ts/surface-ir.ts")),
    ).toBe(false);
    expect(
      existsSync(resolve(repoRoot, "src/extract/lang/surface-ir.ts")),
    ).toBe(true);
  });

  it("keeps SPI modules free of typescript imports and engine/ts re-exports", async () => {
    const spiDir = resolve(repoRoot, "src/extract/engine/spi");
    const files = await collectProductFiles(spiDir);
    for (const file of files) {
      const text = await readFile(file, "utf8");
      expect(text).not.toMatch(/from ["']typescript["']/);
      expect(text).not.toMatch(/from ["']\.\.\/ts/);
      expect(text).not.toMatch(/\bSemanticTypeContext\b/);
    }
  });

  it("keeps framework and effect-model SPI modules free of engine/ts imports", async () => {
    for (const file of ["framework.ts", "effect-model.ts", "form-submit.ts"]) {
      const text = await readFile(
        resolve(repoRoot, "src/extract/engine/spi", file),
        "utf8",
      );
      expect(text).not.toMatch(/from ["']\.\.\/ts/);
    }
  });

  it("rejects legacy public plugin names in product code", async () => {
    const roots = [
      resolve(repoRoot, "src/extract"),
      resolve(repoRoot, "src/cli"),
      resolve(repoRoot, "test"),
    ];
    for (const root of roots) {
      const files = await collectProductFiles(root);
      for (const file of files) {
        const text = await readFile(file, "utf8");
        expect(text).not.toMatch(FORBIDDEN_LEGACY_NAMES);
      }
    }
  });
});
