import type { Model } from "../ir/types.js";
import type { Trace } from "../trace/types.js";

export function parseModelArtifact(json: string): Model {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("model artifact must be an object");
  if (value.schemaVersion !== 1) throw new Error(`unsupported model schemaVersion ${String(value.schemaVersion)}`);
  if (typeof value.id !== "string") throw new Error("model artifact missing id");
  if (!Array.isArray(value.vars)) throw new Error("model artifact missing vars");
  if (!Array.isArray(value.transitions)) throw new Error("model artifact missing transitions");
  if (!isRecord(value.bounds)) throw new Error("model artifact missing bounds");
  return value as unknown as Model;
}

export function parseTraceArtifact(json: string): Trace {
  const value = JSON.parse(json) as unknown;
  if (!isRecord(value)) throw new Error("trace artifact must be an object");
  if (!Array.isArray(value.steps)) throw new Error("trace artifact missing steps");
  for (const [index, step] of value.steps.entries()) {
    if (!isRecord(step) || typeof step.transitionId !== "string" || !isRecord(step.pre) || !isRecord(step.post)) {
      throw new Error(`trace step ${index + 1} is malformed`);
    }
  }
  return value as unknown as Trace;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
