import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  discoverPropsFiles,
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
});
