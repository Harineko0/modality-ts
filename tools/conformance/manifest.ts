import { readFile } from "node:fs/promises";

export type ConformanceFeatureLayer =
  | "typescript"
  | "core-ir"
  | "checker"
  | "react-semantics"
  | "routing"
  | "state-source"
  | "effect-api"
  | "schema-domain"
  | "replay-observation"
  | "reporting";

export type ConformanceFeatureContract =
  | "compiler"
  | "official-docs"
  | "core-spec"
  | "adapter-spi"
  | "fixture";

export interface ConformanceFeatureRow {
  id: string;
  title: string;
  layer: ConformanceFeatureLayer;
  contract: ConformanceFeatureContract;
  requiredFixtures: readonly string[];
}

export interface ConformanceMatrixTarget {
  id: string;
  title: string;
  adapterId?: string;
}

export type ConformanceMatrixCellStatus =
  | "supported"
  | "partial"
  | "unsupported"
  | "not-applicable";

export interface ConformanceMatrixCell {
  featureId: string;
  targetId: string;
  status: ConformanceMatrixCellStatus;
  fixtures: readonly string[];
  acceptedCaveats?: readonly string[];
  minCoverageExactOrOverlay?: number;
  minConformPassRate?: number;
  maxStates?: number;
  maxEdges?: number;
  maxFrontier?: number;
  notes?: string;
}

export interface ConformanceFixtureManifestEntry {
  id: string;
  featureIds: readonly string[];
  targetIds: readonly string[];
  root?: string;
  notes?: string;
}

export interface ConformanceMatrixManifest {
  schemaVersion: 1;
  features: readonly ConformanceFeatureRow[];
  targets: readonly ConformanceMatrixTarget[];
  cells: readonly ConformanceMatrixCell[];
  fixtures: readonly ConformanceFixtureManifestEntry[];
}

const FEATURE_LAYERS = new Set<ConformanceFeatureLayer>([
  "typescript",
  "core-ir",
  "checker",
  "react-semantics",
  "routing",
  "state-source",
  "effect-api",
  "schema-domain",
  "replay-observation",
  "reporting",
]);

const FEATURE_CONTRACTS = new Set<ConformanceFeatureContract>([
  "compiler",
  "official-docs",
  "core-spec",
  "adapter-spi",
  "fixture",
]);

const CELL_STATUSES = new Set<ConformanceMatrixCellStatus>([
  "supported",
  "partial",
  "unsupported",
  "not-applicable",
]);

export async function readConformanceMatrixManifest(
  path: string,
): Promise<ConformanceMatrixManifest> {
  return parseConformanceMatrixManifest(await readFile(path, "utf8"));
}

