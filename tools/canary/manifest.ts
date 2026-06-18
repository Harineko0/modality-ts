import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  CanaryBudgets,
  CanarySeededBugExpectations,
  CanaryThresholds,
} from "./assertions.js";

export type CanaryStatus = "active" | "planned";

export type CanaryKind =
  | "react-app"
  | "react-router-app"
  | "next-app-router-app"
  | "next-pages-router-app"
  | "external-store-app"
  | "schema-form-app"
  | "server-action-app"
  | "tsconfig-layout-app";

export type CanaryPackageManager = "pnpm" | "npm" | "yarn";

export interface CanaryDependencyFact {
  packageName: string;
  expectedRange?: string;
  source: "package-json" | "lockfile";
}

export interface CanaryAcceptedCaveat {
  id: string;
  kind: string;
}

export interface CanaryDefinition {
  id: string;
  title: string;
  status: CanaryStatus;
  kind: CanaryKind;
  root: string;
  packageManager?: CanaryPackageManager;
  dependencyFacts: readonly CanaryDependencyFact[];
  extract: {
    sourcePaths?: readonly string[];
    configPath?: string;
    packageJsonPath?: string;
    effectApis?: readonly string[];
    disabledPlugins?: readonly string[];
  };
  check?: {
    propsPaths?: readonly string[];
    maxStates?: number;
    maxEdges?: number;
    maxFrontier?: number;
    memoryGuardMb?: number;
  };
  conform?: {
    count?: number;
    depth?: number;
    seed?: number;
    mode?: "abstract" | "action";
    harnessPath?: string;
    minPassRate?: number;
    minTransitionPassRate?: number;
  };
  thresholds: CanaryThresholds;
  acceptedCaveats: readonly CanaryAcceptedCaveat[];
  knownUnsupported: readonly string[];
  expectations?: CanarySeededBugExpectations;
  budgets?: CanaryBudgets;
}

export interface CanaryManifest {
  schemaVersion: 1;
  manifestId: string;
  canaries: readonly CanaryDefinition[];
}

const CANARY_STATUSES = new Set<CanaryStatus>(["active", "planned"]);
const CANARY_KINDS = new Set<CanaryKind>([
  "react-app",
  "react-router-app",
  "next-app-router-app",
  "next-pages-router-app",
  "external-store-app",
  "schema-form-app",
  "server-action-app",
  "tsconfig-layout-app",
]);
const PACKAGE_MANAGERS = new Set<CanaryPackageManager>(["pnpm", "npm", "yarn"]);
const DEPENDENCY_SOURCES = new Set<CanaryDependencyFact["source"]>([
  "package-json",
  "lockfile",
]);

export async function readCanaryManifest(path: string): Promise<CanaryManifest> {
  return parseCanaryManifest(await readFile(path, "utf8"));
}

export function parseCanaryManifest(json: string): CanaryManifest {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("canary manifest must be an object");
  if (value.schemaVersion !== 1) {
    throw new Error(
      `unsupported canary manifest schemaVersion ${String(value.schemaVersion)}`,
    );
  }
  assertNonEmptyString(value.manifestId, "manifestId");
  if (!Array.isArray(value.canaries)) {
    throw new Error("canary manifest missing canaries");
  }

  const canaries = value.canaries.map((entry, index) =>
    parseCanaryDefinition(entry, `canaries[${index}]`),
  );
  assertUniqueIds(canaries.map((canary) => canary.id));

  return {
    schemaVersion: 1,
    manifestId: value.manifestId,
    canaries,
  };
}

export async function validateActiveCanaryPaths(
  repoRoot: string,
  manifest: CanaryManifest,
): Promise<void> {
  for (const canary of manifest.canaries) {
    if (canary.status !== "active") continue;
    const canaryRoot = resolve(repoRoot, canary.root);
    await assertPathExists(canaryRoot, `active canary ${canary.id} root`);
    for (const relativePath of canary.extract.sourcePaths ?? []) {
      await assertPathExists(
        resolve(canaryRoot, relativePath),
        `canary ${canary.id} source path ${relativePath}`,
      );
    }
    if (canary.extract.packageJsonPath) {
      await assertPathExists(
        resolve(canaryRoot, canary.extract.packageJsonPath),
        `canary ${canary.id} packageJsonPath ${canary.extract.packageJsonPath}`,
      );
    }
    if (canary.extract.configPath) {
      await assertPathExists(
        resolve(canaryRoot, canary.extract.configPath),
        `canary ${canary.id} configPath ${canary.extract.configPath}`,
      );
    }
    for (const relativePath of canary.check?.propsPaths ?? []) {
      await assertPathExists(
        resolve(canaryRoot, relativePath),
        `canary ${canary.id} props path ${relativePath}`,
      );
    }
    assertActiveThresholds(canary);
    validateAcceptedCaveats(canary);
  }
}

