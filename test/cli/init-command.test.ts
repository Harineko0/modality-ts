import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectSourceScaffolds,
  runInitCommand,
} from "../../src/cli/features/init/command.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "modality-init-"));
  tempDirs.push(dir);
  return dir;
}

function assertTypechecks(source: string): void {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    reportDiagnostics: true,
  });
  const errors = result.diagnostics?.filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  expect(errors ?? []).toEqual([]);
}

describe("runInitCommand", () => {
  it("scaffolds explicit plugins from package.json deps", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: {
          react: "^19.0.0",
          jotai: "^2.0.0",
          swr: "^2.0.0",
        },
      }),
      "utf8",
    );

    const result = await runInitCommand({ cwd });
    const content = await readFile(result.configPath, "utf8");

    expect(content).toContain(
      'import { useStateSource } from "modality-ts/extract/sources/use-state";',
    );
    expect(content).toContain(
      'import { jotaiSource } from "modality-ts/extract/sources/jotai";',
    );
    expect(content).toContain(
      'import { swrSource } from "modality-ts/extract/sources/swr";',
    );
    expect(content).not.toContain("zustandSource");
    expect(content).toContain("plugins: [");
    expect(content).toContain("useStateSource(),");
    expect(content).toContain("jotaiSource(),");
    expect(content).toContain("swrSource(),");
    expect(content).toContain("// framework: reactFramework(),");
    expect(result.lines).toContain("plugins=use-state,jotai,swr");
    assertTypechecks(content);
  });

  it("writes bounds-only config when package.json is missing", async () => {
    const cwd = await makeTempDir();

    const result = await runInitCommand({ cwd });
    const content = await readFile(result.configPath, "utf8");

    expect(content).not.toContain("plugins:");
    expect(content).toContain("bounds:");
    expect(result.lines).toEqual([`config=${result.configPath}`]);
    assertTypechecks(content);
  });

  it("refuses to overwrite an existing config", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "modality.config.ts"),
      "export default {};\n",
      "utf8",
    );

    await expect(runInitCommand({ cwd })).rejects.toThrow();
  });

  it("includes redux when any redux package is present", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        devDependencies: {
          react: "^19.0.0",
          "@reduxjs/toolkit": "^2.0.0",
        },
      }),
      "utf8",
    );

    const scaffolds = await detectSourceScaffolds(cwd);
    expect(scaffolds.map((scaffold) => scaffold.id)).toEqual([
      "use-state",
      "redux",
    ]);
  });

  it("ignores unrelated dependencies", async () => {
    const cwd = await makeTempDir();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        dependencies: {
          lodash: "^4.0.0",
        },
      }),
      "utf8",
    );

    expect(await detectSourceScaffolds(cwd)).toEqual([]);
  });
});
