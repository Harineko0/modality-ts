import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
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

type NativeResponse<T> = { ok: true; result: T } | { ok: false; error: string };

export type LinuxLibcKind = "gnu" | "musl";

export interface NativeRuntime {
  platform: NodeJS.Platform;
  arch: string;
  libcKind?: LinuxLibcKind;
}

const require = createRequire(import.meta.url);

export function nativeTriplesForRuntime(
  platform: NodeJS.Platform,
  arch: string,
  libcKind?: LinuxLibcKind,
): string[] {
  if (platform === "darwin") {
    if (arch === "arm64") return ["darwin-arm64", "darwin-universal"];
    if (arch === "x64") return ["darwin-x64", "darwin-universal"];
    return [];
  }
  if (platform === "linux") {
    if (arch === "x64") {
      if (libcKind === "musl") return ["linux-x64-musl"];
      return ["linux-x64-gnu"];
    }
    if (arch === "arm64") return ["linux-arm64-gnu"];
    return [];
  }
  if (platform === "win32" && arch === "x64") {
    return ["win32-x64-msvc"];
  }
  return [];
}

export function detectLinuxLibc(): LinuxLibcKind {
  if (typeof process.report?.getReport === "function") {
    const report = process.report.getReport() as {
      header?: { glibcVersionRuntime?: string };
    };
    if (report.header?.glibcVersionRuntime) {
      return "gnu";
    }
  }
  try {
    const lddVersion = execFileSync("ldd", ["--version"], {
      encoding: "utf8",
    });
    return lddVersion.includes("musl") ? "musl" : "gnu";
  } catch {
    return "musl";
  }
}

function currentNativeRuntime(): NativeRuntime {
  const runtime: NativeRuntime = {
    platform: process.platform,
    arch: process.arch,
  };
  if (process.platform === "linux") {
    runtime.libcKind = detectLinuxLibc();
  }
  return runtime;
}

export function candidateNativeFilenames(runtime: NativeRuntime): string[] {
  const triples = nativeTriplesForRuntime(
    runtime.platform,
    runtime.arch,
    runtime.libcKind,
  );
  const suffixed = triples.map((triple) => `modality-checker.${triple}.node`);
  return [...suffixed, "modality-checker.node"];
}

export function resolveNativeBinaryInDirs(
  nativeDirs: string[],
  runtime: NativeRuntime,
): string | undefined {
  const candidates = candidateNativeFilenames(runtime);
  for (const dir of nativeDirs) {
    if (!existsSync(dir)) continue;
    for (const filename of candidates) {
      const candidate = join(dir, filename);
      if (existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

function defaultNativeDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    join(here, "..", "..", "native"),
    join(here, "native"),
    join(process.cwd(), "native"),
  ];
}

function resolveNativeBinary(): string {
  const runtime = currentNativeRuntime();
  const nativeDirs = defaultNativeDirs();
  const resolved = resolveNativeBinaryInDirs(nativeDirs, runtime);
  if (resolved) return resolved;

  const candidates = candidateNativeFilenames(runtime);
  const triples = nativeTriplesForRuntime(
    runtime.platform,
    runtime.arch,
    runtime.libcKind,
  );
  const libc =
    runtime.platform === "linux" ? ` (${runtime.libcKind ?? "unknown"})` : "";
  throw new Error(
    `Native modality-checker addon not found for ${runtime.platform}/${runtime.arch}${libc}. ` +
      `Expected one of: ${candidates.join(", ")}. ` +
      `Searched: ${nativeDirs.join(", ")}. ` +
      (triples.length === 0
        ? "This platform is not supported by the published native artifact set."
        : "Run `pnpm build:rust` for a local build or install a published package that includes the matching native binary."),
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
      partialOrderReduction: options.partialOrderReduction,
      maxStates: options.maxStates,
      maxEdges: options.maxEdges,
      maxFrontier: options.maxFrontier,
      trackElapsed: options.trackElapsed,
      memoryGuardBytes: options.memoryGuard?.maxHeapUsedBytes,
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
