import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ledgerOpsPropertyApiRequirements } from "../../benchmarks/shared/app-spec/property-api-requirements.js";

const repoRoot = join(import.meta.dirname, "..", "..");

function collectPropsSources(): string {
  const roots = [
    join(repoRoot, "benchmarks/react-router"),
    join(repoRoot, "benchmarks/nextjs"),
    join(repoRoot, "benchmarks/shared/app-spec/props"),
  ];
  const chunks: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const file of walkTsFiles(root)) {
      if (!file.endsWith(".props.ts") && !root.includes("/props")) continue;
      if (root.includes("/props") && !file.endsWith(".ts")) continue;
      chunks.push(readFileSync(file, "utf8"));
    }
  }
  return chunks.join("\n");
}

function walkTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTsFiles(fullPath));
      continue;
    }
    if (entry.name.endsWith(".ts")) files.push(fullPath);
  }
  return files;
}

describe("ledgerops property api coverage", () => {
  it("uses every public property API across benchmark props suites", () => {
    const source = collectPropsSources();
    const missing = ledgerOpsPropertyApiRequirements
      .filter((entry) => !entry.pattern.test(source))
      .map((entry) => entry.id);
    expect(missing, `missing property APIs: ${missing.join(", ")}`).toEqual([]);
  });
});
