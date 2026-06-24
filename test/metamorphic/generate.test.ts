import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateMetamorphicVariants } from "../../tools/metamorphic/generate.js";

describe("generateMetamorphicVariants", () => {
  it("copies the app tree and links dependencies for each variant", async () => {
    const root = await mkdtemp(join(tmpdir(), "modality-meta-src-"));
    const work = await mkdtemp(join(tmpdir(), "modality-meta-work-"));
    await mkdir(join(root, "src", "nested"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    await writeFile(join(root, "src", "nested", "helper.ts"), "export {}\n");
    await writeFile(
      join(root, "App.tsx"),
      [
        "export function App() {",
        "  return <button>Save</button>;",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const variants = await generateMetamorphicVariants({
      appRoot: root,
      sourcePaths: ["App.tsx"],
      workDir: work,
      metamorphic: {
        maxVariants: 1,
        seed: 7,
        transforms: ["comment-whitespace"],
      },
    });

    expect(variants).toHaveLength(1);
    await expect(
      readFile(
        join(variants[0]!.appRoot, "src", "nested", "helper.ts"),
        "utf8",
      ),
    ).resolves.toBe("export {}\n");
    expect(
      (
        await lstat(join(variants[0]!.appRoot, "node_modules"))
      ).isSymbolicLink(),
    ).toBe(true);
  });
});
