import {
  cp,
  lstat,
  mkdir,
  readFile,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalJson } from "modality-ts/core";
import {
  applyMetamorphicTransform,
  enumerateMetamorphicSites,
  type MetamorphicSite,
} from "./transforms.js";

export interface MetamorphicSettings {
  maxVariants?: number;
  seed?: number;
  transforms?: readonly string[];
}

export interface MetamorphicVariantDescriptor {
  variantId: string;
  appRoot: string;
  file: string;
  transformId: string;
  siteId: string;
  sourceDiff: string;
}

export interface GenerateMetamorphicVariantsInput {
  appRoot: string;
  sourcePaths: readonly string[];
  workDir: string;
  metamorphic?: MetamorphicSettings;
}

interface Candidate {
  file: string;
  absoluteFile: string;
  site: MetamorphicSite;
}

export async function generateMetamorphicVariants(
  input: GenerateMetamorphicVariantsInput,
): Promise<MetamorphicVariantDescriptor[]> {
  const candidates = await enumerateCandidates(input);
  const sampled = sampleCandidates(
    candidates,
    input.metamorphic?.maxVariants ?? candidates.length,
    input.metamorphic?.seed ?? 1,
  );
  await mkdir(input.workDir, { recursive: true });
  const variants: MetamorphicVariantDescriptor[] = [];
  for (const [index, candidate] of sampled.entries()) {
    const variantId = `variant-${String(index + 1).padStart(4, "0")}-${safeId(
      candidate.site.transformId,
    )}`;
    const variantRoot = join(input.workDir, variantId, "app");
    await cp(input.appRoot, variantRoot, {
      dereference: true,
      recursive: true,
      filter: (source) => !isIgnoredTreeEntry(source),
    });
    await linkDependencyTree(input.appRoot, variantRoot);
    const variantFile = join(variantRoot, candidate.file);
    const originalText = await readFile(candidate.absoluteFile, "utf8");
    const transformed = applyMetamorphicTransform(
      originalText,
      candidate.site,
      candidate.absoluteFile,
    );
    await mkdir(dirname(variantFile), { recursive: true });
    await writeFile(variantFile, transformed.text, "utf8");
    const descriptor: MetamorphicVariantDescriptor = {
      variantId,
      appRoot: variantRoot,
      file: candidate.file,
      transformId: candidate.site.transformId,
      siteId: candidate.site.siteId,
      sourceDiff: sourceDiff(candidate.file, originalText, transformed.text),
    };
    variants.push(descriptor);
    await writeFile(
      join(input.workDir, variantId, "variant.json"),
      `${canonicalJson(descriptor)}\n`,
      "utf8",
    );
  }
  return variants;
}

export async function countMetamorphicCandidates(
  input: Omit<GenerateMetamorphicVariantsInput, "workDir">,
): Promise<number> {
  return (await enumerateCandidates({ ...input, workDir: "" })).length;
}

async function enumerateCandidates(
  input: GenerateMetamorphicVariantsInput,
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const sourcePath of input.sourcePaths) {
    const absoluteFile = resolve(input.appRoot, sourcePath);
    const sourceText = await readFile(absoluteFile, "utf8");
    for (const site of enumerateMetamorphicSites(
      sourceText,
      absoluteFile,
      input.metamorphic?.transforms,
    )) {
      candidates.push({ file: sourcePath, absoluteFile, site });
    }
  }
  return candidates.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.site.transformId.localeCompare(right.site.transformId) ||
      left.site.start - right.site.start ||
      left.site.siteId.localeCompare(right.site.siteId),
  );
}

function sampleCandidates(
  candidates: readonly Candidate[],
  maxVariants: number,
  seed: number,
): Candidate[] {
  if (maxVariants >= candidates.length) return [...candidates];
  const decorated = candidates.map((candidate, index) => ({
    candidate,
    rank: hash(`${seed}:${index}:${candidate.file}:${candidate.site.siteId}`),
  }));
  return decorated
    .sort((left, right) => left.rank - right.rank)
    .slice(0, Math.max(0, maxVariants))
    .map((entry) => entry.candidate)
    .sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.site.transformId.localeCompare(right.site.transformId) ||
        left.site.start - right.site.start,
    );
}

function sourceDiff(file: string, before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start += 1;
  }
  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (
    beforeEnd >= start &&
    afterEnd >= start &&
    beforeLines[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }
  const contextStart = Math.max(0, start - 2);
  const contextEnd = Math.min(
    Math.max(beforeEnd, afterEnd) + 2,
    Math.max(beforeLines.length, afterLines.length) - 1,
  );
  const lines = [`--- ${file}`, `+++ ${file}`];
  for (let index = contextStart; index <= contextEnd; index += 1) {
    const beforeLine = beforeLines[index];
    const afterLine = afterLines[index];
    if (beforeLine === afterLine) {
      lines.push(` ${beforeLine ?? ""}`);
    } else {
      if (beforeLine !== undefined) lines.push(`-${beforeLine}`);
      if (afterLine !== undefined) lines.push(`+${afterLine}`);
    }
  }
  return lines.join("\n");
}

function isIgnoredTreeEntry(path: string): boolean {
  const normalized = path.split(/[/\\]/g);
  const name = normalized[normalized.length - 1];
  return ["node_modules", ".next", "dist", "coverage"].includes(name ?? "");
}

async function linkDependencyTree(
  sourceRoot: string,
  copiedRoot: string,
): Promise<void> {
  const sourceNodeModules = join(sourceRoot, "node_modules");
  try {
    const stats = await lstat(sourceNodeModules);
    if (!stats.isDirectory() && !stats.isSymbolicLink()) return;
  } catch {
    return;
  }
  await symlink(sourceNodeModules, join(copiedRoot, "node_modules"), "dir");
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function hash(value: string): number {
  let state = 2166136261;
  for (const char of value) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  return state >>> 0;
}