export function parseConformanceMatrixManifest(
  json: string,
): ConformanceMatrixManifest {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value))
    throw new Error("conformance matrix manifest must be an object");
  if (value.schemaVersion !== 1)
    throw new Error(
      `unsupported conformance matrix schemaVersion ${String(value.schemaVersion)}`,
    );
  if (!Array.isArray(value.features))
    throw new Error("conformance matrix manifest missing features");
  if (!Array.isArray(value.targets))
    throw new Error("conformance matrix manifest missing targets");
  if (!Array.isArray(value.cells))
    throw new Error("conformance matrix manifest missing cells");
  if (!Array.isArray(value.fixtures))
    throw new Error("conformance matrix manifest missing fixtures");

  const features = value.features.map((entry, index) =>
    parseFeatureRow(entry, `features[${index}]`),
  );
  const targets = value.targets.map((entry, index) =>
    parseTarget(entry, `targets[${index}]`),
  );
  const fixtures = value.fixtures.map((entry, index) =>
    parseFixture(entry, `fixtures[${index}]`),
  );
  const cells = value.cells.map((entry, index) =>
    parseCell(entry, `cells[${index}]`),
  );

  assertUniqueIds(features.map((feature) => feature.id), "feature");
  assertUniqueIds(targets.map((target) => target.id), "target");
  assertUniqueIds(fixtures.map((fixture) => fixture.id), "fixture");

  const featureIds = new Set(features.map((feature) => feature.id));
  const targetIds = new Set(targets.map((target) => target.id));
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));

  for (const cell of cells) {
    if (!featureIds.has(cell.featureId)) {
      throw new Error(
        `matrix cell references unknown feature id ${cell.featureId}`,
      );
    }
    if (!targetIds.has(cell.targetId)) {
      throw new Error(
        `matrix cell references unknown target id ${cell.targetId}`,
      );
    }
    for (const fixtureId of cell.fixtures) {
      if (!fixtureIds.has(fixtureId)) {
        throw new Error(
          `matrix cell references unknown fixture id ${fixtureId}`,
        );
      }
    }
    if (cell.status === "supported" && cell.fixtures.length === 0) {
      throw new Error(
        `supported cell ${cell.featureId}/${cell.targetId} must name at least one fixture`,
      );
    }
    if (cell.minCoverageExactOrOverlay !== undefined) {
      assertPassRate(
        cell.minCoverageExactOrOverlay,
        `cell ${cell.featureId}/${cell.targetId}.minCoverageExactOrOverlay`,
      );
    }
    if (cell.minConformPassRate !== undefined) {
      assertPassRate(
        cell.minConformPassRate,
        `cell ${cell.featureId}/${cell.targetId}.minConformPassRate`,
      );
    }
    if (cell.maxStates !== undefined) {
      assertPositiveInteger(
        cell.maxStates,
        `cell ${cell.featureId}/${cell.targetId}.maxStates`,
      );
    }
    if (cell.maxEdges !== undefined) {
      assertPositiveInteger(
        cell.maxEdges,
        `cell ${cell.featureId}/${cell.targetId}.maxEdges`,
      );
    }
    if (cell.maxFrontier !== undefined) {
      assertPositiveInteger(
        cell.maxFrontier,
        `cell ${cell.featureId}/${cell.targetId}.maxFrontier`,
      );
    }
  }

  for (const fixture of fixtures) {
    for (const featureId of fixture.featureIds) {
      if (!featureIds.has(featureId)) {
        throw new Error(
          `fixture ${fixture.id} references unknown feature id ${featureId}`,
        );
      }
    }
    for (const targetId of fixture.targetIds) {
      if (!targetIds.has(targetId)) {
        throw new Error(
          `fixture ${fixture.id} references unknown target id ${targetId}`,
        );
      }
    }
  }

  for (const feature of features) {
    for (const fixtureId of feature.requiredFixtures) {
      if (!fixtureIds.has(fixtureId)) {
        throw new Error(
          `feature ${feature.id} references unknown required fixture id ${fixtureId}`,
        );
      }
    }
  }

  return {
    schemaVersion: 1,
    features,
    targets,
    cells,
    fixtures,
  };
}

function parseFeatureRow(value: unknown, path: string): ConformanceFeatureRow {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertNonEmptyString(value.id, `${path}.id`);
  assertNonEmptyString(value.title, `${path}.title`);
  if (
    typeof value.layer !== "string" ||
    !FEATURE_LAYERS.has(value.layer as ConformanceFeatureLayer)
  ) {
    throw new Error(`${path}.layer is unsupported`);
  }
  if (
    typeof value.contract !== "string" ||
    !FEATURE_CONTRACTS.has(value.contract as ConformanceFeatureContract)
  ) {
    throw new Error(`${path}.contract is unsupported`);
  }
  assertStringArray(value.requiredFixtures, `${path}.requiredFixtures`);
  return {
    id: value.id,
    title: value.title,
    layer: value.layer as ConformanceFeatureLayer,
    contract: value.contract as ConformanceFeatureContract,
    requiredFixtures: value.requiredFixtures as readonly string[],
  };
}

function parseTarget(value: unknown, path: string): ConformanceMatrixTarget {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertNonEmptyString(value.id, `${path}.id`);
  assertNonEmptyString(value.title, `${path}.title`);
  if (value.adapterId !== undefined) {
    assertNonEmptyString(value.adapterId, `${path}.adapterId`);
  }
  return {
    id: value.id,
    title: value.title,
    ...(value.adapterId ? { adapterId: value.adapterId } : {}),
  };
}

function parseCell(value: unknown, path: string): ConformanceMatrixCell {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertNonEmptyString(value.featureId, `${path}.featureId`);
  assertNonEmptyString(value.targetId, `${path}.targetId`);
  if (
    typeof value.status !== "string" ||
    !CELL_STATUSES.has(value.status as ConformanceMatrixCellStatus)
  ) {
    throw new Error(`${path}.status is unsupported`);
  }
  assertStringArray(value.fixtures, `${path}.fixtures`);
  return value as unknown as ConformanceMatrixCell;
}

function parseFixture(
  value: unknown,
  path: string,
): ConformanceFixtureManifestEntry {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertNonEmptyString(value.id, `${path}.id`);
  assertStringArray(value.featureIds, `${path}.featureIds`);
  assertStringArray(value.targetIds, `${path}.targetIds`);
  return value as unknown as ConformanceFixtureManifestEntry;
}

function assertUniqueIds(ids: readonly string[], kind: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`duplicate ${kind} id ${id}`);
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

function assertStringArray(value: unknown, path: string): void {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  for (const [index, entry] of value.entries()) {
    assertNonEmptyString(entry, `${path}[${index}]`);
  }
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
