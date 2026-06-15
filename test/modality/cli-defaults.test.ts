import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  artifactPathsForPropsFile,
  discoverPropsFiles,
  inferExtractTargetsFromProps,
  inferSourceFilesFromProps,
} from "../../src/cli/defaults.js";

describe("CLI default discovery", () => {
  it("discovers props files deterministically while skipping generated dirs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));
    await mkdir(join(dir, "src", "components"), { recursive: true });
    await mkdir(join(dir, ".modality"), { recursive: true });
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(dir, "src", "Home.props.mjs"), "", "utf8");
    await writeFile(
      join(dir, "src", "components", "Form.props.mjs"),
      "",
      "utf8",
    );
    await writeFile(join(dir, ".modality", "Skip.props.mjs"), "", "utf8");
    await writeFile(
      join(dir, "node_modules", "pkg", "Skip.props.mjs"),
      "",
      "utf8",
    );

    expect(await discoverPropsFiles(dir)).toEqual([
      join(dir, "src", "components", "Form.props.mjs"),
      join(dir, "src", "Home.props.mjs"),
    ]);
  });

  it("infers source files from props files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "App.props.mjs"), "", "utf8");
    await writeFile(join(dir, "src", "App.tsx"), "", "utf8");

    expect(await inferSourceFilesFromProps(dir)).toEqual([
      join(dir, "src", "App.tsx"),
    ]);
  });

  it("fails clearly when no props files exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));

    await expect(inferSourceFilesFromProps(dir)).rejects.toThrow(
      `No *.props.mjs files found under ${dir}`,
    );
  });

  it("fails clearly when an inferred source file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "App.props.mjs"), "", "utf8");

    await expect(inferSourceFilesFromProps(dir)).rejects.toThrow(
      `Missing inferred source files for props: ${join(dir, "src", "App.tsx")}`,
    );
  });

  it("derives per-props artifact paths under .modality/models", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    await writeFile(join(dir, "app", "root.props.mjs"), "", "utf8");
    await writeFile(join(dir, "app", "root.tsx"), "", "utf8");
    await writeFile(join(dir, "app", "routes", "$slug.props.mjs"), "", "utf8");
    await writeFile(join(dir, "app", "routes", "$slug.tsx"), "", "utf8");
    await writeFile(
      join(dir, "app", "routes", "analytics.props.mjs"),
      "",
      "utf8",
    );
    await writeFile(join(dir, "app", "routes", "analytics.tsx"), "", "utf8");

    expect(await inferExtractTargetsFromProps(dir)).toEqual([
      {
        propsPath: join(dir, "app", "root.props.mjs"),
        sourcePath: join(dir, "app", "root.tsx"),
        modelPath: join(".modality", "models", "app", "root.model.json"),
        appModelPath: join(".modality", "models", "app", "root.props.ts"),
      },
      {
        propsPath: join(dir, "app", "routes", "$slug.props.mjs"),
        sourcePath: join(dir, "app", "routes", "$slug.tsx"),
        modelPath: join(
          ".modality",
          "models",
          "app",
          "routes",
          "$slug.model.json",
        ),
        appModelPath: join(
          ".modality",
          "models",
          "app",
          "routes",
          "$slug.props.ts",
        ),
      },
      {
        propsPath: join(dir, "app", "routes", "analytics.props.mjs"),
        sourcePath: join(dir, "app", "routes", "analytics.tsx"),
        modelPath: join(
          ".modality",
          "models",
          "app",
          "routes",
          "analytics.model.json",
        ),
        appModelPath: join(
          ".modality",
          "models",
          "app",
          "routes",
          "analytics.props.ts",
        ),
      },
    ]);
  });

  it("maps artifact paths from a props file relative to the project root", () => {
    const root = "/project";
    expect(
      artifactPathsForPropsFile(
        join(root, "app", "routes", "home.props.mjs"),
        root,
      ),
    ).toEqual({
      modelPath: join(
        ".modality",
        "models",
        "app",
        "routes",
        "home.model.json",
      ),
      appModelPath: join(
        ".modality",
        "models",
        "app",
        "routes",
        "home.props.ts",
      ),
    });
  });

  it("fails clearly when inferExtractTargetsFromProps finds a missing sibling tsx", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));
    await mkdir(join(dir, "app"), { recursive: true });
    await writeFile(join(dir, "app", "root.props.mjs"), "", "utf8");

    await expect(inferExtractTargetsFromProps(dir)).rejects.toThrow(
      `Missing inferred source files for props: ${join(dir, "app", "root.tsx")}`,
    );
  });
});