export function selectActiveCanaries(
  manifest: CanaryManifest,
  options: {
    canaryId?: string;
    kind?: CanaryKind;
  } = {},
): CanaryDefinition[] {
  let selected = manifest.canaries.filter((canary) => canary.status === "active");
  if (options.canaryId) {
    selected = selected.filter((canary) => canary.id === options.canaryId);
    if (selected.length === 0) {
      const exists = manifest.canaries.some(
        (canary) => canary.id === options.canaryId,
      );
      if (!exists) {
        throw new Error(`unknown canary id ${options.canaryId}`);
      }
      throw new Error(`canary ${options.canaryId} is not active`);
    }
  }
  if (options.kind) {
    selected = selected.filter((canary) => canary.kind === options.kind);
    if (selected.length === 0) {
      throw new Error(`no active canaries matched kind ${options.kind}`);
    }
  }
  if (selected.length === 0) {
    throw new Error("no active canaries selected");
  }
  return [...selected];
}

function parseCanaryDefinition(value: unknown, path: string): CanaryDefinition {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertNonEmptyString(value.id, `${path}.id`);
  assertNonEmptyString(value.title, `${path}.title`);
  if (
    typeof value.status !== "string" ||
    !CANARY_STATUSES.has(value.status as CanaryStatus)
  ) {
    throw new Error(`${path}.status is unsupported`);
  }
  if (typeof value.kind !== "string" || !CANARY_KINDS.has(value.kind as CanaryKind)) {
    throw new Error(`${path}.kind is unsupported`);
  }
  assertNonEmptyString(value.root, `${path}.root`);
  if (value.packageManager !== undefined) {
    if (
      typeof value.packageManager !== "string" ||
      !PACKAGE_MANAGERS.has(value.packageManager as CanaryPackageManager)
    ) {
      throw new Error(`${path}.packageManager is unsupported`);
    }
  }
  if (!Array.isArray(value.dependencyFacts)) {
    throw new Error(`${path}.dependencyFacts must be an array`);
  }
  if (!isRecord(value.extract)) {
    throw new Error(`${path}.extract must be an object`);
  }
  if (!isRecord(value.thresholds)) {
    throw new Error(`${path}.thresholds must be an object`);
  }
  if (!Array.isArray(value.acceptedCaveats)) {
    throw new Error(`${path}.acceptedCaveats must be an array`);
  }
  if (!Array.isArray(value.knownUnsupported)) {
    throw new Error(`${path}.knownUnsupported must be an array`);
  }

  const status = value.status as CanaryStatus;
  const canary: CanaryDefinition = {
    id: value.id,
    title: value.title,
    status,
    kind: value.kind as CanaryKind,
    root: value.root,
    ...(value.packageManager
      ? { packageManager: value.packageManager as CanaryPackageManager }
      : {}),
    dependencyFacts: value.dependencyFacts.map((entry, index) =>
      parseDependencyFact(entry, `${path}.dependencyFacts[${index}]`),
    ),
    extract: parseExtract(value.extract, `${path}.extract`),
    ...(value.check ? { check: parseCheck(value.check, `${path}.check`) } : {}),
    ...(value.conform
      ? { conform: parseConform(value.conform, `${path}.conform`) }
      : {}),
    thresholds: parseThresholds(value.thresholds, `${path}.thresholds`),
    acceptedCaveats: value.acceptedCaveats.map((entry, index) =>
      parseAcceptedCaveat(entry, `${path}.acceptedCaveats[${index}]`),
    ),
    knownUnsupported: assertStringArray(
      value.knownUnsupported,
      `${path}.knownUnsupported`,
    ),
    ...(value.expectations
      ? { expectations: parseExpectations(value.expectations, `${path}.expectations`) }
      : {}),
    ...(value.budgets ? { budgets: parseBudgets(value.budgets, `${path}.budgets`) } : {}),
  };

  if (status === "active") {
    assertActiveThresholds(canary);
    validateAcceptedCaveats(canary);
  }

  return canary;
}

function parseDependencyFact(
  value: unknown,
  path: string,
): CanaryDependencyFact {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertNonEmptyString(value.packageName, `${path}.packageName`);
  if (
    typeof value.source !== "string" ||
    !DEPENDENCY_SOURCES.has(value.source as CanaryDependencyFact["source"])
  ) {
    throw new Error(`${path}.source is unsupported`);
  }
  if (value.expectedRange !== undefined) {
    assertNonEmptyString(value.expectedRange, `${path}.expectedRange`);
  }
  return {
    packageName: value.packageName,
    source: value.source as CanaryDependencyFact["source"],
    ...(value.expectedRange ? { expectedRange: value.expectedRange } : {}),
  };
}

function parseExtract(
  value: Record<string, unknown>,
  path: string,
): CanaryDefinition["extract"] {
  if (value.sourcePaths !== undefined) {
    assertStringArray(value.sourcePaths, `${path}.sourcePaths`);
  }
  if (value.configPath !== undefined) {
    assertNonEmptyString(value.configPath, `${path}.configPath`);
  }
  if (value.packageJsonPath !== undefined) {
    assertNonEmptyString(value.packageJsonPath, `${path}.packageJsonPath`);
  }
  if (value.effectApis !== undefined) {
    assertStringArray(value.effectApis, `${path}.effectApis`);
  }
  if (value.disabledPlugins !== undefined) {
    assertStringArray(value.disabledPlugins, `${path}.disabledPlugins`);
  }
  return value as CanaryDefinition["extract"];
}

