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
import {
  renderHumanCheckTargets,
  runCheckCommand,
} from "../../src/cli/features/check/index.js";
import {
  renderHumanCiResult,
  runCiCommand,
} from "../../src/cli/features/ci/index.js";
import {
  renderHumanConformResult,
  runConformCommand,
} from "../../src/cli/features/conform/index.js";
import {
  renderHumanExportResult,
  runExportTlaCommand,
} from "../../src/cli/features/export/index.js";
import {
  renderHumanExtractTargets,
  runExtractCommand,
} from "../../src/cli/features/extract/index.js";
import {
  renderHumanInitResult,
  runInitCommand,
} from "../../src/cli/features/init/index.js";
import { routeMountScope } from "../../src/extract/lang/ts/driver/routes.js";
import { flagTrueProperty, propsFileBody } from "../helpers/props-file.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const todoDir = join(repoRoot, "examples", "todo-app");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const cliPath = join(repoRoot, "src", "cli", "cli.ts");
const CLI_E2E_TIMEOUT_MS = 180_000;

describe("modality CLI", () => {
  it("initializes a typed modality config (subprocess smoke test)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));

    const { stdout } = await execFileAsync(tsxBin, [cliPath, "init"], {
      cwd: dir,
    });

    const realDir = await realpath(dir);
    const configPath = join(realDir, "modality.config.ts");
    const config = await readFile(configPath, "utf8");
    expect(stdout).toContain("modality.config.ts");
    expect(stdout).toMatch(/^ [✓×⚠] modality\.config\.ts /m);
    expect(stdout).toContain("config created");
    expect(config).toContain(
      'import type { ModalityConfig } from "modality-ts/cli/extract";',
    );
    expect(config).toContain("satisfies ModalityConfig");
    expect(config).not.toContain('route: "/"');
  });

  it("initializes a typed modality config (in-process)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-init-"));
    const start = Date.now();
    const result = await runInitCommand({ cwd: dir });
    const durationMs = Date.now() - start;

    const config = await readFile(result.configPath, "utf8");
    expect(result.configPath).toContain("modality.config.ts");
    expect(config).toContain(
      'import type { ModalityConfig } from "modality-ts/cli/extract";',
    );
    expect(config).toContain("satisfies ModalityConfig");
    expect(config).not.toContain('route: "/"');

    const rendered = renderHumanInitResult(result, durationMs);
    expect(rendered.join("\n")).toContain("modality.config.ts");
    expect(rendered.join("\n")).toContain("config created");
  });

  it(
    "accepts the README extract command from an example app directory",
    async () => {
      const artifactDir = await mkdtemp(join(tmpdir(), "modality-cli-"));
      const modelPath = join(artifactDir, "model.json");

      const result = await runExtractCommand({
        sourcePath: join(todoDir, "App.tsx"),
        modelPath,
        packageJsonPath: join(todoDir, "package.json"),
      });

      const model = JSON.parse(await readFile(modelPath, "utf8"));
      expect(model.schemaVersion).toBe(1);
      expect(model.transitions.length).toBeGreaterThan(0);
      const rendered = humanExtractLines(result);
      expect(rendered).toMatch(/[✓×⚠]/);
      expect(rendered).toContain("App.tsx");
    },
    CLI_E2E_TIMEOUT_MS,
  );

  it("extracts inferred source files into per-props artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writeFixtureApp(dir);

    const result = await runExtractCommand({
      sourcePaths: ["src/App.tsx", "src/HomePage.tsx"].map((f) => join(dir, f)),
      modelPath: join(dir, ".modality", "models", "src", "App.model.json"),
      appModelPath: join(dir, ".modality", "models", "src", "App.props.ts"),
      packageJsonPath: join(dir, "package.json"),
    });

    const rendered = humanExtractLines(result);
    expect(rendered).toMatch(/[✓×⚠]/);
    expect(rendered).toContain("App.tsx");

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

    await runExtractCommand({
      sourcePaths: [join(dir, "src/HomePage.tsx")],
      modelPath: homeModelPath,
      appModelPath: join(
        dir,
        ".modality",
        "models",
        "src",
        "HomePage.props.ts",
      ),
      packageJsonPath: join(dir, "package.json"),
    });

    const appModel = JSON.parse(
      await readFile(
        join(dir, ".modality", "models", "src", "App.model.json"),
        "utf8",
      ),
    );
    expect(appModel.metadata.sourceHashes).toHaveProperty(
      join(dir, "src", "App.tsx"),
    );
    expect(await readFile(appModelPath, "utf8")).toContain("export const M = ");
    expect(await readFile(homeModelPath, "utf8")).toContain('"schemaVersion"');
    expect(
      await readFile(
        join(dir, ".modality", "models", "src", "HomePage.props.ts"),
        "utf8",
      ),
    ).toContain("export const M = ");
  });

  it("extracts discovered props into route-scoped artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writeRouteFixtureApp(dir);

    const routes = [
      {
        sourcePath: join(dir, "app", "root.tsx"),
        modelPath: join(dir, ".modality", "models", "app", "root.model.json"),
        appModelPath: join(dir, ".modality", "models", "app", "root.props.ts"),
        route: "/",
      },
      {
        sourcePath: join(dir, "app", "routes", "home.tsx"),
        modelPath: join(
          dir,
          ".modality",
          "models",
          "app",
          "routes",
          "home.model.json",
        ),
        appModelPath: join(
          dir,
          ".modality",
          "models",
          "app",
          "routes",
          "home.props.ts",
        ),
        route: "/",
        localVar: "local:Home.count",
      },
      {
        sourcePath: join(dir, "app", "routes", "analytics.tsx"),
        modelPath: join(
          dir,
          ".modality",
          "models",
          "app",
          "routes",
          "analytics.model.json",
        ),
        appModelPath: join(
          dir,
          ".modality",
          "models",
          "app",
          "routes",
          "analytics.props.ts",
        ),
        route: "/analytics",
        localVar: "local:Analytics.viewed",
      },
    ];

    await mkdir(join(dir, ".modality", "models", "app", "routes"), {
      recursive: true,
    });

    for (const r of routes) {
      await runExtractCommand({
        sourcePath: r.sourcePath,
        modelPath: r.modelPath,
        appModelPath: r.appModelPath,
        packageJsonPath: join(dir, "package.json"),
        ...(r.route ? { route: r.route } : {}),
      });
      await access(r.modelPath);
      await access(r.appModelPath!);
    }

    const homeModel = JSON.parse(
      await readFile(
        join(dir, ".modality", "models", "app", "routes", "home.model.json"),
        "utf8",
      ),
    );
    expect(
      homeModel.vars.find((decl: { id: string }) => decl.id === "sys:route")
        ?.initial,
    ).toBe("/");
    expect(
      homeModel.vars.find(
        (decl: { id: string }) => decl.id === "local:Home.count",
      )?.scope,
    ).toEqual(routeMountScope("/"));

    const analyticsModel = JSON.parse(
      await readFile(
        join(
          dir,
          ".modality",
          "models",
          "app",
          "routes",
          "analytics.model.json",
        ),
        "utf8",
      ),
    );
    expect(
      analyticsModel.vars.find(
        (decl: { id: string }) => decl.id === "sys:route",
      )?.initial,
    ).toBe("/analytics");
    expect(
      analyticsModel.vars.find(
        (decl: { id: string }) => decl.id === "local:Analytics.viewed",
      )?.scope,
    ).toEqual(routeMountScope("/analytics"));

    const routeScopedVars = analyticsModel.vars.filter(
      (decl: { scope?: { kind: string; id?: string } }) =>
        decl.scope?.kind === "mount-local" &&
        decl.scope.id?.startsWith("route:"),
    );
    expect(
      routeScopedVars.every(
        (decl: { scope?: { id?: string } }) => decl.scope?.id !== "route:/",
      ),
    ).toBe(true);
  });

  it("keeps merged extraction when explicit output flags are used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writeFixtureApp(dir);
    await mkdir(join(dir, ".modality"), { recursive: true });

    const result = await runExtractCommand({
      sourcePaths: [join(dir, "src/App.tsx"), join(dir, "src/HomePage.tsx")],
      modelPath: join(dir, ".modality", "model.json"),
      appModelPath: join(dir, ".modality", "app.model.ts"),
      packageJsonPath: join(dir, "package.json"),
    });

    const modelPath = join(dir, ".modality", "model.json");
    const appModelPath = join(dir, ".modality", "app.model.ts");
    const model = JSON.parse(await readFile(modelPath, "utf8"));
    expect(result.lines.join("\n")).toContain(".modality/model.json");
    expect(result.lines.join("\n")).toContain(".modality/app.model.ts");
    expect(model.metadata.sourceHashes).toHaveProperty(
      join(dir, "src", "App.tsx"),
    );
    expect(model.metadata.sourceHashes).toHaveProperty(
      join(dir, "src", "HomePage.tsx"),
    );
    expect(await readFile(appModelPath, "utf8")).toContain("export const M = ");
  });

  it("extracts multiple explicit source files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writeFixtureApp(dir);
    await mkdir(join(dir, ".modality"), { recursive: true });

    const result = await runExtractCommand({
      sourcePaths: [join(dir, "src/App.tsx"), join(dir, "src/HomePage.tsx")],
      modelPath: join(dir, ".modality", "model.json"),
      packageJsonPath: join(dir, "package.json"),
    });

    const model = JSON.parse(
      await readFile(join(dir, ".modality", "model.json"), "utf8"),
    );
    expect(result.lines.join("\n")).toContain(".modality/model.json");
    expect(model.metadata.sourceHashes).toHaveProperty(
      join(dir, "src", "App.tsx"),
    );
    expect(model.metadata.sourceHashes).toHaveProperty(
      join(dir, "src", "HomePage.tsx"),
    );
  });

  it("checks, exports, and conforms using default artifacts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writeFixtureApp(dir);
    await mkdir(join(dir, ".modality"), { recursive: true });
    const modelPath = join(dir, ".modality", "model.json");
    const appModelPath = join(dir, ".modality", "app.model.ts");

    await runExtractCommand({
      sourcePaths: [join(dir, "src/App.tsx"), join(dir, "src/HomePage.tsx")],
      modelPath,
      appModelPath,
      packageJsonPath: join(dir, "package.json"),
    });

    const reportPath = join(dir, ".modality", "report.json");
    const checkResult = await runCheckCommand({ modelPath, reportPath });
    const checkLines = humanCheckLines([checkResult]);
    expect(checkLines).not.toContain("Properties\n");
    expect(checkLines).not.toContain("Stats\n");
    expect(checkLines).not.toContain("Target ");
    expect(checkLines).toMatch(/[✓×⚠]/);
    expect(checkLines).toContain("Test Files");
    expect(checkLines).toContain("Duration");
    expect(JSON.parse(await readFile(reportPath, "utf8"))).toMatchObject({
      kind: "check-report",
    });

    const tlaOutPath = join(dir, ".modality", "model.tla");
    const exported = await runExportTlaCommand({
      modelPath,
      outPath: tlaOutPath,
    });
    const exportRendered = renderHumanExportResult({
      outPath: exported.outPath,
      moduleName: exported.moduleName,
      durationMs: 0,
    });
    expect(exportRendered.join("\n")).toContain("model.tla");
    expect(exportRendered.join("\n")).toContain("format tla");
    expect(await readFile(tlaOutPath, "utf8")).toContain(
      "---- MODULE extracted_model_Model ----",
    );

    const conformReportPath = join(dir, ".modality", "conform-report.json");
    const conform = await runConformCommand({
      modelPath,
      reportPath: conformReportPath,
    });
    const conformRendered = renderHumanConformResult({
      report: conform.report,
      reportPath: conformReportPath,
      durationMs: 0,
    });
    expect(conformRendered.join("\n")).toContain("conformance");
    expect(conformRendered.join("\n")).toContain("passRate");
    expect(JSON.parse(await readFile(conformReportPath, "utf8"))).toMatchObject(
      { kind: "conform-report" },
    );
  });

  it("emits colored structured check output when FORCE_COLOR is set", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writePerPropsCheckFixture(dir, {
      failingTarget: null,
      singleTarget: "root",
    });

    const modelPath = join(
      dir,
      ".modality",
      "models",
      "app",
      "root.model.json",
    );
    const reportPath = join(
      dir,
      ".modality",
      "models",
      "app",
      "root.report.json",
    );
    const result = await runCheckCommand({
      modelPath,
      reportPath,
      output: { color: true },
    });
    const rendered = humanCheckLines([result], { color: true });
    expect(rendered).toContain("[");
    expect(rendered).toContain("✓");
  });

  it("keeps replay trace path mandatory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));

    await expect(
      execFileAsync(tsxBin, [cliPath, "replay"], { cwd: dir }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Missing trace.json path"),
    });
  });

  it("stops gracefully when --max-states is hit (subprocess smoke test)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const reportPath = join(dir, "report.json");
    await writeFile(modelPath, JSON.stringify(tinyCheckModel()), "utf8");
    await writeFile(propsPath, propsFileBody(flagTrueProperty), "utf8");

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
    expect(stdout).toContain("maxStates");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    expect(report.diagnostics.limits.maxStates).toBe(1);
    expect(
      report.verdicts.some(
        (verdict: { status: string }) => verdict.status === "error",
      ),
    ).toBe(true);
  });

  it("stops gracefully when --max-states is hit (in-process)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-check-limits-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const reportPath = join(dir, "report.json");
    await writeFile(modelPath, JSON.stringify(tinyCheckModel()), "utf8");
    await writeFile(propsPath, propsFileBody(flagTrueProperty), "utf8");

    const result = await runCheckCommand({
      modelPath,
      propsPath,
      reportPath,
      searchLimits: { maxStates: 1 },
    });

    expect(result.exitCode).toBe(2);
    expect(result.lines.join("\n")).toContain("maxStates");
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
    const propsPath = join(dir, "props.ts");
    await writeFile(modelPath, JSON.stringify(tinyCheckModel()), "utf8");
    await writeFile(propsPath, "// no properties registered", "utf8");

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
    const propsPath = join(dir, "props.ts");
    await writeFile(modelPath, JSON.stringify(tinyCheckModel()), "utf8");
    await writeFile(propsPath, "// no properties registered", "utf8");

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

  it("checks each discovered props file against its generated model with no args", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writePerPropsCheckFixture(dir, { failingTarget: null });

    const rootModelPath = join(
      dir,
      ".modality",
      "models",
      "app",
      "root.model.json",
    );
    const rootPropsPath = join(dir, "app", "root.props.ts");
    const homeModelPath = join(
      dir,
      ".modality",
      "models",
      "app",
      "routes",
      "home.model.json",
    );
    const homePropsPath = join(dir, "app", "routes", "home.props.ts");

    const rootResult = await runCheckCommand({
      modelPath: rootModelPath,
      propsPath: rootPropsPath,
      reportPath: join(dir, ".modality", "models", "app", "root.report.json"),
    });
    const homeResult = await runCheckCommand({
      modelPath: homeModelPath,
      propsPath: homePropsPath,
      reportPath: join(
        dir,
        ".modality",
        "models",
        "app",
        "routes",
        "home.report.json",
      ),
    });

    const allLines = humanCheckLines([rootResult, homeResult]);
    expect(allLines).not.toContain("Target ");
    expect(allLines).not.toContain("Properties\n");
    expect(allLines).not.toContain("Stats\n");
    expect(allLines).toContain("Test Files");
    expect(allLines).toContain("  ✓ rootFlagCanBecomeTrue verified");
    expect(allLines).toContain("  ✓ homeFlagCanBecomeTrue verified");
    await access(join(dir, ".modality", "models", "app", "root.report.json"));
    await access(
      join(dir, ".modality", "models", "app", "routes", "home.report.json"),
    );
  });

  it("returns exit code 2 when any no-arg check target fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writePerPropsCheckFixture(dir, { failingTarget: "home" });

    const rootResult = await runCheckCommand({
      modelPath: join(dir, ".modality", "models", "app", "root.model.json"),
      propsPath: join(dir, "app", "root.props.ts"),
      reportPath: join(dir, ".modality", "models", "app", "root.report.json"),
    });
    const homeResult = await runCheckCommand({
      modelPath: join(
        dir,
        ".modality",
        "models",
        "app",
        "routes",
        "home.model.json",
      ),
      propsPath: join(dir, "app", "routes", "home.props.ts"),
      reportPath: join(
        dir,
        ".modality",
        "models",
        "app",
        "routes",
        "home.report.json",
      ),
    });

    const allLines = humanCheckLines([rootResult, homeResult]);
    expect(allLines).toContain("  ✓ rootFlagCanBecomeTrue verified");
    expect(allLines).toContain("  × homeFlagAlwaysFalse violated");
    expect(homeResult.exitCode).toBe(2);
  });

  it("fails clearly when generated models are missing for no-arg check", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await mkdir(join(dir, "app"), { recursive: true });
    await writeFile(
      join(dir, "app", "root.props.ts"),
      passingProps("root"),
      "utf8",
    );

    await expect(
      execFileAsync(tsxBin, [cliPath, "check"], { cwd: dir }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Missing inferred model files for props: .modality/models/app/root.model.json",
      ),
    });
  });

  it("rejects --report in no-arg multi-target check mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writePerPropsCheckFixture(dir, { failingTarget: null });

    await expect(
      execFileAsync(tsxBin, [cliPath, "check", "--report", "custom.json"], {
        cwd: dir,
      }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "--report requires an explicit model path when checking multiple generated models",
      ),
    });
  });

  it("keeps explicit single-model check report paths", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    const modelPath = join(dir, "model.json");
    const propsPath = join(dir, "props.ts");
    const reportPath = join(dir, "custom-report.json");
    await writeFile(modelPath, JSON.stringify(tinyCheckModel()), "utf8");
    await writeFile(propsPath, passingProps("root"), "utf8");

    await runCheckCommand({ modelPath, propsPath, reportPath });

    await access(reportPath);
  });

  it("derives the model path for modality ci from a props path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writePerPropsCheckFixture(dir, {
      failingTarget: null,
      singleTarget: "root",
    });
    const artifactDir = join(dir, ".modality", "ci-root");

    const result = await runCiCommand({
      modelPath: join(dir, ".modality", "models", "app", "root.model.json"),
      propsPath: join(dir, "app", "root.props.ts"),
      artifactDir,
    });

    const ciRendered = renderHumanCiResult({
      ...result.summary,
      reportPath: result.reportPath,
      tracesDir: result.tracesDir,
      durationMs: 0,
    });
    expect(ciRendered.join("\n")).toContain("check 0 violations, 0 errors");
    await access(join(artifactDir, "report.json"));
  });

  it("errors when conform has multiple generated models and no --model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writePerPropsCheckFixture(dir, { failingTarget: null });

    await expect(
      execFileAsync(tsxBin, [cliPath, "conform"], { cwd: dir }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Multiple generated models found; pass --model <path>",
      ),
    });
  });

  it("errors when export has multiple generated models and no model path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-cli-"));
    await writePerPropsCheckFixture(dir, { failingTarget: null });

    await expect(
      execFileAsync(tsxBin, [cliPath, "export"], { cwd: dir }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Multiple generated models found; pass a model path",
      ),
    });
  });
});

