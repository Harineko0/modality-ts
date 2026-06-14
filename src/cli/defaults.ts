import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export const defaultArtifactDir = ".modality";
export const defaultModelPath = join(defaultArtifactDir, "model.json");
export const defaultAppModelPath = join(defaultArtifactDir, "app.model.ts");
export const defaultTlaPath = join(defaultArtifactDir, "model.tla");
export const defaultReportPath = join(defaultArtifactDir, "report.json");
export const defaultReplayReportPath = join(
  defaultArtifactDir,
  "replay-report.json",
);
export const defaultConformReportPath = join(
  defaultArtifactDir,
  "conform-report.json",
);
export const defaultTracesDir = join(defaultArtifactDir, "traces");
export const defaultReplayTestsDir = join(defaultArtifactDir, "replay-tests");
export const defaultActionReplayTestsDir = join(
  defaultArtifactDir,
  "action-replay-tests",
);

const ignoredDirs = new Set([".git", ".modality", "dist", "node_modules"]);

export async function discoverPropsFiles(
  root = process.cwd(),
): Promise<string[]> {
  const files = await discoverPropsFilesIn(root);
  return files.sort((left, right) => left.localeCompare(right));
}

export async function inferSourceFilesFromProps(
  root = process.cwd(),
): Promise<string[]> {
  const propsFiles = await discoverPropsFiles(root);
  if (propsFiles.length === 0) {
    throw new Error(`No *.props.mjs files found under ${root}`);
  }
  const sourceFiles = propsFiles.map((path) =>
    path.replace(/\.props\.mjs$/, ".tsx"),
  );
  const missing: string[] = [];
  for (const sourceFile of sourceFiles) {
    try {
      const info = await stat(sourceFile);
      if (!info.isFile()) missing.push(sourceFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(sourceFile);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing inferred source files for props: ${missing.join(", ")}`,
    );
  }
  return sourceFiles;
}

async function discoverPropsFilesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const discovered = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoredDirs.has(entry.name)) return [];
        return discoverPropsFilesIn(path);
      }
      if (entry.isFile() && entry.name.endsWith(".props.mjs")) return [path];
      return [];
    }),
  );
  return discovered.flat();
}
