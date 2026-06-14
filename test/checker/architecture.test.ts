import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const checkerSrc = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/check");

describe("checker package architecture", () => {
  it("uses the Spec 05 checker slices", async () => {
    await Promise.all([
      expectPath("diagnostics/vacuity.ts"),
      expectPath("engine/check-model.ts"),
      expectPath("properties/finalize.ts"),
      expectPath("runtime/effects.ts"),
      expectPath("slicing/slice-model.ts"),
      expectPath("traces/trace.ts")
    ]);
    await expect(access(join(checkerSrc, "eval.ts"))).rejects.toThrow();
    await expect(access(join(checkerSrc, "search.ts"))).rejects.toThrow();
    await expect(access(join(checkerSrc, "encode/index.ts"))).rejects.toThrow();
    await expect(access(join(checkerSrc, "search/index.ts"))).rejects.toThrow();
  });
});

async function expectPath(relativePath: string): Promise<void> {
  await expect(access(join(checkerSrc, relativePath))).resolves.toBeUndefined();
}
