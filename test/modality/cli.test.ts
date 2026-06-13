import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const todoDir = join(repoRoot, "examples", "todo-app");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const cliPath = join(repoRoot, "src", "modality", "cli.ts");

describe("modality CLI", () => {
  it("accepts the README extract command from an example app directory", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    const modelPath = join(artifactDir, "model.json");

    const { stdout } = await execFileAsync(tsxBin, [cliPath, "extract", "App.tsx", "--out", modelPath], {
      cwd: todoDir
    });

    const model = JSON.parse(await readFile(modelPath, "utf8"));
    expect(stdout).toContain(`model=${modelPath}`);
    expect(model.schemaVersion).toBe(1);
    expect(model.transitions.length).toBeGreaterThan(0);
  });
});
