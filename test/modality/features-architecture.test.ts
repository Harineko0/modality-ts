import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCheckCommand } from "../../src/cli/features/check/index.js";
import { runCiCommand } from "../../src/cli/features/ci/index.js";
import { runConformCommand } from "../../src/cli/features/conform/index.js";
import { runExportTlaCommand } from "../../src/cli/features/export/index.js";
import { runExtractCommand } from "../../src/cli/features/extract/index.js";
import { runGenerateCommand } from "../../src/cli/features/generate/index.js";
import { runInitCommand } from "../../src/cli/features/init/index.js";
import { runReplayCommand } from "../../src/cli/features/replay/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const modalitySrc = resolve(repoRoot, "src/cli");
const featuresSrc = resolve(modalitySrc, "features");
const featureNames = [
  "check",
  "ci",
  "conform",
  "export",
  "extract",
  "generate",
  "init",
  "replay",
] as const;

describe("modality feature slices", () => {
  it("publish command entry points from feature directories", () => {
    expect(runCheckCommand).toBeTypeOf("function");
    expect(runCiCommand).toBeTypeOf("function");
    expect(runConformCommand).toBeTypeOf("function");
    expect(runExportTlaCommand).toBeTypeOf("function");
    expect(runExtractCommand).toBeTypeOf("function");
    expect(runGenerateCommand).toBeTypeOf("function");
    expect(runInitCommand).toBeTypeOf("function");
    expect(runReplayCommand).toBeTypeOf("function");
  });

  it("keep feature slices isolated except for documented ci orchestration", async () => {
    const files = (await sourceFiles(featuresSrc)).filter(
      (file) => !file.endsWith(".test.ts"),
    );
    const violations: string[] = [];

    for (const file of files) {
      const feature = featureNameFor(file);
      const text = await readFile(file, "utf8");
      for (const specifier of importSpecifiers(text)) {
        const targetFeature = importedFeature(specifier);
        if (!targetFeature || targetFeature === feature) continue;
        if (
          feature === "ci" &&
          (specifier === "../../check.js" || specifier === "../../conform.js")
        )
          continue;
        violations.push(`${relativeToModality(file)} imports ${specifier}`);
      }
    }

    expect(violations).toEqual([]);
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

function featureNameFor(file: string): string {
  const relative = file.slice(featuresSrc.length + 1);
  return relative.split("/")[0] ?? "";
}

function importedFeature(specifier: string): string | undefined {
  const directMatch = specifier.match(/(?:^|\/)features\/([^/]+)/);
  if (directMatch?.[1]) return directMatch[1];

  const siblingMatch = specifier.match(/^\.\.\/([^/.]+)/);
  if (
    siblingMatch?.[1] &&
    featureNames.includes(siblingMatch[1] as (typeof featureNames)[number])
  ) {
    return siblingMatch[1];
  }

  const wrapperMatch = specifier.match(/^\.\.\/\.\.\/([^/.]+)\.js$/);
  if (
    wrapperMatch?.[1] &&
    featureNames.includes(wrapperMatch[1] as (typeof featureNames)[number])
  ) {
    return wrapperMatch[1];
  }

  return undefined;
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

function relativeToModality(path: string): string {
  return path.slice(modalitySrc.length + 1);
}
