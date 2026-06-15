import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const checkerSrc = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/check",
);

describe("checker package architecture", () => {
  it("uses the Rust-backed checker integration slices", async () => {
    await Promise.all([
      expectPath("native.ts"),
      expectPath("check-model.ts"),
      expectPath("model-api.ts"),
      expectPath("serialize-properties.ts"),
      expectPath("slicing/slice-model.ts"),
    ]);
    await expect(
      access(join(checkerSrc, "engine/check-model.ts")),
    ).rejects.toThrow();
    await expect(
      access(join(checkerSrc, "runtime/effects.ts")),
    ).rejects.toThrow();
    await expect(access(join(checkerSrc, "eval.ts"))).rejects.toThrow();
    await expect(access(join(checkerSrc, "search.ts"))).rejects.toThrow();
    await expect(access(join(checkerSrc, "encode/index.ts"))).rejects.toThrow();
    await expect(access(join(checkerSrc, "search/index.ts"))).rejects.toThrow();
  });
});

async function expectPath(relativePath: string): Promise<void> {
  await expect(access(join(checkerSrc, relativePath))).resolves.toBeUndefined();
}
