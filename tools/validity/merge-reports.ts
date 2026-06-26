import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalJson } from "modality-ts/core";
import type {
  ValidityExperimentId,
  ValidityReport,
  ValiditySubReport,
} from "./types.js";

const EXPERIMENT_ORDER: ValidityExperimentId[] = [
  "conformance",
  "mutation",
  "metamorphic",
];

export interface MergeValidityReportsOptions {
  inputPaths: readonly string[];
  reportPath: string;
  now?: Date;
}

export interface MergeValidityReportsResult {
  exitCode: number;
  report: ValidityReport;
}

export async function mergeValidityReports(
  options: MergeValidityReportsOptions,
): Promise<MergeValidityReportsResult> {
  const reports = await Promise.all(options.inputPaths.map(readReport));
  const manifestId = readSharedManifestId(reports);
  const subReports = orderSubReports(
    reports.flatMap((report) => report.subReports),
  );
  const report: ValidityReport = {
    schemaVersion: 1,
    kind: "validity-report",
    generatedAt: (options.now ?? new Date()).toISOString(),
    manifestId,
    subReports,
    reportPath: options.reportPath,
  };

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${canonicalJson(report)}\n`, "utf8");

  const hasError = subReports.some((entry) => entry.status === "error");
  const hasFailure = subReports.some((entry) => entry.status === "fail");
  return {
    exitCode: hasError ? 4 : hasFailure ? 2 : 0,
    report,
  };
}

async function readReport(path: string): Promise<ValidityReport> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as ValidityReport;
  if (parsed.schemaVersion !== 1 || parsed.kind !== "validity-report") {
    throw new Error(`invalid validity report: ${path}`);
  }
  return parsed;
}

function readSharedManifestId(reports: readonly ValidityReport[]): string {
  const manifestIds = new Set(reports.map((report) => report.manifestId));
  if (manifestIds.size !== 1) {
    throw new Error(
      `cannot merge reports for different manifests: ${[...manifestIds].join(", ")}`,
    );
  }
  const [manifestId] = manifestIds;
  if (!manifestId) {
    throw new Error("cannot merge zero validity reports");
  }
  return manifestId;
}

function orderSubReports(
  subReports: readonly ValiditySubReport[],
): ValiditySubReport[] {
  const byExperiment = new Map<ValidityExperimentId, ValiditySubReport>();
  for (const subReport of subReports) {
    if (byExperiment.has(subReport.experiment)) {
      throw new Error(`duplicate validity report: ${subReport.experiment}`);
    }
    byExperiment.set(subReport.experiment, subReport);
  }

  const missing = EXPERIMENT_ORDER.filter(
    (experiment) => !byExperiment.has(experiment),
  );
  if (missing.length > 0) {
    throw new Error(`missing validity report: ${missing.join(", ")}`);
  }

  return EXPERIMENT_ORDER.map((experiment) => byExperiment.get(experiment)!);
}
