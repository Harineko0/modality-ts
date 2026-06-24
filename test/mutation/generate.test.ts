import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateMutants } from "../../tools/mutation/generate.js";

describe("generateMutants", () => {
  it("samples deterministically and writes one isolated mutation per app copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "modality-mut-src-"));
    const workA = await mkdtemp(join(tmpdir(), "modality-mut-a-"));
    const workB = await mkdtemp(join(tmpdir(), "modality-mut-b-"));
    await mkdir(join(root, "src", "nested"), { recursive: true });
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    await writeFile(join(root, "src", "nested", "helper.ts"), "export {}\n");
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
    await expect(
      readFile(join(first[0]!.appRoot, "src", "nested", "helper.ts"), "utf8"),
    ).resolves.toBe("export {}\n");
    expect(
      (await lstat(join(first[0]!.appRoot, "node_modules"))).isSymbolicLink(),
    ).toBe(true);
  });

  it("dereferences app symlinks so mutations cannot write through to shared sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "modality-mut-symlink-app-"));
    const shared = await mkdtemp(join(tmpdir(), "modality-mut-shared-"));
    const work = await mkdtemp(join(tmpdir(), "modality-mut-symlink-work-"));
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "package.json"), "{}\n", "utf8");
    await writeFile(
      join(shared, "logic.ts"),
      [
        "export function classify(count: number) {",
        "  return count < 2 ? 'low' : 'ok';",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );
    await symlink(shared, join(root, "src", "shared"), "dir");

    const [mutant] = await generateMutants({
      appRoot: root,
      sourcePaths: ["src/shared/logic.ts"],
      workDir: work,
      mutation: {
        maxMutants: 1,
        seed: 1,
        operators: ["conditional-boundary"],
      },
    });

    expect(mutant).toBeDefined();
    await expect(readFile(join(shared, "logic.ts"), "utf8")).resolves.toContain(
      "count < 2",
    );
    await expect(
      readFile(join(mutant!.appRoot, "src", "shared", "logic.ts"), "utf8"),
    ).resolves.toContain("count <= 2");
  });

  it("links sibling workspace directories so the harness's ../shared import resolves", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "modality-mut-ws-"));
    const appRoot = join(workspace, "app");
    const sharedRoot = join(workspace, "shared");
    const work = await mkdtemp(join(tmpdir(), "modality-mut-ws-work-"));
    await mkdir(join(appRoot, "node_modules"), { recursive: true });
    await mkdir(sharedRoot, { recursive: true });
    await writeFile(join(appRoot, "package.json"), "{}\n", "utf8");
    await writeFile(join(sharedRoot, "marker.ts"), "export const shared = 1\n");
    await writeFile(
      join(appRoot, "App.tsx"),
      [
        "export function App({ count }: { count: number }) {",
        "  return count < 2 ? 'low' : 'ok';",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const [mutant] = await generateMutants({
      appRoot,
      sourcePaths: ["App.tsx"],
      workDir: work,
      mutation: { maxMutants: 1, seed: 1, operators: ["conditional-boundary"] },
    });

    expect(mutant).toBeDefined();
    // The snapshot lives at <work>/<id>/app, so the harness's `../shared`
    // resolves to <work>/<id>/shared, which must link to the real shared dir.
    const linkedShared = join(mutant!.appRoot, "..", "shared");
    const stats = await lstat(linkedShared);
    expect(stats.isSymbolicLink()).toBe(true);
    await expect(
      readFile(join(linkedShared, "marker.ts"), "utf8"),
    ).resolves.toContain("export const shared");
  });
});
