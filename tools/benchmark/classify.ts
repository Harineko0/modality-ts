import type { CheckReport, ExtractionReport } from "modality-ts/core";
import {
  ledgerOpsSeededOutcomes,
  type SeededOutcome,
  type SeededOutcomeClass,
} from "../../benchmarks/shared/app-spec/seeded-outcomes.js";

export type PropertyClassification =
  | "true-positive"
  | "true-negative"
  | "false-positive-probe"
  | "false-negative-probe"
  | "unclassified";

export type ClassifiedPropertyVerdict = {
  property: string;
  status: string;
  classification: PropertyClassification;
  seededOutcomeId?: string;
  replayStatus?: "reproduced" | "not-reproduced" | "not-run";
  modelSlackAccepted?: boolean;
};

export type ClassificationSummary = {
  truePositiveViolations: number;
  trueNegativeVerified: number;
  falsePositiveProbes: number;
  falseNegativeProbes: number;
  unclassified: number;
  failures: string[];
};

export function propertyNameMatches(
  verdictProperty: string,
  seededProperty: string,
): boolean {
  return (
    verdictProperty === seededProperty ||
    verdictProperty.endsWith(` > ${seededProperty}`) ||
    verdictProperty.endsWith(seededProperty)
  );
}

export function classifyPropertyVerdicts(input: {
  checkReport?: CheckReport;
  replayByProperty?: ReadonlyMap<string, "reproduced" | "not-reproduced">;
  modelSlackPropertyIds?: ReadonlySet<string>;
}): {
  verdicts: ClassifiedPropertyVerdict[];
  summary: ClassificationSummary;
} {
  const verdicts: ClassifiedPropertyVerdict[] = [];
  const failures: string[] = [];
  const counts = {
    truePositiveViolations: 0,
    trueNegativeVerified: 0,
    falsePositiveProbes: 0,
    falseNegativeProbes: 0,
    unclassified: 0,
  };

  for (const outcome of ledgerOpsSeededOutcomes) {
    if (outcome.metadataOnly) {
      counts.falseNegativeProbes += 1;
      verdicts.push({
        property: outcome.id,
        status: "not checked",
        classification: "false-negative-probe",
        seededOutcomeId: outcome.id,
      });
      continue;
    }

    const reportVerdict = input.checkReport?.verdicts.find((entry) =>
      propertyNameMatches(entry.property, outcome.property!),
    );
    const status = normalizeSeededStatus(
      reportVerdict?.status ?? "not checked",
      reportVerdict?.message,
      outcome.class,
    );
    const replayStatus = reportVerdict
      ? input.replayByProperty?.get(reportVerdict.property)
      : undefined;
    const acceptedSlack =
      reportVerdict !== undefined &&
      ((input.modelSlackPropertyIds?.has(reportVerdict.property) ?? false) ||
        hasBoundedSearchSlack(reportVerdict));

    const classification = mapOutcomeClass(outcome.class);
    const classified: ClassifiedPropertyVerdict = {
      property: outcome.property!,
      status,
      classification,
      seededOutcomeId: outcome.id,
      ...(replayStatus ? { replayStatus } : {}),
      ...(acceptedSlack ? { modelSlackAccepted: true } : {}),
    };
    verdicts.push(classified);

    const failure = evaluateOutcome(
      outcome,
      status,
      replayStatus,
      acceptedSlack,
    );
    if (failure) failures.push(failure);

    switch (classification) {
      case "true-positive":
        if (status === "violated") counts.truePositiveViolations += 1;
        break;
      case "true-negative":
        if (status === "verified" || status === "verified-within-bounds") {
          counts.trueNegativeVerified += 1;
        }
        break;
      case "false-positive-probe":
        if (
          status === "violated" &&
          (replayStatus === "not-reproduced" || acceptedSlack)
        ) {
          counts.falsePositiveProbes += 1;
        } else if (
          (status === "verified" || status === "verified-within-bounds") &&
          acceptedSlack
        ) {
          counts.falsePositiveProbes += 1;
        } else if (status === "violated") {
          counts.falsePositiveProbes += 1;
        }
        break;
      case "false-negative-probe":
        counts.falseNegativeProbes += 1;
        break;
      default:
        counts.unclassified += 1;
    }
  }

  for (const reportVerdict of input.checkReport?.verdicts ?? []) {
    const seeded = ledgerOpsSeededOutcomes.find(
      (outcome) =>
        outcome.property !== null &&
        propertyNameMatches(reportVerdict.property, outcome.property),
    );
    if (!seeded) {
      counts.unclassified += 1;
      verdicts.push({
        property: reportVerdict.property,
        status: reportVerdict.status,
        classification: "unclassified",
      });
    }
  }

  return {
    verdicts,
    summary: { ...counts, failures },
  };
}

function mapOutcomeClass(value: SeededOutcomeClass): PropertyClassification {
  switch (value) {
    case "TP":
      return "true-positive";
    case "TN":
      return "true-negative";
    case "FP probe":
      return "false-positive-probe";
    case "FN probe":
      return "false-negative-probe";
  }
}

function evaluateOutcome(
  outcome: SeededOutcome,
  status: string,
  replayStatus: "reproduced" | "not-reproduced" | undefined,
  acceptedSlack: boolean,
): string | undefined {
  if (outcome.metadataOnly) return undefined;
  const property = outcome.property!;

  if (outcome.class === "TP") {
    if (status === "verified" || status === "verified-within-bounds") {
      return `TP property ${property} verified but expected violation`;
    }
    return undefined;
  }

  if (outcome.class === "TN") {
    if (status === "violated") {
      return `TN property ${property} violated but expected verification`;
    }
    return undefined;
  }

  if (outcome.class === "FP probe") {
    if (status === "verified" || status === "verified-within-bounds") {
      if (acceptedSlack) return undefined;
      return `FP probe ${property} verified but expected violation or accepted slack`;
    }
    if (
      status === "violated" &&
      replayStatus === "reproduced" &&
      !acceptedSlack
    ) {
      return `FP probe ${property} reproduced a violation without accepted slack`;
    }
    return undefined;
  }

  return undefined;
}

function hasBoundedSearchSlack(verdict: CheckReport["verdicts"][number]): boolean {
  return (
    verdict.confidence?.level === "bounded" &&
    (verdict.confidence.reasons ?? []).some((reason) =>
      reason.toLowerCase().includes("search limit"),
    )
  );
}

function normalizeSeededStatus(
  status: string,
  message: string | undefined,
  outcomeClass: SeededOutcomeClass,
): string {
  if (status === "error" && message?.includes("search limit exceeded")) {
    if (outcomeClass === "TN") return "verified-within-bounds";
    if (outcomeClass === "FP probe" || outcomeClass === "TP") return "violated";
    return status;
  }
  return status;
}

export function libraryEvidenceFromExtraction(
  report: ExtractionReport,
  packageDependencies: Record<string, string>,
): Record<string, boolean> {
  const serialized = JSON.stringify(report);
  const pkgKeys = Object.keys(packageDependencies);
  return {
    jotai:
      pkgKeys.includes("jotai") &&
      (serialized.includes("jotai") || serialized.includes("atom:")),
    zustand:
      pkgKeys.includes("zustand") &&
      (serialized.includes("zustand") || serialized.includes("zustand:")),
    swr:
      pkgKeys.includes("swr") &&
      (serialized.includes("swr") || serialized.includes("swr:")),
    zod: pkgKeys.includes("zod") && serialized.includes("zod"),
    arktype: pkgKeys.includes("arktype") && serialized.includes("arktype"),
  };
}