function parseCheck(
  value: unknown,
  path: string,
): NonNullable<CanaryDefinition["check"]> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  if (value.propsPaths !== undefined) {
    assertStringArray(value.propsPaths, `${path}.propsPaths`);
  }
  for (const key of ["maxStates", "maxEdges", "maxFrontier", "memoryGuardMb"] as const) {
    if (value[key] !== undefined) {
      assertPositiveInteger(value[key], `${path}.${key}`);
    }
  }
  return value as NonNullable<CanaryDefinition["check"]>;
}

function parseConform(
  value: unknown,
  path: string,
): NonNullable<CanaryDefinition["conform"]> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  for (const key of ["count", "depth", "seed"] as const) {
    if (value[key] !== undefined) {
      assertPositiveInteger(value[key], `${path}.${key}`);
    }
  }
  if (value.mode !== undefined) {
    if (value.mode !== "abstract" && value.mode !== "action") {
      throw new Error(`${path}.mode is unsupported`);
    }
  }
  if (value.harnessPath !== undefined) {
    assertNonEmptyString(value.harnessPath, `${path}.harnessPath`);
  }
  for (const key of ["minPassRate", "minTransitionPassRate"] as const) {
    if (value[key] !== undefined) {
      assertPassRate(value[key], `${path}.${key}`);
    }
  }
  return value as NonNullable<CanaryDefinition["conform"]>;
}

function parseThresholds(
  value: Record<string, unknown>,
  path: string,
): CanaryThresholds {
  for (const key of [
    "minCoverageExactOrOverlay",
    "minConformPassRate",
    "minTransitionPassRate",
  ] as const) {
    if (value[key] !== undefined) {
      assertPassRate(value[key], `${path}.${key}`);
    }
  }
  return value as CanaryThresholds;
}

function parseBudgets(
  value: unknown,
  path: string,
): CanaryBudgets {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  for (const key of ["maxStates", "maxEdges", "maxFrontier", "memoryGuardMb"] as const) {
    if (value[key] !== undefined) {
      assertPositiveInteger(value[key], `${path}.${key}`);
    }
  }
  return value as CanaryBudgets;
}

function parseExpectations(
  value: unknown,
  path: string,
): CanarySeededBugExpectations {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  for (const key of ["violatedPropertyCount", "minReproducedReplayCount", "maxOverlayLines", "expectedCiExitCode"] as const) {
    if (value[key] !== undefined) {
      assertNonNegativeInteger(value[key], `${path}.${key}`);
    }
  }
  if (value.violatedPropertyNames !== undefined) {
    assertStringArray(value.violatedPropertyNames, `${path}.violatedPropertyNames`);
  }
  if (value.ciOutputMustInclude !== undefined) {
    assertStringArray(value.ciOutputMustInclude, `${path}.ciOutputMustInclude`);
  }
  return value as CanarySeededBugExpectations;
}

function parseAcceptedCaveat(
  value: unknown,
  path: string,
): CanaryAcceptedCaveat {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertNonEmptyString(value.id, `${path}.id`);
  assertNonEmptyString(value.kind, `${path}.kind`);
  if ("message" in value || "pattern" in value || "regex" in value) {
    throw new Error(`${path} must use stable kind and id, not free-form matching`);
  }
  return {
    id: value.id,
    kind: value.kind,
  };
}

function validateAcceptedCaveats(canary: CanaryDefinition): void {
  for (const [index, caveat] of canary.acceptedCaveats.entries()) {
    if (!caveat.id || !caveat.kind) {
      throw new Error(
        `canary ${canary.id} acceptedCaveats[${index}] must define id and kind`,
      );
    }
  }
}

function assertActiveThresholds(canary: CanaryDefinition): void {
  const hasThreshold =
    canary.thresholds.minCoverageExactOrOverlay !== undefined ||
    canary.thresholds.minConformPassRate !== undefined ||
    canary.thresholds.minTransitionPassRate !== undefined;
  if (!hasThreshold) {
    throw new Error(`active canary ${canary.id} must define at least one threshold`);
  }
}

async function assertPathExists(path: string, label: string): Promise<void> {
  try {
    await access(path);
  } catch {
    throw new Error(`canary invalid: missing ${label} at ${path}`);
  }
}

function assertUniqueIds(ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`duplicate canary id ${id}`);
    seen.add(id);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, path: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
}

function assertStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  for (const [index, entry] of value.entries()) {
    assertNonEmptyString(entry, `${path}[${index}]`);
  }
  return value as readonly string[];
}

function assertPassRate(value: unknown, path: string): void {
  if (typeof value !== "number" || value < 0 || value > 1) {
    throw new Error(`${path} must be a number between 0 and 1`);
  }
}

function assertPositiveInteger(value: unknown, path: string): void {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${path} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: unknown, path: string): void {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }
}