function humanExtractLines(
  result: import("../../src/cli/features/extract/index.js").ExtractCommandResult,
): string {
  return renderHumanExtractTargets(
    [
      {
        label: result.targetLabel,
        varCount: result.varCount,
        transitionCount: result.transitionCount,
        report: result.report,
        pluginLabels: result.pluginLabels,
        stateSpaceLine: result.stateSpaceLine,
        coarseDomainsLine: result.coarseDomainsLine,
        sliceStatsLine: result.sliceStatsLine,
        sliceEconomicsLine: result.sliceEconomicsLine,
        artifacts: result.artifacts,
        propsErrors: result.propsErrors,
      },
    ],
    { totalDurationMs: 0 },
  ).join("\n");
}

function humanCheckLines(
  results: Array<{
    check: import("modality-ts/check").CheckResult;
    report: import("modality-ts/core").CheckReport;
    reportPath?: string;
    artifacts: readonly import("../../src/cli/features/check/output.js").ArtifactPathEntry[];
  }>,
  options: { color?: boolean } = {},
): string {
  return renderHumanCheckTargets(
    results.map((r) => ({
      modelPath: "",
      propsPath: "",
      check: r.check,
      reportVerdicts: r.report.verdicts,
      ...(r.reportPath ? { reportPath: r.reportPath } : {}),
      artifacts: r.artifacts,
    })),
    {
      startedAt: new Date(0),
      totalDurationMs: 0,
      color: options.color,
    },
  ).join("\n");
}

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
    join(dir, "package.json"),
    JSON.stringify({ dependencies: { react: "^18.0.0" } }),
    "utf8",
  );
  await writeFile(
    join(dir, "app", "routes.ts"),
    `
    import { index, route } from "@react-router/dev/routes";
    export default [
      index("routes/home.tsx"),
      route("analytics", "routes/analytics.tsx"),
    ];
    `,
    "utf8",
  );
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
    join(dir, "app", "root.props.ts"),
    "// no properties registered",
    "utf8",
  );
  await writeFile(
    join(dir, "app", "routes", "home.props.ts"),
    "// no properties registered",
    "utf8",
  );
  await writeFile(
    join(dir, "app", "routes", "analytics.props.ts"),
    "// no properties registered",
    "utf8",
  );
}

