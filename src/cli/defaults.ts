import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export const defaultArtifactDir = ".modality";
export const defaultModelsDir = join(defaultArtifactDir, "models");
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
const propsFileSuffix = ".props.ts";

export async function discoverPropsFiles(
  root = process.cwd(),
): Promise<string[]> {
  const files = await discoverPropsFilesIn(root);
  return files.sort((left, right) => left.localeCompare(right));
}

export interface ExtractTargetFromProps {
  propsPath: string;
  sourcePath: string;
  modelPath: string;
  appModelPath: string;
}

export function artifactPathsForPropsFile(
  propsPath: string,
  root = process.cwd(),
): { modelPath: string; appModelPath: string } {
  const base = relative(root, propsPath).replace(/\.props\.ts$/, "");
  return {
    modelPath: join(defaultModelsDir, `${base}.model.json`),
    appModelPath: join(defaultModelsDir, `${base}.props.ts`),
  };
}

export async function inferExtractTargetsFromProps(
  root = process.cwd(),
): Promise<ExtractTargetFromProps[]> {
  const propsFiles = await discoverPropsFiles(root);
  if (propsFiles.length === 0) {
    throw new Error(`No *${propsFileSuffix} files found under ${root}`);
  }
  const sourceFiles = propsFiles.map((path) =>
    path.replace(/\.props\.ts$/, ".tsx"),
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
  return propsFiles.map((propsPath) => {
    const sourcePath = propsPath.replace(/\.props\.ts$/, ".tsx");
    const { modelPath, appModelPath } = artifactPathsForPropsFile(
      propsPath,
      root,
    );
    return { propsPath, sourcePath, modelPath, appModelPath };
  });
}

export async function inferSourceFilesFromProps(
  root = process.cwd(),
): Promise<string[]> {
  const targets = await inferExtractTargetsFromProps(root);
  return targets.map((target) => target.sourcePath);
}

export interface CheckTargetFromProps {
  propsPath: string;
  modelPath: string;
  appModelPath: string;
}

export async function inferCheckTargetsFromProps(
  root = process.cwd(),
): Promise<CheckTargetFromProps[]> {
  const propsFiles = await discoverPropsFiles(root);
  if (propsFiles.length === 0) {
    throw new Error(`No *${propsFileSuffix} files found under ${root}`);
  }
  const missing: string[] = [];
  const targets: CheckTargetFromProps[] = [];
  for (const propsPath of propsFiles) {
    const { modelPath, appModelPath } = artifactPathsForPropsFile(
      propsPath,
      root,
    );
    const absoluteModelPath = join(root, modelPath);
    try {
      const info = await stat(absoluteModelPath);
      if (!info.isFile()) missing.push(modelPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(modelPath);
    }
    targets.push({ propsPath, modelPath, appModelPath });
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing inferred model files for props: ${missing.join(", ")}`,
    );
  }
  return targets;
}

export async function discoverGeneratedModelFiles(
  root = process.cwd(),
): Promise<string[]> {
  const modelsDir = join(root, defaultModelsDir);
  try {
    const info = await stat(modelsDir);
    if (!info.isDirectory()) return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const files = await discoverModelFilesIn(modelsDir);
  return files
    .map((path) => relative(root, path))
    .sort((left, right) => left.localeCompare(right));
}

async function discoverModelFilesIn(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const discovered = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.endsWith(".slices")) return [];
        return discoverModelFilesIn(path);
      }
      if (entry.isFile() && entry.name.endsWith(".model.json")) return [path];
      return [];
    }),
  );
  return discovered.flat();
}

export function sliceManifestPathForModel(modelPath: string): string {
  if (modelPath.endsWith(".model.json")) {
    return modelPath.replace(/\.model\.json$/, ".slices.json");
  }
  return `${modelPath}.slices.json`;
}

export function sliceArtifactsDirForModel(modelPath: string): string {
  if (modelPath.endsWith(".model.json")) {
    return modelPath.replace(/\.model\.json$/, ".slices");
  }
  return `${modelPath}.slices`;
}

function sanitizePropertyFileStem(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return sanitized.length > 0 ? sanitized : "property";
}

function shortPropertyHash(
  propertyName: string,
  propertyIndex: number,
): string {
  return createHash("sha256")
    .update(`${propertyName}\0${propertyIndex}`)
    .digest("hex")
    .slice(0, 8);
}

export function safeSliceFileNamesForProperties(
  properties: readonly { name: string; index: number }[],
): Map<number, string> {
  const sorted = [...properties].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.index - right.index,
  );
  const baseNames = new Map<number, string>();
  for (const entry of sorted) {
    baseNames.set(entry.index, sanitizePropertyFileStem(entry.name));
  }
  const lowerCounts = new Map<string, number>();
  for (const base of baseNames.values()) {
    const lower = base.toLowerCase();
    lowerCounts.set(lower, (lowerCounts.get(lower) ?? 0) + 1);
  }
  const result = new Map<number, string>();
  for (const entry of sorted) {
    const base = baseNames.get(entry.index) ?? "property";
    const needsHash = (lowerCounts.get(base.toLowerCase()) ?? 0) > 1;
    const stem = needsHash
      ? `${base}-${shortPropertyHash(entry.name, entry.index)}`
      : base;
    result.set(entry.index, `${stem}.slice.json`);
  }
  return result;
}

export function sliceModelPathForProperty(
  modelPath: string,
  propertyName: string,
  propertyIndex: number,
  allProperties: readonly { name: string; index: number }[],
): string {
  const fileNames = safeSliceFileNamesForProperties(allProperties);
  const fileName =
    fileNames.get(propertyIndex) ??
    `${sanitizePropertyFileStem(propertyName)}-${shortPropertyHash(propertyName, propertyIndex)}.slice.json`;
  return join(sliceArtifactsDirForModel(modelPath), fileName);
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
      if (entry.isFile() && entry.name.endsWith(propsFileSuffix)) return [path];
      return [];
    }),
  );
  return discovered.flat();
}
