import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateMutants } from "../../tools/mutation/generate.js";

describe("generateMutants", () => {
  it("samples deterministically and writes one isolated mutation per app copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "modality-mut-src-"));
    const workA = await mkdtemp(join(tmpdir(), "modality-mut-a-"));
    const workB = await mkdtemp(join(tmpdir(), "modality-mut-b-"));
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    await writeFile(
      join(root, "App.tsx"),
      [
        "export function App({ count }: { count: number }) {",
        "  if (count < 2) return 'low';",
        "  if (count > 5) return 'high';",
        "  return 'ok';",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const options = {
      appRoot: root,
      sourcePaths: ["App.tsx"],
      mutation: {
        maxMutants: 2,
        seed: 42,
        operators: ["conditional-boundary"],
      },
    };
    const first = await generateMutants({ ...options, workDir: workA });
    const second = await generateMutants({ ...options, workDir: workB });

    expect(first.map((mutant) => mutant.siteId)).toEqual(
      second.map((mutant) => mutant.siteId),
    );
    expect(first).toHaveLength(2);
    const mutatedA = await readFile(
      join(first[0]!.appRoot, first[0]!.file),
      "utf8",
    );
    const mutatedB = await readFile(
      join(first[1]!.appRoot, first[1]!.file),
      "utf8",
    );
    expect(mutatedA).not.toEqual(mutatedB);
    await writeFile(join(first[0]!.appRoot, "marker.txt"), "a", "utf8");
    await expect(
      readFile(join(first[1]!.appRoot, "marker.txt"), "utf8"),
    ).rejects.toThrow();
  });
});
