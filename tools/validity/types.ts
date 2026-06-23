import type { BenchmarkManifest } from "../benchmark/manifest.js";

export type ValidityExperimentId = "conformance" | "mutation" | "metamorphic";

export type ValidityExperimentStatus = "pass" | "fail" | "skipped" | "error";

export interface ValidityBenchmarkSlice {
  benchmarkId: string;
  framework: string;
  status: ValidityExperimentStatus;
  headline: string;
  metrics: unknown;
  messages: string[];
}

export interface ValiditySubReport {
  experiment: ValidityExperimentId;
  status: ValidityExperimentStatus;
  headline: string;
  perBenchmark: ValidityBenchmarkSlice[];
  messages: string[];
}

export interface ValidityReport {
  schemaVersion: 1;
  kind: "validity-report";
  generatedAt: string;
  manifestId: string;
  subReports: ValiditySubReport[];
  reportPath: string;
}

export interface ValidityRunContext {
  repoRoot: string;
  manifest: BenchmarkManifest;
  workDir: string;
  now: Date;
  gating?: boolean;
}

export interface ValidityExperiment {
  id: ValidityExperimentId;
  run(ctx: ValidityRunContext): Promise<ValiditySubReport>;
}
