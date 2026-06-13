import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const checkerSrc = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/checker");

describe("checker package architecture", () => {
  it("uses the Spec 05 checker slices", async () => {
    await Promise.all([
      expectPath("encode/index.ts"),
      expectPath("search/index.ts"),
      expectPath("monitors/index.ts"),
      expectPath("slicing/index.ts"),
      expectPath("traces/index.ts")
    ]);
    await expect(access(join(checkerSrc, "eval.ts"))).rejects.toThrow();
    await expect(access(join(checkerSrc, "search.ts"))).rejects.toThrow();
  });
});

async function expectPath(relativePath: string): Promise<void> {
  await expect(access(join(checkerSrc, relativePath))).resolves.toBeUndefined();
}
