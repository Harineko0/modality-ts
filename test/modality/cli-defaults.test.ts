import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  artifactPathsForPropsFile,
  discoverGeneratedModelFiles,
  discoverPropsFiles,
  inferCheckTargetsFromProps,
  inferExtractTargetsFromProps,
  inferSourceFilesFromProps,
  safeSliceFileNamesForProperties,
  sliceArtifactsDirForModel,
  sliceManifestPathForModel,
} from "../../src/cli/defaults.js";

describe("CLI default discovery", () => {
  it("discovers props files deterministically while skipping generated dirs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));
    await mkdir(join(dir, "src", "components"), { recursive: true });
    await mkdir(join(dir, ".modality"), { recursive: true });
    await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(dir, "src", "Home.props.ts"), "", "utf8");
    await writeFile(
      join(dir, "src", "components", "Form.props.ts"),
      "",
      "utf8",
    );
    await writeFile(join(dir, ".modality", "Skip.props.ts"), "", "utf8");
    await writeFile(
      join(dir, "node_modules", "pkg", "Skip.props.ts"),
      "",
      "utf8",
    );

    expect(await discoverPropsFiles(dir)).toEqual([
      join(dir, "src", "components", "Form.props.ts"),
      join(dir, "src", "Home.props.ts"),
    ]);
  });

  it("infers source files from props files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "App.props.ts"), "", "utf8");
    await writeFile(join(dir, "src", "App.tsx"), "", "utf8");

    expect(await inferSourceFilesFromProps(dir)).toEqual([
      join(dir, "src", "App.tsx"),
    ]);
  });

  it("fails clearly when no props files exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));

    await expect(inferSourceFilesFromProps(dir)).rejects.toThrow(
      `No *.props.ts files found under ${dir}`,
    );
  });

  it("fails clearly when an inferred source file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "App.props.ts"), "", "utf8");

    await expect(inferSourceFilesFromProps(dir)).rejects.toThrow(
      `Missing inferred source files for props: ${join(dir, "src", "App.tsx")}`,
    );
  });

  it("derives per-props artifact paths under .modality/models", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    await writeFile(join(dir, "app", "root.props.ts"), "", "utf8");
    await writeFile(join(dir, "app", "root.tsx"), "", "utf8");
    await writeFile(join(dir, "app", "routes", "$slug.props.ts"), "", "utf8");
    await writeFile(join(dir, "app", "routes", "$slug.tsx"), "", "utf8");
    await writeFile(
      join(dir, "app", "routes", "analytics.props.ts"),
      "",
      "utf8",
    );
    await writeFile(join(dir, "app", "routes", "analytics.tsx"), "", "utf8");

    expect(await inferExtractTargetsFromProps(dir)).toEqual([
      {
        propsPath: join(dir, "app", "root.props.ts"),
        sourcePath: join(dir, "app", "root.tsx"),
        modelPath: join(".modality", "models", "app", "root.model.json"),
        appModelPath: join(".modality", "models", "app", "root.props.ts"),
      },
      {
        propsPath: join(dir, "app", "routes", "$slug.props.ts"),
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
        propsPath: join(dir, "app", "routes", "analytics.props.ts"),
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
        join(root, "app", "routes", "home.props.ts"),
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
    await writeFile(join(dir, "app", "root.props.ts"), "", "utf8");

    await expect(inferExtractTargetsFromProps(dir)).rejects.toThrow(
      `Missing inferred source files for props: ${join(dir, "app", "root.tsx")}`,
    );
  });

  it("infers check targets from props and generated models", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));
    await mkdir(join(dir, "app", "routes"), { recursive: true });
    await mkdir(join(dir, ".modality", "models", "app", "routes"), {
      recursive: true,
    });
    await writeFile(join(dir, "app", "root.props.ts"), "", "utf8");
    await writeFile(
      join(dir, ".modality", "models", "app", "root.model.json"),
      "{}",
      "utf8",
    );
    await writeFile(join(dir, "app", "routes", "home.props.ts"), "", "utf8");
    await writeFile(
      join(dir, ".modality", "models", "app", "routes", "home.model.json"),
      "{}",
      "utf8",
    );

    expect(await inferCheckTargetsFromProps(dir)).toEqual([
      {
        propsPath: join(dir, "app", "root.props.ts"),
        modelPath: join(".modality", "models", "app", "root.model.json"),
        appModelPath: join(".modality", "models", "app", "root.props.ts"),
      },
      {
        propsPath: join(dir, "app", "routes", "home.props.ts"),
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
      },
    ]);
  });

  it("fails clearly when a generated model is missing for check targets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));
    await mkdir(join(dir, "app"), { recursive: true });
    await writeFile(join(dir, "app", "root.props.ts"), "", "utf8");

    await expect(inferCheckTargetsFromProps(dir)).rejects.toThrow(
      `Missing inferred model files for props: ${join(".modality", "models", "app", "root.model.json")}`,
    );
  });

  it("discovers generated model files under .modality/models", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-"));
    await mkdir(join(dir, ".modality", "models", "app", "routes"), {
      recursive: true,
    });
    await writeFile(
      join(dir, ".modality", "models", "app", "root.model.json"),
      "{}",
      "utf8",
    );
    await writeFile(
      join(dir, ".modality", "models", "app", "routes", "home.model.json"),
      "{}",
      "utf8",
    );

    expect(await discoverGeneratedModelFiles(dir)).toEqual([
      join(".modality", "models", "app", "root.model.json"),
      join(".modality", "models", "app", "routes", "home.model.json"),
    ]);
  });

  it("derives slice manifest and directory paths from model paths", () => {
    expect(
      sliceManifestPathForModel(
        join(".modality", "models", "app", "home.model.json"),
      ),
    ).toBe(join(".modality", "models", "app", "home.slices.json"));
    expect(
      sliceArtifactsDirForModel(
        join(".modality", "models", "app", "home.model.json"),
      ),
    ).toBe(join(".modality", "models", "app", "home.slices"));
  });

  it("builds deterministic safe slice filenames with collision handling", () => {
    const fileNames = safeSliceFileNamesForProperties([
      { name: "flag-false", index: 0 },
      { name: "flag false", index: 1 },
      { name: "Flag-False", index: 2 },
    ]);
    expect(fileNames.get(0)).toMatch(/^flag-false-[0-9a-f]{8}\.slice\.json$/);
    expect(fileNames.get(1)).toBe("flag_false.slice.json");
    expect(fileNames.get(2)).toMatch(/^Flag-False-[0-9a-f]{8}\.slice\.json$/);
  });

  it("ignores slice artifacts when discovering generated model files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "modality-defaults-slices-"));
    await mkdir(join(dir, ".modality", "models", "app"), { recursive: true });
    await mkdir(join(dir, ".modality", "models", "app", "home.slices"), {
      recursive: true,
    });
    await writeFile(
      join(dir, ".modality", "models", "app", "home.model.json"),
      "{}",
      "utf8",
    );
    await writeFile(
      join(dir, ".modality", "models", "app", "home.slices.json"),
      "{}",
      "utf8",
    );
    await writeFile(
      join(
        dir,
        ".modality",
        "models",
        "app",
        "home.slices",
        "flag-false.slice.json",
      ),
      "{}",
      "utf8",
    );

    expect(await discoverGeneratedModelFiles(dir)).toEqual([
      join(".modality", "models", "app", "home.model.json"),
    ]);
  });
});
