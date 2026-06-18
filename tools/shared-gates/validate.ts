import type {
  AcceptedCaveatRef,
  SharedBudgets,
  SharedThresholds,
} from "./types.js";

const THRESHOLD_PASS_RATE_KEYS = [
  "minCoverageExactOrOverlay",
  "minRouteCoverage",
  "minConformPassRate",
  "minTransitionPassRate",
] as const satisfies readonly (keyof SharedThresholds)[];

const THRESHOLD_COUNT_KEYS = [
  "maxUnextractable",
  "maxGlobalTaints",
  "maxUnhandledRejections",
  "maxStaleReads",
] as const satisfies readonly (keyof SharedThresholds)[];

const BUDGET_COUNT_KEYS = [
  "maxBoundHits",
] as const satisfies readonly (keyof SharedBudgets)[];

const BUDGET_KEYS = [
  "maxStates",
  "maxEdges",
  "maxDepth",
  "maxFrontier",
  "maxDominantVarValues",
  "maxStateSpaceBits",
  "maxTopContributorBits",
  "maxPendingQueueLen",
] as const satisfies readonly (keyof SharedBudgets)[];

export function validateSharedThresholds(
  value: Record<string, unknown>,
  path: string,
): SharedThresholds {
  for (const key of THRESHOLD_PASS_RATE_KEYS) {
    if (value[key] !== undefined) {
      assertPassRate(value[key], `${path}.${key}`);
    }
  }
  for (const key of THRESHOLD_COUNT_KEYS) {
    if (value[key] !== undefined) {
      assertNonNegativeInteger(value[key], `${path}.${key}`);
    }
  }
  return value as SharedThresholds;
}

export function validateSharedBudgets(
  value: unknown,
  path: string,
): SharedBudgets {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  for (const key of BUDGET_KEYS) {
    if (value[key] !== undefined) {
      assertPositiveInteger(value[key], `${path}.${key}`);
    }
  }
  for (const key of BUDGET_COUNT_KEYS) {
    if (value[key] !== undefined) {
      assertNonNegativeInteger(value[key], `${path}.${key}`);
    }
  }
  return value as SharedBudgets;
}

export function validateAcceptedCaveatRef(
  value: unknown,
  path: string,
): AcceptedCaveatRef {
  if (!isRecord(value)) throw new Error(`${path} must be an object`);
  assertNonEmptyString(value.id, `${path}.id`);
  assertNonEmptyString(value.kind, `${path}.kind`);
  if ("message" in value || "pattern" in value || "regex" in value) {
    throw new Error(
      `${path} must use stable kind and id, not free-form matching`,
    );
  }
  if (value.severity !== undefined) {
    assertNonEmptyString(value.severity, `${path}.severity`);
  }
  if (value.producer !== undefined) {
    assertNonEmptyString(value.producer, `${path}.producer`);
  }
  if (value.mustRemain !== undefined && typeof value.mustRemain !== "boolean") {
    throw new Error(`${path}.mustRemain must be a boolean`);
  }
  return {
    id: value.id,
    kind: value.kind,
    ...(value.severity ? { severity: value.severity } : {}),
    ...(value.producer ? { producer: value.producer } : {}),
    ...(value.mustRemain !== undefined ? { mustRemain: value.mustRemain } : {}),
  };
}

export function hasSharedBudgets(budgets: SharedBudgets | undefined): boolean {
  if (!budgets) return false;
  return BUDGET_KEYS.some((key) => budgets[key] !== undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, path: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
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

function assertNonNegativeInteger(value: unknown, path: string): void {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative integer`);
  }
}