async function writeFixtureApp(dir: string): Promise<void> {
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ dependencies: { react: "^18.0.0" } }),
    "utf8",
  );
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
    join(dir, "src", "App.props.ts"),
    "// no properties registered",
    "utf8",
  );
  await writeFile(
    join(dir, "src", "HomePage.props.ts"),
    "// no properties registered",
    "utf8",
  );
}

function passingProps(prefix: string): string {
  return propsFileBody(
    `reachable("${prefix}FlagCanBecomeTrue", eq(variable("flag"), true));`,
  );
}

function failingProps(): string {
  return propsFileBody(
    `always("homeFlagAlwaysFalse", eq(variable("flag"), false));`,
  );
}

async function writePerPropsCheckFixture(
  dir: string,
  options: { failingTarget: "home" | null; singleTarget?: "root" },
): Promise<void> {
  await mkdir(join(dir, "app", "routes"), { recursive: true });
  await mkdir(join(dir, ".modality", "models", "app", "routes"), {
    recursive: true,
  });
  const modelJson = JSON.stringify(tinyCheckModel());
  await writeFile(
    join(dir, ".modality", "models", "app", "root.model.json"),
    modelJson,
    "utf8",
  );
  await writeFile(
    join(dir, "app", "root.props.ts"),
    passingProps("root"),
    "utf8",
  );
  if (options.singleTarget === "root") return;
  await writeFile(
    join(dir, ".modality", "models", "app", "routes", "home.model.json"),
    modelJson,
    "utf8",
  );
  await writeFile(
    join(dir, "app", "routes", "home.props.ts"),
    options.failingTarget === "home" ? failingProps() : passingProps("home"),
    "utf8",
  );
}
