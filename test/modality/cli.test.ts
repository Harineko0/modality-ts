import { execFile } from "node:child_process";
import {
  access,
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

  it("extracts inferred source files into per-props artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writeFixtureApp(dir);

    const { stdout } = await execFileAsync(tsxBin, [cliPath, "extract"], {
      cwd: dir,
    });

    const appModelPath = join(
      dir,
      ".modality",
      "models",
      "src",
      "App.props.ts",
    );
    const homeModelPath = join(
      dir,
      ".modality",
      "models",
      "src",
      "HomePage.model.json",
    );
    const homeAppModelPath = join(
      dir,
      ".modality",
      "models",
      "src",
      "HomePage.props.ts",
    );
    const model = JSON.parse(
      await readFile(
        join(dir, ".modality", "models", "src", "App.model.json"),
        "utf8",
      ),
    );
    const realDir = await realpath(dir);
    expect(stdout).toContain("model=.modality/models/src/App.model.json");
    expect(stdout).toContain("appModel=.modality/models/src/App.props.ts");
    expect(stdout).toContain("model=.modality/models/src/HomePage.model.json");
    expect(stdout).toContain("appModel=.modality/models/src/HomePage.props.ts");
    expect(await readFile(appModelPath, "utf8")).toContain("export const M = ");
    expect(await readFile(homeModelPath, "utf8")).toContain('"schemaVersion"');
    expect(await readFile(homeAppModelPath, "utf8")).toContain(
      "export const M = ",
    );
    expect(model.metadata.sourceHashes).toHaveProperty(
      join(realDir, "src", "App.tsx"),
    );
    await expect(
      access(join(dir, ".modality", "model.json")),
    ).rejects.toThrow();
  });

  it("extracts discovered props into route-scoped artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writeRouteFixtureApp(dir);

    const { stdout } = await execFileAsync(tsxBin, [cliPath, "extract"], {
      cwd: dir,
    });

    const artifacts = [
      ".modality/models/app/root.model.json",
      ".modality/models/app/root.props.ts",
      ".modality/models/app/routes/home.model.json",
      ".modality/models/app/routes/home.props.ts",
      ".modality/models/app/routes/analytics.model.json",
      ".modality/models/app/routes/analytics.props.ts",
    ];
    for (const artifact of artifacts) {
      await access(join(dir, artifact));
      expect(stdout).toContain(
        artifact.endsWith(".model.json")
          ? `model=${artifact}`
          : `appModel=${artifact}`,
      );
    }
    await expect(
      access(join(dir, ".modality", "model.json")),
    ).rejects.toThrow();
  });

  it("keeps merged extraction when explicit output flags are used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writeFixtureApp(dir);

    const { stdout } = await execFileAsync(
      tsxBin,
      [
        cliPath,
        "extract",
        "--out",
        ".modality/model.json",
        "--app-model",
        ".modality/app.model.ts",
      ],
      { cwd: dir },
    );

    const modelPath = join(dir, ".modality", "model.json");
    const appModelPath = join(dir, ".modality", "app.model.ts");
    const model = JSON.parse(await readFile(modelPath, "utf8"));
    const realDir = await realpath(dir);
    expect(stdout).toContain("model=.modality/model.json");
    expect(stdout).toContain("appModel=.modality/app.model.ts");
    expect(model.metadata.sourceHashes).toHaveProperty(
      join(realDir, "src", "App.tsx"),
    );
    expect(model.metadata.sourceHashes).toHaveProperty(
      join(realDir, "src", "HomePage.tsx"),
    );
    expect(await readFile(appModelPath, "utf8")).toContain("export const M = ");
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
    await execFileAsync(
      tsxBin,
      [
        cliPath,
        "extract",
        "--out",
        ".modality/model.json",
        "--app-model",
        ".modality/app.model.ts",
      ],
      { cwd: dir },
    );

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

  it("stops gracefully when --max-states is hit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    const reportPath = join(dir, "report.json");
    await writeFile(modelPath, JSON.stringify(tinyCheckModel()), "utf8");
    await writeFile(
      propsPath,
      `export const properties = [
        { kind: "reachable", name: "flagCanBecomeTrue", predicate: state => state.flag === true, reads: ["flag"] }
      ];`,
      "utf8",
    );

    let stdout = "";
    try {
      await execFileAsync(
        tsxBin,
        [
          cliPath,
          "check",
          modelPath,
          propsPath,
          "--max-states",
          "1",
          "--report",
          reportPath,
        ],
        { cwd: dir },
      );
    } catch (error: unknown) {
      const execError = error as { stdout?: string; code?: number };
      expect(execError.code).toBe(2);
      stdout = execError.stdout ?? "";
    }
    expect(stdout).toContain("search-limit=maxStates");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.diagnostics.limits.maxStates).toBe(1);
    expect(
      report.verdicts.some(
        (verdict: { status: string }) => verdict.status === "error",
      ),
    ).toBe(true);
  });

  it("rejects invalid --max-states values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    await writeFile(modelPath, JSON.stringify(tinyCheckModel()), "utf8");
    await writeFile(propsPath, "export const properties = [];", "utf8");

    await expect(
      execFileAsync(
        tsxBin,
        [cliPath, "check", modelPath, propsPath, "--max-states", "nope"],
        {
          cwd: dir,
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Invalid --max-states value"),
    });
  });

  it("rejects --no-search-limits combined with explicit limits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.mjs");
    await writeFile(modelPath, JSON.stringify(tinyCheckModel()), "utf8");
    await writeFile(propsPath, "export const properties = [];", "utf8");

    await expect(
      execFileAsync(
        tsxBin,
        [
          cliPath,
          "check",
          modelPath,
          propsPath,
          "--no-search-limits",
          "--max-states",
          "1",
        ],
        { cwd: dir },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("cannot be combined"),
    });
  });
});

