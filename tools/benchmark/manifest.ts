import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type BenchmarkFramework = "react-router" | "nextjs";

export type BenchmarkExpectedCounts = {
  truePositiveViolations: number;
  trueNegativeVerified: number;
  falsePositiveProbes: number;
  falseNegativeProbes: number;
};

export type BenchmarkSearchLimits = {
  maxStates?: number;
  maxEdges?: number;
  maxFrontier?: number;
  memoryGuardMb?: number;
};

export type BenchmarkDefinition = {
  id: string;
  framework: BenchmarkFramework;
  root: string;
  packageJsonPath: string;
  sourcePaths: readonly string[];
  propsPaths: readonly string[];
  effectApis: readonly string[];
  mutation?: {
    maxMutants?: number;
    seed?: number;
    operators?: readonly string[];
    conformance?: {
      walkCount?: number;
      depth?: number;
      seed?: number;
    };
  };
  metamorphic?: {
    maxVariants?: number;
    seed?: number;
    transforms?: readonly string[];
  };
  conformance?: {
    walkCount?: number;
    depth?: number;
    seed?: number;
  };
  expected: BenchmarkExpectedCounts;
  searchLimits?: BenchmarkSearchLimits;
};

export type BenchmarkManifest = {
  schemaVersion: 1;
  manifestId: string;
  benchmarks: readonly BenchmarkDefinition[];
  validityThresholds?: {
    conformance?: {
      minPassRate?: number;
    };
    mutation?: {
      minDetectionRate?: number;
    };
    metamorphic?: {
      minStabilityRate?: number;
    };
  };
};

export async function readBenchmarkManifest(
  manifestPath: string,
): Promise<BenchmarkManifest> {
  const raw = await readFile(manifestPath, "utf8");
  const manifest = JSON.parse(raw) as BenchmarkManifest;
  validateBenchmarkManifest(manifest);
  return manifest;
}

export function validateBenchmarkManifest(manifest: BenchmarkManifest): void {
  if (manifest.schemaVersion !== 1) {
    throw new Error(
      `unsupported manifest schemaVersion ${manifest.schemaVersion}`,
    );
  }
  if (!manifest.manifestId) {
    throw new Error("manifestId is required");
  }
  if (!Array.isArray(manifest.benchmarks) || manifest.benchmarks.length === 0) {
    throw new Error("benchmarks must be a non-empty array");
  }
  for (const benchmark of manifest.benchmarks) {
    if (!benchmark.id) throw new Error("benchmark id is required");
    if (!benchmark.root)
      throw new Error(`benchmark ${benchmark.id} root is required`);
    if (!benchmark.packageJsonPath) {
      throw new Error(`benchmark ${benchmark.id} packageJsonPath is required`);
    }
    if (!benchmark.sourcePaths?.length) {
      throw new Error(`benchmark ${benchmark.id} sourcePaths is required`);
    }
    if (!benchmark.propsPaths?.length) {
      throw new Error(`benchmark ${benchmark.id} propsPaths is required`);
    }
    if (!benchmark.effectApis?.length) {
      throw new Error(`benchmark ${benchmark.id} effectApis is required`);
    }
    if (!benchmark.expected) {
      throw new Error(`benchmark ${benchmark.id} expected counts are required`);
    }
  }
}

export async function validateBenchmarkPaths(
  repoRoot: string,
  manifest: BenchmarkManifest,
): Promise<void> {
  for (const benchmark of manifest.benchmarks) {
    const benchmarkRoot = resolve(repoRoot, benchmark.root);
    await assertExists(
      resolve(benchmarkRoot, benchmark.packageJsonPath),
      `benchmark ${benchmark.id} package.json`,
    );
    for (const relativePath of benchmark.sourcePaths) {
      await assertExists(
        resolve(benchmarkRoot, relativePath),
        `benchmark ${benchmark.id} source ${relativePath}`,
      );
    }
    for (const relativePath of benchmark.propsPaths) {
      await assertExists(
        resolve(benchmarkRoot, relativePath),
        `benchmark ${benchmark.id} props ${relativePath}`,
      );
    }
  }
}

export function selectBenchmarks(
  manifest: BenchmarkManifest,
  benchmarkId?: string,
): BenchmarkDefinition[] {
  if (!benchmarkId) return [...manifest.benchmarks];
  const selected = manifest.benchmarks.filter(
    (entry) => entry.id === benchmarkId,
  );
  if (selected.length === 0) {
    throw new Error(`unknown benchmark id ${benchmarkId}`);
  }
  return [...selected];
}

async function assertExists(path: string, label: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(`missing ${label}: ${path}`);
  }
}
