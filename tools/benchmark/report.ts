import type { CheckReport, ExtractionReport } from "modality-ts/core";
import type {
  ClassificationSummary,
  ClassifiedPropertyVerdict,
} from "./classify.js";

export type BenchmarkArtifactPaths = {
  model: string;
  extractReport: string;
  checkReport?: string;
  tracesDir?: string;
};

export type BenchmarkLibraryCoverage = {
  jotai: boolean;
  zustand: boolean;
  swr: boolean;
  zod: boolean;
  arktype: boolean;
};

export type BenchmarkFrameworkReport = {
  benchmarkId: string;
  framework: string;
  status: "pass" | "fail";
  routeCount: number;
  varCount: number;
  transitionCount: number;
  libraryCoverage: BenchmarkLibraryCoverage;
  propertyVerdicts: ClassifiedPropertyVerdict[];
  classification: ClassificationSummary;
  artifactPaths: BenchmarkArtifactPaths;
  messages: string[];
};

export type BenchmarkRunReport = {
  schemaVersion: 1;
  kind: "benchmark-run-report";
  generatedAt: string;
  manifestId: string;
  frameworks: BenchmarkFrameworkReport[];
  reportPath: string;
};

export function buildBenchmarkRunReport(input: {
  manifestId: string;
  generatedAt: string;
  reportPath: string;
  frameworks: BenchmarkFrameworkReport[];
}): BenchmarkRunReport {
  return {
    schemaVersion: 1,
    kind: "benchmark-run-report",
    generatedAt: input.generatedAt,
    manifestId: input.manifestId,
    frameworks: input.frameworks,
    reportPath: input.reportPath,
  };
}

export function countRoutes(extractionReport: ExtractionReport): number {
  const routeVar = extractionReport.domains?.find(
    (entry) => entry.varId === "sys:route",
  );
  if (!routeVar) return 0;
  const routeDomain = extractionReport.modelDomains?.find(
    (entry) => entry.varId === "sys:route",
  );
  if (
    routeDomain &&
    "values" in routeDomain &&
    Array.isArray(routeDomain.values)
  ) {
    return routeDomain.values.length;
  }
  return extractionReport.routeCoverage?.routes?.length ?? 0;
}

export function summarizeCheckReport(checkReport?: CheckReport): {
  propertyCount: number;
  violated: number;
  verified: number;
} {
  const verdicts = checkReport?.verdicts ?? [];
  return {
    propertyCount: verdicts.length,
    violated: verdicts.filter((entry) => entry.status === "violated").length,
    verified: verdicts.filter(
      (entry) =>
        entry.status === "verified" ||
        entry.status === "verified-within-bounds",
    ).length,
  };
}