function tinyCheckModel() {
  return {
    schemaVersion: 1,
    id: "cli-search-limit-fixture",
    bounds: { maxDepth: 2, maxPending: 1, maxInternalSteps: 4 },
    vars: [
      {
        id: "flag",
        domain: { kind: "bool" },
        origin: "system",
        scope: { kind: "global" },
        initial: false,
      },
    ],
    transitions: [
      {
        id: "setFlag",
        cls: "user",
        label: {
          kind: "click",
          locator: { kind: "testId", value: "set-flag" },
        },
        source: [],
        guard: { kind: "not", args: [{ kind: "read", var: "flag" }] },
        effect: {
          kind: "assign",
          var: "flag",
          expr: { kind: "lit", value: true },
        },
        reads: ["flag"],
        writes: ["flag"],
        confidence: "manual",
      },
    ],
  };
}

async function writeRouteFixtureApp(dir: string): Promise<void> {
  await mkdir(join(dir, "app", "routes"), { recursive: true });
  await writeFile(
    join(dir, "app", "root.tsx"),
    `
    import { useState } from "react";
    export function Root() {
      const [ready, setReady] = useState(false);
      return <button onClick={() => setReady(true)}>Ready {String(ready)}</button>;
    }
    `,
    "utf8",
  );
  await writeFile(
    join(dir, "app", "routes", "home.tsx"),
    `
    import { useState } from "react";
    export function Home() {
      const [count, setCount] = useState(0);
      return <button onClick={() => setCount(count + 1)}>Count {count}</button>;
    }
    `,
    "utf8",
  );
  await writeFile(
    join(dir, "app", "routes", "analytics.tsx"),
    `
    import { useState } from "react";
    export function Analytics() {
      const [viewed, setViewed] = useState(false);
      return <button onClick={() => setViewed(true)}>Viewed {String(viewed)}</button>;
    }
    `,
    "utf8",
  );
  await writeFile(
    join(dir, "app", "root.props.mjs"),
    "export const properties = [];",
    "utf8",
  );
  await writeFile(
    join(dir, "app", "routes", "home.props.mjs"),
    "export const properties = [];",
    "utf8",
  );
  await writeFile(
    join(dir, "app", "routes", "analytics.props.mjs"),
    "export const properties = [];",
    "utf8",
  );
}

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
