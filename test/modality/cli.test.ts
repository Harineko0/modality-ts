import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const todoDir = join(repoRoot, "examples", "todo-app");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const cliPath = join(repoRoot, "src", "cli", "cli.ts");

describe("modality CLI", () => {
  it("initializes a typed modality config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));

    const { stdout } = await execFileAsync(tsxBin, [cliPath, "init"], {
      cwd: dir,
    });

    const realDir = await realpath(dir);
    const configPath = join(realDir, "modality.config.ts");
    const config = await readFile(configPath, "utf8");
    expect(stdout).toContain(`config=${configPath}`);
    expect(config).toContain(
      'import type { ModalityConfig } from "modality-ts/cli/extract";',
    );
    expect(config).toContain("satisfies ModalityConfig");
  });

  it("accepts the README extract command from an example app directory", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    const modelPath = join(artifactDir, "model.json");

    const { stdout } = await execFileAsync(
      tsxBin,
      [cliPath, "extract", "App.tsx", "--out", modelPath],
      {
        cwd: todoDir,
      },
    );

    const model = JSON.parse(await readFile(modelPath, "utf8"));
    expect(stdout).toContain(`model=${modelPath}`);
    expect(model.schemaVersion).toBe(1);
    expect(model.transitions.length).toBeGreaterThan(0);
  });

  it("extracts inferred source files into default artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writeFixtureApp(dir);

    const { stdout } = await execFileAsync(tsxBin, [cliPath, "extract"], {
      cwd: dir,
    });

    const modelPath = join(dir, ".modality", "model.json");
    const appModelPath = join(dir, ".modality", "app.model.ts");
    const model = JSON.parse(await readFile(modelPath, "utf8"));
    const realDir = await realpath(dir);
    expect(stdout).toContain("model=.modality/model.json");
    expect(stdout).toContain("appModel=.modality/app.model.ts");
    expect(await readFile(appModelPath, "utf8")).toContain("export const M = ");
    expect(model.metadata.sourceHashes).toHaveProperty(
      join(realDir, "src", "App.tsx"),
    );
    expect(model.metadata.sourceHashes).toHaveProperty(
      join(realDir, "src", "HomePage.tsx"),
    );
  });

  it("extracts multiple explicit source files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writeFixtureApp(dir);

    const { stdout } = await execFileAsync(
      tsxBin,
      [cliPath, "extract", "src/App.tsx", "src/HomePage.tsx"],
      { cwd: dir },
    );

    const model = JSON.parse(
      await readFile(join(dir, ".modality", "model.json"), "utf8"),
    );
    const realDir = await realpath(dir);
    expect(stdout).toContain("model=.modality/model.json");
    expect(model.metadata.sourceHashes).toHaveProperty(
      join(realDir, "src", "App.tsx"),
    );
    expect(model.metadata.sourceHashes).toHaveProperty(
      join(realDir, "src", "HomePage.tsx"),
    );
  });

  it("checks, exports, and conforms using default artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writeFixtureApp(dir);
    await execFileAsync(tsxBin, [cliPath, "extract"], { cwd: dir });

    const check = await execFileAsync(tsxBin, [cliPath, "check"], {
      cwd: dir,
    });
    expect(check.stdout).toContain("states=");
    expect(
      JSON.parse(await readFile(join(dir, ".modality", "report.json"), "utf8")),
    ).toMatchObject({ kind: "check-report" });

    const exported = await execFileAsync(tsxBin, [cliPath, "export"], {
      cwd: dir,
    });
    expect(exported.stdout).toContain("export=.modality/model.tla");
    expect(
      await readFile(join(dir, ".modality", "model.tla"), "utf8"),
    ).toContain("---- MODULE extracted_model_Model ----");

    const conform = await execFileAsync(tsxBin, [cliPath, "conform"], {
      cwd: dir,
    });
    expect(conform.stdout).toContain("conform: total=");
    expect(
      JSON.parse(
        await readFile(join(dir, ".modality", "conform-report.json"), "utf8"),
      ),
    ).toMatchObject({ kind: "conform-report" });
  });

  it("keeps replay trace path mandatory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));

    await expect(
      execFileAsync(tsxBin, [cliPath, "replay"], { cwd: dir }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Missing trace.json path"),
    });
  });
});

async function writeFixtureApp(dir: string): Promise<void> {
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(
    join(dir, "src", "App.tsx"),
    `
    import { useState } from "react";
    export function App() {
      const [flag, setFlag] = useState(false);
      return <button onClick={() => setFlag(true)}>Set {String(flag)}</button>;
    }
    `,
    "utf8",
  );
  await writeFile(
    join(dir, "src", "HomePage.tsx"),
    `
    import { useState } from "react";
    export function HomePage() {
      const [count, setCount] = useState<0 | 1>(0);
      return <button onClick={() => setCount(1)}>Count {count}</button>;
    }
    `,
    "utf8",
  );
  await writeFile(
    join(dir, "src", "App.props.mjs"),
    "export const properties = [];",
    "utf8",
  );
  await writeFile(
    join(dir, "src", "HomePage.props.mjs"),
    "export const properties = [];",
    "utf8",
  );
}
