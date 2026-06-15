import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Model, ModelState, Property, TraceStep } from "modality-ts/core";
import { serializeProperties } from "./serialize-properties.js";
import type { CheckOptions, CheckResult } from "./types.js";

interface NativeBinding {
  checkModel(serializedRequest: string): string;
  modelInitialStates(modelJson: string): string;
  modelSuccessors(modelJson: string, stateJson: string): string;
}

type NativeResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

const require = createRequire(import.meta.url);

function resolveNativeBinary(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const nativeDirs = [
    join(here, "..", "..", "native"),
    join(here, "native"),
    join(process.cwd(), "native"),
  ];
  for (const dir of nativeDirs) {
    const exact = join(dir, "modality-checker.node");
    if (existsSync(exact)) return exact;
    if (!existsSync(dir)) continue;
    const platformMatch = readdirSync(dir).find(
      (entry) =>
        entry.startsWith("modality-checker.") && entry.endsWith(".node"),
    );
    if (platformMatch) return join(dir, platformMatch);
  }
  throw new Error(
    "Native modality-checker addon not found. Run `pnpm build:rust` before checking.",
  );
}

let binding: NativeBinding | undefined;

function loadBinding(): NativeBinding {
  if (!binding) {
    binding = require(resolveNativeBinary()) as NativeBinding;
  }
  return binding;
}

function parseResponse<T>(raw: string): T {
  const parsed = JSON.parse(raw) as NativeResponse<T>;
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.result;
}

export function runRustCheck(
  model: Model,
  properties: readonly Property[],
  options: CheckOptions = {},
): CheckResult {
  const request = {
    model,
    properties: serializeProperties(properties),
    options: {
      slicing: options.slicing,
      slicedModel: options.slicedModel,
      maxStates: options.maxStates,
      maxEdges: options.maxEdges,
      maxFrontier: options.maxFrontier,
      trackElapsed: options.trackElapsed,
    },
  };
  const raw = loadBinding().checkModel(JSON.stringify(request));
  const parsed = JSON.parse(raw) as NativeResponse<CheckResult>;
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.result;
}

export function runRustInitialStates(model: Model): ModelState[] {
  const raw = loadBinding().modelInitialStates(JSON.stringify(model));
  return parseResponse<ModelState[]>(raw);
}

export function runRustSuccessors(
  model: Model,
  state: ModelState,
): TraceStep[] {
  const raw = loadBinding().modelSuccessors(
    JSON.stringify(model),
    JSON.stringify(state),
  );
  return parseResponse<TraceStep[]>(raw);
}
