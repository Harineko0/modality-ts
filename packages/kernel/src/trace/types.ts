import type { EventLabel, ModelState, Value } from "../ir/types.js";

export interface TraceStep {
  transitionId: string;
  label: EventLabel;
  pre: ModelState;
  post: ModelState;
  diff: Record<string, { before: Value | undefined; after: Value | undefined }>;
}

export interface Trace {
  steps: TraceStep[];
}

export interface TraceArtifact extends Trace {
  schemaVersion: 1;
  kind: "trace";
}
