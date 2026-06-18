import type {
  CanaryFailureCategory,
  CanaryFailureClassification,
  CheckReport,
  ConformReport,
  ExtractionReport,
} from "modality-ts/core";
import type {
  CaveatGateOutcome,
  GateBudgetResult,
  GateThresholdResult,
} from "../shared-gates/types.js";

export interface ClassificationInput {
  canaryId: string;
  fixtureId?: string;
  status: "pass" | "fail" | "skipped" | "error";
  extractionReport?: ExtractionReport;
  conformReport?: ConformReport;
  checkReport?: CheckReport;
  thresholdResults?: readonly GateThresholdResult[];
  budgetResults?: readonly GateBudgetResult[];
  caveatOutcome?: CaveatGateOutcome;
  knownUnsupported?: readonly string[];
  manifestInvalid?: boolean;
  integrationError?: string;
  fixtureCoveragePassed?: boolean;
}

const PLAN_FAMILY_BY_CATEGORY: Record<CanaryFailureCategory, string> = {
  "missing-semantic-abstraction": "semantic-typescript-foundation",
  "missing-adapter-capability": "adapter-spi",
  "syntax-recognition-gap": "framework-neutral-ir-checker",
  "incorrect-ir-or-checker": "conformance-matrix",
  "state-space-budget": "state-space-economics",
  "environment-or-project-integration": "effects-async-environment",
  "explicit-unsupported-behavior": "trust-ledger-docs",
  "fixture-or-canary-invalid": "real-app-canary",
};

export function classifyCanaryFailure(
  input: ClassificationInput,
): CanaryFailureClassification[] {
  if (input.status === "pass") return [];

  const classifications: CanaryFailureClassification[] = [];
  const push = (
    category: CanaryFailureCategory,
    severity: CanaryFailureClassification["severity"],
    evidence: readonly string[],
  ) => {
    classifications.push({
      canaryId: input.canaryId,
      ...(input.fixtureId ? { fixtureId: input.fixtureId } : {}),
      category,
      severity,
      evidence,
      suggestedPlanFamily: PLAN_FAMILY_BY_CATEGORY[category],
    });
  };

  if (input.manifestInvalid) {
    push("fixture-or-canary-invalid", "blocker", [
      "manifest validation failed",
    ]);
    return classifications;
  }

  if (input.integrationError) {
    push("environment-or-project-integration", "blocker", [
      input.integrationError,
    ]);
    return classifications.length > 0
      ? classifications
      : fallbackClassification(input);
  }

  for (const budget of input.budgetResults ?? []) {
    if (budget.status !== "fail") continue;
    push(
      "state-space-budget",
      "action-required",
      budget.evidence ?? [
        `budget.${budget.id}`,
        budget.message ?? "state-space budget exceeded",
      ],
    );
  }

  const failedThresholds = (input.thresholdResults ?? []).filter(
    (entry) => entry.status === "fail",
  );
  for (const threshold of failedThresholds) {
    if (
      threshold.id === "minCoverageExactOrOverlay" ||
      threshold.id === "maxUnextractable"
    ) {
      const unextractable = input.extractionReport?.coverage.unextractable ?? 0;
      if (unextractable > 0) {
        push(
          "missing-semantic-abstraction",
          "action-required",
          threshold.evidence ?? [threshold.message ?? threshold.id],
        );
        continue;
      }
    }
    if (
      threshold.id.startsWith("minConformPassRate") ||
      threshold.id.startsWith("minTransitionPassRate")
    ) {
      if (input.fixtureCoveragePassed) {
        push(
          "syntax-recognition-gap",
          "action-required",
          threshold.evidence ?? [threshold.message ?? threshold.id],
        );
      } else {
        push(
          "incorrect-ir-or-checker",
          "action-required",
          threshold.evidence ?? [threshold.message ?? threshold.id],
        );
      }
      continue;
    }
    push(
      "fixture-or-canary-invalid",
      "action-required",
      threshold.evidence ?? [threshold.message ?? threshold.id],
    );
  }

  if (input.caveatOutcome?.unacceptedCaveats.length) {
    for (const caveat of input.caveatOutcome.unacceptedCaveats) {
      const [kind] = caveat.split(":");
      if (kind === "unextractable") {
        push("missing-semantic-abstraction", "action-required", [caveat]);
      } else {
        push("missing-adapter-capability", "action-required", [caveat]);
      }
    }
  }

  for (const caveat of input.caveatOutcome?.acceptedCaveats ?? []) {
    if ((input.knownUnsupported ?? []).includes(caveat)) {
      push("explicit-unsupported-behavior", "accepted", [caveat]);
    }
  }

  if (input.caveatOutcome?.missingRequiredCaveats.length) {
    push("fixture-or-canary-invalid", "action-required", [
      ...input.caveatOutcome.missingRequiredCaveats,
    ]);
  }

  return classifications.length > 0
    ? dedupeClassifications(classifications)
    : fallbackClassification(input);
}

export function classifyConformanceFailure(
  input: ClassificationInput & { fixtureId: string },
): CanaryFailureClassification[] {
  return classifyCanaryFailure({
    ...input,
    canaryId: input.fixtureId,
  }).map((entry) => ({
    ...entry,
    canaryId: input.canaryId ?? input.fixtureId,
    fixtureId: input.fixtureId,
    suggestedPlanFamily:
      entry.category === "incorrect-ir-or-checker"
        ? "conformance-matrix"
        : entry.suggestedPlanFamily,
  }));
}

function fallbackClassification(
  input: ClassificationInput,
): CanaryFailureClassification[] {
  return [
    {
      canaryId: input.canaryId,
      ...(input.fixtureId ? { fixtureId: input.fixtureId } : {}),
      category: "fixture-or-canary-invalid",
      severity: "action-required",
      evidence: [
        "failure could not be classified deterministically; improve manifest or report schema",
      ],
      suggestedPlanFamily: PLAN_FAMILY_BY_CATEGORY["fixture-or-canary-invalid"],
    },
  ];
}

function dedupeClassifications(
  classifications: readonly CanaryFailureClassification[],
): CanaryFailureClassification[] {
  const seen = new Set<string>();
  const unique: CanaryFailureClassification[] = [];
  for (const entry of classifications) {
    const key = `${entry.category}:${entry.evidence.join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

export function classifyEveryCategoryFixtures(): CanaryFailureClassification[] {
  const categories = Object.keys(
    PLAN_FAMILY_BY_CATEGORY,
  ) as CanaryFailureCategory[];
  return categories.map((category) => ({
    canaryId: "synthetic",
    category,
    severity:
      category === "explicit-unsupported-behavior"
        ? "accepted"
        : "action-required",
    evidence: [`synthetic:${category}`],
    suggestedPlanFamily: PLAN_FAMILY_BY_CATEGORY[category],
  }));
}
