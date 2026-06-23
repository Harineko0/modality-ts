import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

describe("framework slice boundaries", () => {
  it("react framework slice does not import cli", async () => {
    const reactDir = resolve(repoRoot, "src/extract/plugins/framework/react");
    const files = ["hooks.ts", "render-boundaries.ts", "index.ts"];
    const violations: string[] = [];
    for (const file of files) {
      const text = await readFile(resolve(reactDir, file), "utf8");
      for (const match of text.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
        const specifier = match[1]!;
        if (specifier.includes("cli")) {
          violations.push(`${file} imports ${specifier}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
